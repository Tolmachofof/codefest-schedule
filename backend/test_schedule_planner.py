"""Unit tests for services/schedule_planner.py — no DB, no HTTP."""
from datetime import time
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from services.schedule_planner import (
    has_conflict,
    find_free_slot,
    apply_placements,
    create_gap_breaks,
    GRID_START_H, GRID_START_M, GRID_END_H, GRID_END_M,
)

GRID_START = time(GRID_START_H, GRID_START_M)
GRID_END = time(GRID_END_H, GRID_END_M)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_day(day_id=1, breaks=None):
    return SimpleNamespace(id=day_id, breaks=breaks or [])


def make_break(hall_id, start: str, end: str):
    h, m = map(int, start.split(":"))
    eh, em = map(int, end.split(":"))
    return SimpleNamespace(hall_id=hall_id, start_time=time(h, m), end_time=time(eh, em))


def make_placement(talk_id, day_id, hall_id, start: str, end: str):
    h, m = map(int, start.split(":"))
    eh, em = map(int, end.split(":"))
    return {
        "talk_id": talk_id,
        "day_id": day_id,
        "hall_id": hall_id,
        "start_time": time(h, m),
        "end_time": time(eh, em),
    }


def make_talk(talk_id, duration=40, level="middle"):
    t = SimpleNamespace(
        id=talk_id,
        duration_minutes=duration,
        speaker_level=level,
        title=f"Talk {talk_id}",
        tracks=[],
        primary_track_id=None,
    )
    return t


def make_hall(hall_id):
    return SimpleNamespace(id=hall_id)


# ---------------------------------------------------------------------------
# has_conflict
# ---------------------------------------------------------------------------

class TestHasConflict:
    def test_no_conflict_empty(self):
        day = make_day()
        assert not has_conflict(time(10, 0), time(11, 0), 1, day, [])

    def test_conflict_with_break(self):
        day = make_day(breaks=[make_break(1, "10:00", "11:00")])
        assert has_conflict(time(10, 0), time(11, 0), 1, day, [])

    def test_no_conflict_different_hall(self):
        day = make_day(breaks=[make_break(2, "10:00", "11:00")])
        # Зал 1, перерыв в зале 2 — конфликта нет
        assert not has_conflict(time(10, 0), time(11, 0), 1, day, [])

    def test_conflict_with_existing_placement(self):
        day = make_day()
        existing = [make_placement(1, 1, 1, "10:00", "11:00")]
        assert has_conflict(time(10, 0), time(11, 0), 1, day, existing)

    def test_no_conflict_adjacent_placements(self):
        day = make_day()
        existing = [make_placement(1, 1, 1, "10:00", "11:00")]
        # Следующий слот сразу после предыдущего — не конфликт
        assert not has_conflict(time(11, 0), time(12, 0), 1, day, existing)

    def test_small_overlap_within_tolerance(self):
        # Перекрытие 30 сек < MAX_OVERLAP_SECONDS=60 — не конфликт
        day = make_day(breaks=[make_break(1, "10:00", "11:00")])
        assert not has_conflict(time(10, 59, 30), time(12, 0), 1, day, [])

    def test_large_overlap_is_conflict(self):
        day = make_day(breaks=[make_break(1, "10:00", "11:00")])
        # Перекрытие 30 минут > 60 сек — конфликт
        assert has_conflict(time(10, 30), time(12, 0), 1, day, [])


# ---------------------------------------------------------------------------
# find_free_slot
# ---------------------------------------------------------------------------

class TestFindFreeSlot:
    def test_empty_day_returns_grid_start(self):
        day = make_day()
        slot = find_free_slot(day, hall_id=1, duration_min=40, existing=[])
        assert slot == GRID_START

    def test_slot_after_existing_talk(self):
        day = make_day()
        existing = [make_placement(1, 1, 1, "10:00", "10:40")]
        slot = find_free_slot(day, hall_id=1, duration_min=40, existing=existing)
        assert slot == time(10, 40)

    def test_slot_respects_gap_minutes(self):
        day = make_day()
        existing = [make_placement(1, 1, 1, "10:00", "10:40")]
        # gap_minutes=20 означает 20 мин отступ перед началом
        slot = find_free_slot(day, hall_id=1, duration_min=40, existing=existing, gap_minutes=20)
        assert slot == time(11, 0)

    def test_slot_skips_break(self):
        day = make_day(breaks=[make_break(1, "10:00", "11:00")])
        slot = find_free_slot(day, hall_id=1, duration_min=40, existing=[])
        assert slot == time(11, 0)

    def test_no_slot_when_fully_booked(self):
        # Весь день занят одним большим докладом
        day = make_day()
        existing = [make_placement(1, 1, 1, "10:00", "18:00")]
        slot = find_free_slot(day, hall_id=1, duration_min=40, existing=existing)
        assert slot is None

    def test_different_hall_does_not_block(self):
        day = make_day()
        existing = [make_placement(1, 1, 2, "10:00", "18:00")]  # hall_id=2
        slot = find_free_slot(day, hall_id=1, duration_min=40, existing=existing)
        assert slot == GRID_START


# ---------------------------------------------------------------------------
# apply_placements
# ---------------------------------------------------------------------------

