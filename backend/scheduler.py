"""
Генератор расписания конференций.

Orchestrates LLM call → response validation → greedy fallback → DB persistence.

Детали реализации:
  services/schedule_serializer.py — сериализация данных для LLM
  services/schedule_planner.py   — алгоритмы размещения и конфликт-детекция
  services/llm.py                — провайдеры YandexGPT и GigaChat
"""

import logging
import os
from datetime import datetime, timezone

from sqlalchemy.orm import Session

import models
from services.llm import LLM_PROVIDER_GIGACHAT, LLM_PROVIDER_YANDEX, call_llm
from services.schedule_planner import apply_placements, create_gap_breaks
from services.schedule_serializer import build_llm_payload

logger = logging.getLogger(__name__)


def _is_gigachat(provider: str | None) -> bool:
    return (provider or os.getenv("LLM_PROVIDER", LLM_PROVIDER_YANDEX)).lower() == LLM_PROVIDER_GIGACHAT


def generate_schedule_version(
    conference_id: int,
    db: Session,
    custom_prompt: str | None = None,
    provider: str | None = None,
) -> models.ScheduleVersion:
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise ValueError("Конференция не найдена")

    all_talks: list[models.Talk] = [t for day in conference.days for t in day.talks]
    if not all_talks:
        raise ValueError("Нет докладов для распределения")

    halls = conference.halls
    days = conference.days
    if not halls:
        raise ValueError("Нет залов в конференции")

    talks_data, halls_data, days_data, tracks_data = build_llm_payload(
        all_talks, halls, days, conference.tracks,
        truncate_desc=not _is_gigachat(provider),
    )

    llm_placements: list[dict] = []
    summary = ""
    try:
        llm_placements, summary = call_llm(
            talks_data, halls_data, days_data, tracks_data,
            conference.name, conference.city,
            custom_prompt=custom_prompt,
            provider=provider,
        )
        logger.info("LLM вернул %d размещений", len(llm_placements))
    except Exception as exc:
        logger.warning("LLM недоступен, используем жадный алгоритм: %s", exc)
        summary = f"LLM недоступен ({exc}). Использован жадный алгоритм."

    placements = apply_placements(llm_placements, all_talks, days, halls, baseline=[])

    version = models.ScheduleVersion(
        conference_id=conference_id,
        name=f"AI: {datetime.now(timezone.utc).strftime('%d %b, %H:%M')}",
        summary=summary or "Расписание сгенерировано",
        is_active=False,
    )
    db.add(version)
    db.flush()

    for p in placements:
        if p["talk_id"] is None:
            continue
        db.add(models.TalkPlacement(
            version_id=version.id,
            talk_id=p["talk_id"],
            day_id=p["day_id"],
            hall_id=p["hall_id"],
            start_time=p["start_time"],
            end_time=p["end_time"],
            reasoning=p.get("reasoning"),
        ))

    gaps = create_gap_breaks(placements, days, db)
    if gaps:
        logger.info("Создано %d перерывов между докладами", gaps)

    return version


def fill_schedule_version(
    conference_id: int,
    version_id: int,
    db: Session,
    custom_prompt: str | None = None,
    provider: str | None = None,
) -> models.ScheduleVersion:
    """Добавляет в существующую версию только ещё не размещённые доклады."""
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise ValueError("Конференция не найдена")

    version = db.get(models.ScheduleVersion, version_id)
    if not version or version.conference_id != conference_id:
        raise ValueError("Версия не найдена")

    all_talks: list[models.Talk] = [t for day in conference.days for t in day.talks]
    placed_ids = {p.talk_id for p in version.placements}
    unplaced_talks = [t for t in all_talks if t.id not in placed_ids]

    if not unplaced_talks:
        return version

    halls = conference.halls
    days = conference.days
    if not halls:
        raise ValueError("Нет залов в конференции")

    baseline: list[dict] = [
        {
            "talk_id": p.talk_id,
            "day_id": p.day_id,
            "hall_id": p.hall_id,
            "start_time": p.start_time,
            "end_time": p.end_time,
        }
        for p in version.placements
    ]

    talks_data, halls_data, days_data, tracks_data = build_llm_payload(
        unplaced_talks, halls, days, conference.tracks,
        truncate_desc=not _is_gigachat(provider),
    )

    llm_placements: list[dict] = []
    try:
        llm_placements, _ = call_llm(
            talks_data, halls_data, days_data, tracks_data,
            conference.name, conference.city,
            custom_prompt=custom_prompt,
            provider=provider,
        )
        logger.info("LLM вернул %d размещений (fill)", len(llm_placements))
    except Exception as exc:
        logger.warning("LLM недоступен (fill), жадный алгоритм: %s", exc)

    working = apply_placements(llm_placements, unplaced_talks, days, halls, baseline)

    for p in working[len(baseline):]:
        if p["talk_id"] is None:
            continue
        db.add(models.TalkPlacement(
            version_id=version.id,
            talk_id=p["talk_id"],
            day_id=p["day_id"],
            hall_id=p["hall_id"],
            start_time=p["start_time"],
            end_time=p["end_time"],
            reasoning=p.get("reasoning"),
        ))

    gaps = create_gap_breaks(working, days, db)
    if gaps:
        logger.info("fill: создано %d перерывов между докладами", gaps)

    return version
