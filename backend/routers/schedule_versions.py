import threading
import weakref
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
import schemas
from auth import get_current_user
from database import get_db
from rate_limit import limiter
from scheduler import fill_schedule_version, generate_schedule_version
from services.llm import DEFAULT_SCHEDULE_PROMPT
from services.conference_service import log
from services.pubsub import notify
from services.schedule_service import version_to_schema

router = APIRouter(dependencies=[Depends(get_current_user)])

# Per-conference lock: не даёт запускать параллельную LLM-генерацию для одной конференции.
# WeakValueDictionary: запись удаляется автоматически когда lock выходит из scope в роутере.
_generation_locks: weakref.WeakValueDictionary[int, threading.Lock] = weakref.WeakValueDictionary()
_generation_locks_mutex = threading.Lock()


def _get_generation_lock(conference_id: int) -> threading.Lock:
    with _generation_locks_mutex:
        lock = _generation_locks.get(conference_id)
        if lock is None:
            lock = threading.Lock()
            _generation_locks[conference_id] = lock
        return lock


class GenerateScheduleRequest(BaseModel):
    prompt: str | None = None
    provider: str | None = None  # "yandex" | "gigachat" | None → берётся из LLM_PROVIDER


class UpdateSchedulePromptRequest(BaseModel):
    prompt: str


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

@router.get("/schedule/default-prompt")
def get_default_prompt():
    return {"prompt": DEFAULT_SCHEDULE_PROMPT}


@router.get("/conferences/{conference_id}/schedule/prompt")
def get_schedule_prompt(conference_id: int, db: Session = Depends(get_db)):
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise HTTPException(status_code=404, detail="Conference not found")
    return {"prompt": conference.schedule_prompt or DEFAULT_SCHEDULE_PROMPT}


@router.patch("/conferences/{conference_id}/schedule/prompt")
def update_schedule_prompt(
    conference_id: int,
    body: UpdateSchedulePromptRequest,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise HTTPException(status_code=404, detail="Conference not found")
    conference.schedule_prompt = body.prompt
    log(f"Сохранён промпт расписания конференции «{conference.name}»", db, cu.username)
    db.commit()
    return {"prompt": conference.schedule_prompt}


# ---------------------------------------------------------------------------
# Versions CRUD
# ---------------------------------------------------------------------------

@router.get(
    "/conferences/{conference_id}/schedule/versions",
    response_model=list[schemas.ScheduleVersionOut],
)
def list_schedule_versions(conference_id: int, db: Session = Depends(get_db)):
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise HTTPException(status_code=404, detail="Conference not found")
    versions = (
        db.query(models.ScheduleVersion)
        .filter(models.ScheduleVersion.conference_id == conference_id)
        .order_by(models.ScheduleVersion.created_at.desc())
        .all()
    )
    return [version_to_schema(v) for v in versions]


@router.get(
    "/conferences/{conference_id}/schedule/versions/{version_id}",
    response_model=schemas.ScheduleVersionOut,
)
def get_schedule_version(conference_id: int, version_id: int, db: Session = Depends(get_db)):
    version = db.get(models.ScheduleVersion, version_id)
    if not version or version.conference_id != conference_id:
        raise HTTPException(status_code=404, detail="Version not found")
    return version_to_schema(version)


@router.post(
    "/conferences/{conference_id}/schedule/versions/manual",
    response_model=schemas.ScheduleVersionOut,
    status_code=201,
)
def create_manual_version(
    conference_id: int,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    """Создаёт пустую версию для ручного размещения докладов."""
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise HTTPException(status_code=404, detail="Conference not found")
    version_name = f"Ручная: {datetime.now(timezone.utc).strftime('%d %b, %H:%M')}"
    version = models.ScheduleVersion(
        conference_id=conference_id,
        name=version_name,
        summary="Создано вручную — пустая версия для ручного размещения",
        is_active=False,
    )
    db.add(version)
    log(f"Создана ручная версия расписания «{version.name}»", db, cu.username)
    db.commit()
    return version_to_schema(version)


@router.post(
    "/conferences/{conference_id}/schedule/versions/{version_id}/activate",
    response_model=schemas.ScheduleVersionOut,
)
def activate_schedule_version(
    conference_id: int,
    version_id: int,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    version = db.get(models.ScheduleVersion, version_id)
    if not version or version.conference_id != conference_id:
        raise HTTPException(status_code=404, detail="Version not found")
    db.query(models.ScheduleVersion).filter(
        models.ScheduleVersion.conference_id == conference_id,
        models.ScheduleVersion.id != version_id,
    ).update({"is_active": False}, synchronize_session=False)
    version.is_active = True
    log(f"Применена версия расписания «{version.name}» ({len(version.placements)} докладов)", db, cu.username)
    db.commit()
    notify(conference_id)
    return version_to_schema(version)


@router.delete("/conferences/{conference_id}/schedule/versions/{version_id}", status_code=204)
def delete_schedule_version(
    conference_id: int,
    version_id: int,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    version = db.get(models.ScheduleVersion, version_id)
    if not version or version.conference_id != conference_id:
        raise HTTPException(status_code=404, detail="Version not found")
    log(f"Удалена версия расписания «{version.name}»", db, cu.username)
    db.delete(version)
    db.commit()


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

@router.post(
    "/conferences/{conference_id}/schedule/generate",
    response_model=schemas.ScheduleVersionOut,
    status_code=201,
)
@limiter.limit("5/minute")
def generate_schedule(
    request: Request,
    conference_id: int,
    body: GenerateScheduleRequest = GenerateScheduleRequest(),
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise HTTPException(status_code=404, detail="Conference not found")
    lock = _get_generation_lock(conference_id)
    if not lock.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="Генерация уже запущена для этой конференции, подождите")
    try:
        effective_prompt = body.prompt or conference.schedule_prompt or None
        version = generate_schedule_version(conference_id, db, custom_prompt=effective_prompt, provider=body.provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка генерации: {e}")
    finally:
        lock.release()
    log(f"Сгенерирована версия расписания «{version.name}» ({len(version.placements)} докладов)", db, cu.username)
    db.commit()
    db.refresh(version)
    return version_to_schema(version)


@router.post(
    "/conferences/{conference_id}/schedule/versions/{version_id}/fill",
    response_model=schemas.ScheduleVersionOut,
)
@limiter.limit("5/minute")
def fill_schedule(
    request: Request,
    conference_id: int,
    version_id: int,
    body: GenerateScheduleRequest = GenerateScheduleRequest(),
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    """Добавляет в существующую версию расписания ещё не размещённые доклады."""
    version = db.get(models.ScheduleVersion, version_id)
    if not version or version.conference_id != conference_id:
        raise HTTPException(status_code=404, detail="Version not found")
    lock = _get_generation_lock(conference_id)
    if not lock.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="Генерация уже запущена для этой конференции, подождите")
    try:
        version = fill_schedule_version(conference_id, version_id, db, provider=body.provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка генерации: {e}")
    finally:
        lock.release()
    log(f"Дополнена версия расписания «{version.name}» ({len(version.placements)} докладов)", db, cu.username)
    db.commit()
    db.refresh(version)
    return version_to_schema(version)
