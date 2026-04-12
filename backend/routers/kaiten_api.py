import asyncio
import json
import logging
import re
import time
import uuid
from typing import TypedDict, Literal

logger = logging.getLogger(__name__)

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

import models
import schemas
from auth import get_current_user
from database import SessionLocal, get_db
from services.conference_service import log
from services.kaiten_service import (
    extract_card_field,
    get_kaiten_settings,
    kaiten_credentials,
    match_track,
    parse_description_fields,
    parse_speaker_from_card_title,
)
from services.pubsub import notify


class ImportJob(TypedDict):
    status: Literal["pending", "running", "done", "error"]
    imported: int
    updated: int
    error: str | None
    conference_id: int
    created_at: float


_jobs: dict[str, ImportJob] = {}
_JOBS_TTL = 3600  # секунд — удаляем завершённые задачи старше 1 часа


def _evict_old_jobs() -> None:
    """Удаляет завершённые задачи, созданные более _JOBS_TTL секунд назад."""
    now = time.monotonic()
    done_statuses = ("done", "error")
    to_delete = [
        jid for jid, job in _jobs.items()
        if job["status"] in done_statuses and now - job["created_at"] > _JOBS_TTL
    ]
    for jid in to_delete:
        _jobs.pop(jid, None)

router = APIRouter(
    prefix="/conferences/{conference_id}/kaiten",
    dependencies=[Depends(get_current_user)],
)


@router.get("/settings", response_model=schemas.KaitenSettingsOut)
def get_settings(conference_id: int, db: Session = Depends(get_db)):
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise HTTPException(status_code=404, detail="Conference not found")
    settings = get_kaiten_settings(conference_id, db)
    if not settings:
        raise HTTPException(status_code=404, detail="Kaiten settings not found")
    return settings


