"""
Алгоритмы размещения докладов по расписанию.

Содержит:
- обнаружение конфликтов и поиск свободных слотов
- валидацию и применение LLM-размещений
- жадный fallback для непомещённых докладов
- автоматическое создание перерывов между докладами
"""

import logging
from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

import models
from services.time_utils import EPOCH, add_minutes, overlap_seconds, parse_time

logger = logging.getLogger(__name__)

GRID_START_H, GRID_START_M = 10, 0
GRID_END_H, GRID_END_M = 18, 0
SLOT_MINUTES = 20
GAP_BREAK_MINUTES = 20
MAX_OVERLAP_SECONDS = 60.0


def has_conflict(
    start,
    end,
    hall_id: int,
    day: models.ConferenceDay,
    existing: list[dict],
    max_overlap: float = MAX_OVERLAP_SECONDS,
) -> bool:
    for br in day.breaks:
        if br.hall_id == hall_id and overlap_seconds(start, end, br.start_time, br.end_time) > max_overlap:
            return True
    for p in existing:
        if p["hall_id"] == hall_id and p["day_id"] == day.id:
            if overlap_seconds(start, end, p["start_time"], p["end_time"]) > max_overlap:
                return True
    return False


def find_free_slot(
    day: models.ConferenceDay,
    hall_id: int,
    duration_min: int,
    existing: list[dict],
    gap_minutes: int = 0,
):
    """Возвращает первый свободный слот в зале или None."""
    from datetime import time as dtime

    grid_start = dtime(GRID_START_H, GRID_START_M)
    grid_end = dtime(GRID_END_H, GRID_END_M)

    current = datetime.combine(EPOCH, grid_start)
    grid_end_dt = datetime.combine(EPOCH, grid_end)

    while current + timedelta(minutes=duration_min) <= grid_end_dt:
        start = current.time()
        end = add_minutes(start, duration_min)

        if has_conflict(start, end, hall_id, day, existing):
            current += timedelta(minutes=SLOT_MINUTES)
            continue

        if gap_minutes > 0:
            gap_start = add_minutes(start, -gap_minutes)
            if any(
                p["hall_id"] == hall_id
                and p["day_id"] == day.id
                and overlap_seconds(gap_start, start, p["start_time"], p["end_time"]) > 0
                for p in existing
            ):
                current += timedelta(minutes=SLOT_MINUTES)
                continue

        return start

    return None


def apply_placements(
    llm_placements: list[dict],
    talks: list[models.Talk],
    days: list[models.ConferenceDay],
    halls: list[models.Hall],
    baseline: list[dict],
) -> list[dict]:
    """Валидирует LLM-размещения, добавляет sentinel-блокировки кейнотов,
    затем жадным алгоритмом размещает оставшиеся доклады.

    baseline — уже занятые слоты (для fill-режима).
    Возвращает baseline + новые размещения.
    """
    from datetime import time as dtime

    grid_start = dtime(GRID_START_H, GRID_START_M)
    grid_end = dtime(GRID_END_H, GRID_END_M)

    talk_map = {t.id: t for t in talks}
    day_map = {d.id: d for d in days}
    hall_ids = {h.id for h in halls}

    working: list[dict] = list(baseline)
    placed_ids: set[int] = {p["talk_id"] for p in baseline if p.get("talk_id") is not None}

    # Принимаем корректные LLM-размещения
    for p in llm_placements:
        talk_id = p.get("talk_id")
        day_id = p.get("day_id")
        hall_id = p.get("hall_id")

        if talk_id not in talk_map or day_id not in day_map or hall_id not in hall_ids:
            continue
        if talk_id in placed_ids:
            continue

        start = parse_time(p.get("start_time", ""))
        if start is None:
            continue

        duration = talk_map[talk_id].duration_minutes or 40
        end = add_minutes(start, duration)

        if start < grid_start or end > grid_end:
            continue

        if has_conflict(start, end, hall_id, day_map[day_id], working):
            logger.debug("Конфликт для talk_id=%s, пропускаем LLM-размещение", talk_id)
            continue

        working.append({
            "talk_id": talk_id,
            "day_id": day_id,
            "hall_id": hall_id,
            "start_time": start,
            "end_time": end,
            "reasoning": p.get("reasoning"),
        })
        placed_ids.add(talk_id)

        # Кейнот блокирует все залы на то же время
        if talk_map[talk_id].speaker_level == "keynote":
            for h in halls:
                if h.id != hall_id:
                    working.append({
                        "talk_id": None,  # sentinel, не сохраняется в БД
                        "day_id": day_id,
                        "hall_id": h.id,
                        "start_time": start,
                        "end_time": end,
                        "reasoning": None,
                    })

    # Жадный fallback для непомещённых
    unplaced = [t for t in talks if t.id not in placed_ids]
    if unplaced:
        logger.info("Жадный алгоритм размещает %d докладов", len(unplaced))

    for talk in unplaced:
        duration = talk.duration_minutes or 40
        placed = False
        for day in days:
            for hall in halls:
                slot_start = find_free_slot(day, hall.id, duration, working, gap_minutes=GAP_BREAK_MINUTES)
                if slot_start is not None:
                    working.append({
                        "talk_id": talk.id,
                        "day_id": day.id,
                        "hall_id": hall.id,
                        "start_time": slot_start,
                        "end_time": add_minutes(slot_start, duration),
                        "reasoning": "Размещён жадным алгоритмом",
                    })
                    placed = True
                    break
            if placed:
                break
        if not placed:
            logger.warning(
                "Не удалось разместить talk_id=%d «%s» — нет свободных слотов",
                talk.id,
                talk.title,
            )

    return working


def create_gap_breaks(placements: list[dict], days: list, db: Session) -> int:
    """Создаёт 20-минутные перерывы в промежутках между докладами в одном зале."""
    day_map = {d.id: d for d in days}
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for p in placements:
        if p["talk_id"] is not None:  # пропускаем sentinel-блокировки кейнотов
            groups[(p["day_id"], p["hall_id"])].append(p)

    created = 0
    for (day_id, hall_id), group in groups.items():
        day = day_map.get(day_id)
        if not day:
            continue

        sorted_talks = sorted(group, key=lambda p: p["start_time"])
        existing_breaks = [br for br in day.breaks if br.hall_id == hall_id]

        for i in range(len(sorted_talks) - 1):
            gap_start = sorted_talks[i]["end_time"]
            gap_end = sorted_talks[i + 1]["start_time"]

            gap_min = (
                datetime.combine(EPOCH, gap_end) - datetime.combine(EPOCH, gap_start)
            ).total_seconds() / 60

            if gap_min < GAP_BREAK_MINUTES:
                continue

            break_start = gap_start
            break_end = add_minutes(break_start, GAP_BREAK_MINUTES)

            already = any(
                overlap_seconds(break_start, break_end, br.start_time, br.end_time) > 0
                for br in existing_breaks
            )
            if already:
                continue

            new_break = models.Break(
                start_time=break_start,
                end_time=break_end,
                day_id=day_id,
                hall_id=hall_id,
            )
            db.add(new_break)
            existing_breaks.append(new_break)
            created += 1

    return created
