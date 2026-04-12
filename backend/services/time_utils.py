"""Вспомогательные функции для работы со временем."""

from datetime import date, datetime, time, timedelta

EPOCH = date(2000, 1, 1)


def parse_time(s: str) -> time | None:
    try:
        parts = s.strip().split(":")
        return time(int(parts[0]), int(parts[1]))
    except Exception:
        return None


def add_minutes(t: time, minutes: int) -> time:
    dt = datetime.combine(EPOCH, t) + timedelta(minutes=minutes)
    return dt.time()


def overlap_seconds(s1: time, e1: time, s2: time, e2: time) -> float:
    start = max(datetime.combine(EPOCH, s1), datetime.combine(EPOCH, s2))
    end = min(datetime.combine(EPOCH, e1), datetime.combine(EPOCH, e2))
    return max(0.0, (end - start).total_seconds())