class TestApplyPlacements:
    def _make_env(self):
        day = make_day(day_id=1)
        hall = make_hall(1)
        return [day], [hall]

    def test_valid_llm_placement_accepted(self):
        days, halls = self._make_env()
        talk = make_talk(1, duration=40)
        placements = apply_placements(
            llm_placements=[{"talk_id": 1, "day_id": 1, "hall_id": 1, "start_time": "10:00"}],
            talks=[talk],
            days=days,
            halls=halls,
            baseline=[],
        )
        assert len(placements) == 1
        assert placements[0]["talk_id"] == 1
        assert placements[0]["start_time"] == time(10, 0)
        assert placements[0]["end_time"] == time(10, 40)

    def test_invalid_hall_rejected(self):
        days, halls = self._make_env()
        talk = make_talk(1)
        placements = apply_placements(
            llm_placements=[{"talk_id": 1, "day_id": 1, "hall_id": 999, "start_time": "10:00"}],
            talks=[talk], days=days, halls=halls, baseline=[],
        )
        # Жадный алгоритм должен разместить в hall_id=1
        assert len(placements) == 1
        assert placements[0]["hall_id"] == 1

    def test_duplicate_talk_id_ignored(self):
        days, halls = self._make_env()
        talk = make_talk(1)
        placements = apply_placements(
            llm_placements=[
                {"talk_id": 1, "day_id": 1, "hall_id": 1, "start_time": "10:00"},
                {"talk_id": 1, "day_id": 1, "hall_id": 1, "start_time": "11:00"},
            ],
            talks=[talk], days=days, halls=halls, baseline=[],
        )
        assert len(placements) == 1

    def test_out_of_grid_rejected_and_greedy_fills(self):
        days, halls = self._make_env()
        talk = make_talk(1)
        placements = apply_placements(
            llm_placements=[{"talk_id": 1, "day_id": 1, "hall_id": 1, "start_time": "22:00"}],
            talks=[talk], days=days, halls=halls, baseline=[],
        )
        assert len(placements) == 1
        assert placements[0]["start_time"] == GRID_START

    def test_keynote_creates_sentinels(self):
        day = make_day(day_id=1)
        hall1 = make_hall(1)
        hall2 = make_hall(2)
        keynote = make_talk(1, duration=60, level="keynote")
        placements = apply_placements(
            llm_placements=[{"talk_id": 1, "day_id": 1, "hall_id": 1, "start_time": "10:00"}],
            talks=[keynote], days=[day], halls=[hall1, hall2], baseline=[],
        )
        # 1 реальный + 1 sentinel для hall2
        assert len(placements) == 2
        sentinel = next(p for p in placements if p["talk_id"] is None)
        assert sentinel["hall_id"] == 2

    def test_greedy_fallback_places_unplaced(self):
        days, halls = self._make_env()
        t1 = make_talk(1)
        t2 = make_talk(2)
        # LLM размещает только t1
        placements = apply_placements(
            llm_placements=[{"talk_id": 1, "day_id": 1, "hall_id": 1, "start_time": "10:00"}],
            talks=[t1, t2], days=days, halls=halls, baseline=[],
        )
        talk_ids = {p["talk_id"] for p in placements if p["talk_id"] is not None}
        assert {1, 2} == talk_ids

    def test_baseline_placements_preserved(self):
        days, halls = self._make_env()
        talk = make_talk(2)
        baseline = [make_placement(1, 1, 1, "10:00", "10:40")]
        placements = apply_placements(
            llm_placements=[],
            talks=[talk], days=days, halls=halls, baseline=baseline,
        )
        assert placements[0] == baseline[0]
        assert placements[1]["talk_id"] == 2


# ---------------------------------------------------------------------------
# create_gap_breaks
# ---------------------------------------------------------------------------

class TestCreateGapBreaks:
    def test_creates_break_between_talks(self):
        db = MagicMock()
        db.add = MagicMock()
        day = make_day(day_id=1, breaks=[])
        placements = [
            make_placement(1, 1, 1, "10:00", "10:40"),
            make_placement(2, 1, 1, "11:00", "11:40"),  # зазор 20 мин
        ]
        count = create_gap_breaks(placements, [day], db)
        assert count == 1
        db.add.assert_called_once()

    def test_no_break_when_gap_too_small(self):
        db = MagicMock()
        day = make_day(day_id=1, breaks=[])
        placements = [
            make_placement(1, 1, 1, "10:00", "10:40"),
            make_placement(2, 1, 1, "10:50", "11:30"),  # зазор 10 мин < GAP_BREAK_MINUTES
        ]
        count = create_gap_breaks(placements, [day], db)
        assert count == 0

    def test_no_duplicate_break_if_already_exists(self):
        db = MagicMock()
        existing_break = make_break(1, "10:40", "11:00")
        day = make_day(day_id=1, breaks=[existing_break])
        placements = [
            make_placement(1, 1, 1, "10:00", "10:40"),
            make_placement(2, 1, 1, "11:00", "11:40"),
        ]
        count = create_gap_breaks(placements, [day], db)
        assert count == 0

    def test_sentinels_not_counted_as_talks(self):
        db = MagicMock()
        day = make_day(day_id=1, breaks=[])
        placements = [
            {"talk_id": None, "day_id": 1, "hall_id": 1,
             "start_time": time(10, 0), "end_time": time(11, 0)},
            {"talk_id": None, "day_id": 1, "hall_id": 1,
             "start_time": time(11, 30), "end_time": time(12, 0)},
        ]
        count = create_gap_breaks(placements, [day], db)
        assert count == 0
