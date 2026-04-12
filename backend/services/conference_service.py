from datetime import date, timedelta

from sqlalchemy.orm import Session

import models


def date_range(start: date, end: date) -> list[date]:
    days = []
    current = start
    while current <= end:
        days.append(current)
        current += timedelta(days=1)
    return days


def sync_days(conference: models.Conference, db: Session) -> None:
    existing: dict[date, models.ConferenceDay] = {d.date: d for d in conference.days}
    new_dates = set(date_range(conference.start_date, conference.end_date))

    removed_dates = set(existing.keys()) - new_dates

    if removed_dates:
        staying_days = sorted(
            [day for dt, day in existing.items() if dt not in removed_dates],
            key=lambda x: x.date,
        )
        if staying_days:
            anchor_day = staying_days[0]
        else:
            first_new_date = min(new_dates)
            anchor_day = models.ConferenceDay(date=first_new_date)
            conference.days.append(anchor_day)
            db.flush()
            existing[first_new_date] = anchor_day

        for dt in removed_dates:
            day = existing[dt]
            talk_ids = [t.id for t in day.talks]
            if talk_ids:
                db.query(models.Talk).filter(models.Talk.id.in_(talk_ids)).update(
                    {"day_id": anchor_day.id},
                    synchronize_session=False,
                )
                db.flush()
            db.expire(day)
            conference.days.remove(day)
            db.delete(day)

    for d in new_dates:
        if d not in existing:
            conference.days.append(models.ConferenceDay(date=d))


def log(action: str, db: Session, username: str = "") -> None:
    prefix = f"[{username}] " if username else ""
    db.add(models.Log(action=prefix + action))
