from datetime import time

from fastapi import HTTPException
from sqlalchemy.orm import Session

import models
from services.time_utils import overlap_seconds

MAX_OVERLAP_SECONDS = 60


def check_track_in_conference(track_id: int, conference_id: int, db: Session) -> None:
    track = db.get(models.Track, track_id)
    if not track or track.conference_id != conference_id:
        raise HTTPException(status_code=400, detail="Track does not belong to this conference")


def check_hall_in_conference(hall_id: int, conference_id: int, db: Session) -> models.Hall:
    hall = db.get(models.Hall, hall_id)
    if not hall or hall.conference_id != conference_id:
        raise HTTPException(status_code=400, detail="Hall does not belong to this conference")
    return hall


def check_talk_vs_breaks(start: time, end: time, hall_id: int, day: models.ConferenceDay) -> None:
    for br in day.breaks:
        if br.hall_id != hall_id:
            continue
        ov = overlap_seconds(start, end, br.start_time, br.end_time)
        if ov > MAX_OVERLAP_SECONDS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Talk overlaps break {br.start_time}–{br.end_time} "
                    f"by {int(ov)}s (max {MAX_OVERLAP_SECONDS})"
                ),
            )


def check_break_vs_talks_and_breaks(
    start: time,
    end: time,
    hall_id: int,
    day: models.ConferenceDay,
    exclude_break_id: int | None = None,
) -> None:
    for br in day.breaks:
        if br.hall_id != hall_id or br.id == exclude_break_id:
            continue
        ov = overlap_seconds(start, end, br.start_time, br.end_time)
        if ov > MAX_OVERLAP_SECONDS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Break overlaps break {br.start_time}–{br.end_time} "
                    f"by {int(ov)}s (max {MAX_OVERLAP_SECONDS})"
                ),
            )