@router.put("/settings", response_model=schemas.KaitenSettingsOut)
def upsert_settings(
    conference_id: int,
    data: schemas.KaitenSettingsIn,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise HTTPException(status_code=404, detail="Conference not found")
    settings = get_kaiten_settings(conference_id, db)
    if settings is None:
        settings = models.KaitenSettings(conference_id=conference_id)
        db.add(settings)
    if data.boards is not None:
        settings.boards = json.dumps([b.model_dump() for b in data.boards], ensure_ascii=False)
    if data.field_mapping is not None:
        settings.field_mapping = json.dumps(data.field_mapping, ensure_ascii=False)
    db.commit()
    db.refresh(settings)
    return settings


@router.get("/spaces")
def spaces(conference_id: int):
    base_url, token = kaiten_credentials()
    with httpx.Client(timeout=15, follow_redirects=True) as client:
        resp = client.get(
            f"{base_url}/api/latest/spaces",
            headers={"Authorization": f"Bearer {token}"},
        )
    if not resp.is_success:
        raise HTTPException(status_code=502, detail=f"Kaiten API error: {resp.status_code}")
    try:
        data = resp.json()
    except Exception:
        logger.warning("Kaiten non-JSON response (status=%s): %.300s", resp.status_code, resp.text)
        raise HTTPException(status_code=502, detail="Kaiten вернул неожиданный ответ")
    return [{"id": s["id"], "title": s["title"]} for s in data]


@router.get("/boards")
def boards(conference_id: int, space_id: int = Query(...)):
    base_url, token = kaiten_credentials()
    with httpx.Client(timeout=15, follow_redirects=True) as client:
        resp = client.get(
            f"{base_url}/api/latest/spaces/{space_id}/boards",
            headers={"Authorization": f"Bearer {token}"},
        )
    if not resp.is_success:
        raise HTTPException(status_code=502, detail=f"Kaiten API error: {resp.status_code}")
    data = resp.json()
    return [{"id": b["id"], "title": b["title"]} for b in data]


@router.get("/columns")
def columns(conference_id: int, board_id: int = Query(...)):
    base_url, token = kaiten_credentials()
    with httpx.Client(timeout=15, follow_redirects=True) as client:
        resp = client.get(
            f"{base_url}/api/latest/boards/{board_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
    if not resp.is_success:
        raise HTTPException(status_code=502, detail=f"Kaiten API error: {resp.status_code}")
    board_data = resp.json()
    return [{"id": c["id"], "title": c["title"]} for c in board_data.get("columns", [])]


@router.get("/debug-card")
def debug_card(conference_id: int, db: Session = Depends(get_db)):
    settings = get_kaiten_settings(conference_id, db)
    if not settings:
        raise HTTPException(status_code=400, detail="Kaiten not configured")

    try:
        boards_cfg: list[dict] = json.loads(settings.boards) if settings.boards else []
    except Exception:
        boards_cfg = []
    if not boards_cfg and settings.column_id:
        boards_cfg = [{"column_id": settings.column_id}]

    column_ids = [b["column_id"] for b in boards_cfg if b.get("column_id")]
    if not column_ids:
        raise HTTPException(status_code=400, detail="Kaiten: нет настроенных колонок")

    base_url, token = kaiten_credentials()

    with httpx.Client(timeout=30, follow_redirects=True) as client:
        resp = client.get(
            f"{base_url}/api/latest/cards",
            params={"column_id": column_ids[0], "limit": 1},
            headers={"Authorization": f"Bearer {token}"},
        )
        if not resp.is_success:
            raise HTTPException(status_code=502, detail=f"Kaiten error: {resp.status_code}")
        batch = resp.json()
        if not batch:
            return {"message": "Нет карточек в колонке", "card": None}

        card_id = batch[0]["id"]
        full_resp = client.get(
            f"{base_url}/api/latest/cards/{card_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        full_card = full_resp.json() if full_resp.is_success else batch[0]

    return {
        "card_id": full_card.get("id"),
        "title": full_card.get("title"),
        "description_raw": full_card.get("description"),
        "description_len": len(full_card.get("description") or ""),
        "top_level_keys": list(full_card.keys()),
    }


@router.get("/card-fields")
def card_fields(conference_id: int, db: Session = Depends(get_db)):
    settings = get_kaiten_settings(conference_id, db)
    if not settings:
        raise HTTPException(status_code=400, detail="Kaiten not configured")

    try:
        boards_cfg: list[dict] = json.loads(settings.boards) if settings.boards else []
    except Exception:
        boards_cfg = []
    if not boards_cfg and settings.board_id:
        boards_cfg = [{"board_id": settings.board_id, "column_id": settings.column_id}]

    board_ids = list({b["board_id"] for b in boards_cfg if b.get("board_id")})
    column_ids = [b["column_id"] for b in boards_cfg if b.get("column_id")]

    if not board_ids and not column_ids:
        raise HTTPException(status_code=400, detail="No boards configured")

    base_url, token = kaiten_credentials()

    built_in = [
        {"id": "title", "name": "Заголовок карточки"},
        {"id": "description", "name": "Описание"},
        {"id": "responsible.full_name", "name": "Ответственный (имя)"},
        {"id": "members.full_name", "name": "Участники (имена через запятую)"},
        {"id": "tags", "name": "Теги (через запятую)"},
        {"id": "size", "name": "Размер (story points)"},
        {"id": "type.name", "name": "Тип карточки"},
        {"id": "lane.title", "name": "Полоса (swimlane)"},
        {"id": "due_date", "name": "Срок"},
        {"id": "external_url", "name": "Внешняя ссылка"},
        {"id": "custom_id", "name": "Пользовательский ID"},
        {"id": "blocked_reason", "name": "Причина блокировки"},
    ]

    discovered: dict[str, str] = {}

    with httpx.Client(timeout=20, follow_redirects=True) as client:
        for col_id in column_ids:
            resp = client.get(
                f"{base_url}/api/latest/cards",
                params={"column_id": col_id, "limit": 20},
                headers={"Authorization": f"Bearer {token}"},
            )
            if not resp.is_success:
                continue
            for card in resp.json():
                props = card.get("properties")
                if isinstance(props, dict):
                    for key, val in props.items():
                        if key not in discovered and val is not None:
                            discovered[key] = str(val)
                elif isinstance(props, list):
                    for p in props:
                        if not isinstance(p, dict):
                            continue
                        pid = p.get("id")
                        val = p.get("value")
                        if pid is not None and pid not in discovered and val is not None:
                            discovered[str(pid)] = str(val)

    custom_props = [
        {"id": f"prop:{key}", "name": f"{key}  (пример: {discovered[key][:30]})"}
        for key in sorted(discovered.keys())
    ]

    return built_in + custom_props


async def _fetch_full_card(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    base_url: str,
    token: str,
    card_id: int,
) -> dict | None:
    """Загружает полную карточку Kaiten с retry при 429."""
    async with sem:
        for attempt in range(3):
            resp = await client.get(
                f"{base_url}/api/latest/cards/{card_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code == 429:
                await asyncio.sleep(1 + attempt)
                continue
            if resp.is_success:
                return resp.json()
            return None
    return None


async def _run_import(job_id: str, conference_id: int, username: str) -> None:
    """Фоновая задача импорта карточек из Kaiten."""
    _jobs[job_id]["status"] = "running"
    db: Session = SessionLocal()
    try:
        conference = db.get(models.Conference, conference_id)
        if not conference or not conference.days:
            raise RuntimeError("Конференция не найдена или нет дней")

        settings = get_kaiten_settings(conference_id, db)
        if not settings:
            raise RuntimeError("Kaiten не настроен")

        try:
            boards_cfg: list[dict] = json.loads(settings.boards) if settings.boards else []
        except Exception:
            boards_cfg = []
        if not boards_cfg and settings.column_id:
            boards_cfg = [{"column_id": settings.column_id}]
        if not boards_cfg:
            raise RuntimeError("Kaiten: не настроена ни одна доска")

        column_ids = [b["column_id"] for b in boards_cfg if b.get("column_id")]
        if not column_ids:
            raise RuntimeError("Kaiten: не выбрана ни одна колонка")

        base_url, token = kaiten_credentials()

        # Загружаем список карточек постранично
        all_cards: list[dict] = []
        seen_ids: set[str] = set()
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            for col_id in column_ids:
                offset = 0
                while True:
                    resp = await client.get(
                        f"{base_url}/api/latest/cards",
                        params={"column_id": col_id, "limit": 100, "offset": offset},
                        headers={"Authorization": f"Bearer {token}"},
                    )
                    if not resp.is_success:
                        raise RuntimeError(f"Kaiten API error: {resp.status_code}")
                    batch = resp.json()
                    if not batch:
                        break
                    for card in batch:
                        cid = str(card["id"])
                        if cid not in seen_ids:
                            seen_ids.add(cid)
                            all_cards.append(card)
                    if len(batch) < 100:
                        break
                    offset += 100

            # Загружаем полные карточки параллельно (если нужно описание)
            raw_mapping = settings.field_mapping
            try:
                mapping: dict[str, str | None] = json.loads(raw_mapping) if raw_mapping else {}
            except Exception:
                mapping = {}
            mapping.setdefault("title", "title")
            mapping.setdefault("speaker_name", "responsible.full_name")
            mapping.setdefault("speaker_level", None)
            mapping.setdefault("description", "description")
            mapping.setdefault("duration_minutes", None)
            mapping.setdefault("relevance", None)
            mapping.setdefault("novelty", None)
            mapping.setdefault("applicability", None)
            mapping.setdefault("mass_appeal", None)
            mapping.setdefault("speaker_experience", None)

            needs_full_card = any(v == "description" for v in mapping.values() if v)
            cards = all_cards

            if needs_full_card and cards:
                sem = asyncio.Semaphore(5)
                full_results = await asyncio.gather(
                    *[_fetch_full_card(client, sem, base_url, token, c["id"]) for c in cards]
                )
                full_by_id: dict[int, dict] = {r["id"]: r for r in full_results if r}
                cards = [full_by_id.get(c["id"], c) for c in cards]

        # Сохраняем в БД
        day_ids = [d.id for d in conference.days]
        existing_by_card_id: dict[str, models.Talk] = {}
        if day_ids:
            rows = (
                db.query(models.Talk)
                .filter(models.Talk.day_id.in_(day_ids), models.Talk.kaiten_card_id.isnot(None))
                .all()
            )
            existing_by_card_id = {t.kaiten_card_id: t for t in rows}

        conf_tracks = conference.tracks
        day = conference.days[0]
        imported = 0
        updated = 0

        for card in cards:
            card_id_str = str(card["id"])
            card_title = extract_card_field(card, mapping.get("title", "title")) or "(без названия)"
            raw_description = extract_card_field(card, mapping.get("description")) or ""
            speaker_name = extract_card_field(card, mapping.get("speaker_name"))
            speaker_level = extract_card_field(card, mapping.get("speaker_level"))
            talk_format_from_mapping = extract_card_field(card, mapping.get("talk_format"))
            duration_raw = extract_card_field(card, mapping.get("duration_minutes"))
            try:
                duration_minutes = int(duration_raw) if duration_raw else 40
            except (ValueError, TypeError):
                duration_minutes = 40

            parsed = parse_description_fields(raw_description)
            description = parsed.get("description") or raw_description
            speaker_bio = parsed.get("speaker_bio")
            speaker_company = parsed.get("speaker_company")
            speaker_position = parsed.get("speaker_position")
            talk_format = parsed.get("talk_format") or talk_format_from_mapping
            if not talk_format:
                prefix_m = re.match(r'^([А-ЯЁA-Za-z][^:]{0,20}):\s*', card_title)
                if prefix_m:
                    talk_format = prefix_m.group(1).strip()
            if not speaker_level and parsed.get("speaker_level"):
                speaker_level = parsed["speaker_level"]
            if not duration_raw:
                if talk_format and talk_format.lower() in ("workshop", "воркшоп", "мк", "мастер-класс"):
                    duration_minutes = 100
                else:
                    duration_minutes = 40

            parsed_name, title_company = parse_speaker_from_card_title(card_title)
            title = parsed.get("talk_title") or card_title
            if not speaker_name:
                speaker_name = parsed_name
            if not speaker_company:
                speaker_company = title_company

            primary_track = match_track(parsed.get("primary_track"), conf_tracks)
            additional_track = match_track(parsed.get("additional_track"), conf_tracks)
            if additional_track and primary_track and additional_track.id == primary_track.id:
                additional_track = None

            def _parse_rating(field_key: str) -> int | None:
                raw = extract_card_field(card, mapping.get(field_key))
                if not raw:
                    return None
                try:
                    val = int(float(raw))
                    return val if 1 <= val <= 5 else None
                except (ValueError, TypeError):
                    return None

            if card_id_str in existing_by_card_id:
                talk = existing_by_card_id[card_id_str]
                talk.title = title
                talk.description = description
                talk.speaker_name = speaker_name
                talk.speaker_level = speaker_level
                talk.speaker_company = speaker_company
                talk.speaker_position = speaker_position
                talk.speaker_bio = speaker_bio
                talk.talk_format = talk_format
                talk.duration_minutes = duration_minutes
                talk.relevance = _parse_rating("relevance")
                talk.novelty = _parse_rating("novelty")
                talk.applicability = _parse_rating("applicability")
                talk.mass_appeal = _parse_rating("mass_appeal")
                talk.speaker_experience = _parse_rating("speaker_experience")
                if primary_track:
                    talk.primary_track_id = primary_track.id
                if additional_track is not None:
                    existing_track_ids = {t.id for t in talk.tracks}
                    if additional_track.id not in existing_track_ids:
                        talk.tracks.append(additional_track)
                updated += 1
            else:
                talk = models.Talk(
                    title=title,
                    description=description,
                    kaiten_card_id=card_id_str,
                    day_id=day.id,
                    speaker_name=speaker_name,
                    speaker_level=speaker_level,
                    speaker_company=speaker_company,
                    speaker_position=speaker_position,
                    speaker_bio=speaker_bio,
                    talk_format=talk_format,
                    duration_minutes=duration_minutes,
                    primary_track_id=primary_track.id if primary_track else None,
                    relevance=_parse_rating("relevance"),
                    novelty=_parse_rating("novelty"),
                    applicability=_parse_rating("applicability"),
                    mass_appeal=_parse_rating("mass_appeal"),
                    speaker_experience=_parse_rating("speaker_experience"),
                )
                if additional_track:
                    talk.tracks.append(additional_track)
                db.add(talk)
                imported += 1

        if imported > 0 or updated > 0:
            parts = []
            if imported:
                parts.append(f"импортировано {imported}")
            if updated:
                parts.append(f"обновлено {updated}")
            log(f"Kaiten: {', '.join(parts)} докладов", db, username)
            db.commit()
            notify(conference_id)
        else:
            db.commit()

        _jobs[job_id] = {
            "status": "done",
            "imported": imported,
            "updated": updated,
            "error": None,
            "conference_id": conference_id,
            "created_at": _jobs[job_id]["created_at"],
        }

    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            pass
        _jobs[job_id] = {
            "status": "error",
            "imported": 0,
            "updated": 0,
            "error": str(exc),
            "conference_id": conference_id,
            "created_at": _jobs[job_id]["created_at"],
        }
    finally:
        db.close()


@router.post("/import", status_code=202)
async def kaiten_import(
    conference_id: int,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise HTTPException(status_code=404, detail="Conference not found")
    if not conference.days:
        raise HTTPException(status_code=400, detail="Conference has no days")

    settings = get_kaiten_settings(conference_id, db)
    if not settings:
        raise HTTPException(status_code=400, detail="Kaiten settings not configured")

    try:
        boards_cfg: list[dict] = json.loads(settings.boards) if settings.boards else []
    except Exception:
        boards_cfg = []
    if not boards_cfg and settings.column_id:
        boards_cfg = [{"column_id": settings.column_id}]
    if not boards_cfg:
        raise HTTPException(status_code=400, detail="Kaiten: не настроена ни одна доска")

    column_ids = [b["column_id"] for b in boards_cfg if b.get("column_id")]
    if not column_ids:
        raise HTTPException(status_code=400, detail="Kaiten: не выбрана ни одна колонка")

    _evict_old_jobs()
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "status": "pending",
        "imported": 0,
        "updated": 0,
        "error": None,
        "conference_id": conference_id,
        "created_at": time.monotonic(),
    }
    asyncio.create_task(_run_import(job_id, conference_id, cu.username))
    return {"job_id": job_id, "status": "pending"}


@router.get("/import/{job_id}")
def import_status(job_id: str, conference_id: int):
    job = _jobs.get(job_id)
    if not job or job.get("conference_id") != conference_id:
        raise HTTPException(status_code=404, detail="Job not found")
    return {k: v for k, v in job.items() if k != "conference_id"}
