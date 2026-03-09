import asyncio
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, FastAPI, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

import models
import schemas
from auth import get_current_user, router as auth_router
from database import Base, engine, get_db
from kaiten import router as kaiten_router

Base.metadata.create_all(bind=engine)

# Make hall_id / start_time / end_time nullable (unassigned talks)
with engine.connect() as _conn:
    _conn.execute(text("""
        ALTER TABLE talks
            ALTER COLUMN hall_id DROP NOT NULL,
            ALTER COLUMN start_time DROP NOT NULL,
            ALTER COLUMN end_time DROP NOT NULL;
    """))
    _conn.commit()

# Fix FK: primary_track_id must cascade to SET NULL when a track is deleted
with engine.connect() as _conn:
    _conn.execute(text("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'talks_primary_track_id_fkey'
                  AND table_name = 'talks'
            ) THEN
                ALTER TABLE talks
                    DROP CONSTRAINT talks_primary_track_id_fkey,
                    ADD CONSTRAINT talks_primary_track_id_fkey
                        FOREIGN KEY (primary_track_id) REFERENCES tracks(id) ON DELETE SET NULL;
            END IF;
        END$$;
    """))
    _conn.commit()

app = FastAPI(title="CodeFest Schedule API")
app.include_router(auth_router)
app.include_router(kaiten_router)

# All business endpoints require authentication
api = APIRouter(dependencies=[Depends(get_current_user)])

# ---------------------------------------------------------------------------
# SSE pub/sub
# ---------------------------------------------------------------------------

_subscribers: dict[int, set[asyncio.Queue]] = {}


def _notify(conference_id: int) -> None:
    for q in _subscribers.get(conference_id, set()):
        try:
            q.put_nowait("update")
        except asyncio.QueueFull:
            pass


@api.get("/conferences/{conference_id}/events")
async def conference_events(
    conference_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    async def generator():
        q: asyncio.Queue = asyncio.Queue(maxsize=20)
        _subscribers.setdefault(conference_id, set()).add(q)
        try:
            yield "data: connected\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {msg}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            _subscribers.get(conference_id, set()).discard(q)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _date_range(start: date, end: date) -> list[date]:
    days = []
    current = start
    while current <= end:
        days.append(current)
        current += timedelta(days=1)
    return days


MAX_OVERLAP_SECONDS = 60

_EPOCH = date(2000, 1, 1)


def _overlap_seconds(s1: time, e1: time, s2: time, e2: time) -> float:
    start = max(datetime.combine(_EPOCH, s1), datetime.combine(_EPOCH, s2))
    end = min(datetime.combine(_EPOCH, e1), datetime.combine(_EPOCH, e2))
    delta = (end - start).total_seconds()
    return delta if delta > 0 else 0


def _check_track_in_conference(track_id: int, conference_id: int, db: Session) -> None:
    track = db.get(models.Track, track_id)
    if not track or track.conference_id != conference_id:
        raise HTTPException(status_code=400, detail="Track does not belong to this conference")


def _check_hall_in_conference(hall_id: int, conference_id: int, db: Session) -> models.Hall:
    hall = db.get(models.Hall, hall_id)
    if not hall or hall.conference_id != conference_id:
        raise HTTPException(status_code=400, detail="Hall does not belong to this conference")
    return hall


def _check_talk_vs_breaks(
    start: time, end: time, hall_id: int, day: models.ConferenceDay
) -> None:
    for br in day.breaks:
        if br.hall_id != hall_id:
            continue
        overlap = _overlap_seconds(start, end, br.start_time, br.end_time)
        if overlap > MAX_OVERLAP_SECONDS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Talk overlaps break {br.start_time}–{br.end_time} "
                    f"by {int(overlap)}s (max {MAX_OVERLAP_SECONDS})"
                ),
            )


def _check_talk_vs_talks(
    start: time, end: time, hall_id: int, day: models.ConferenceDay,
    exclude_talk_id: int | None = None,
) -> None:
    for talk in day.talks:
        if talk.hall_id != hall_id or talk.id == exclude_talk_id:
            continue
        if talk.start_time is None or talk.end_time is None:
            continue
        overlap = _overlap_seconds(start, end, talk.start_time, talk.end_time)
        if overlap > MAX_OVERLAP_SECONDS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Talk overlaps talk \"{talk.title}\" {talk.start_time}–{talk.end_time} "
                    f"by {int(overlap)}s (max {MAX_OVERLAP_SECONDS})"
                ),
            )


def _check_break_vs_talks_and_breaks(
    start: time,
    end: time,
    hall_id: int,
    day: models.ConferenceDay,
    exclude_break_id: int | None = None,
) -> None:
    for talk in day.talks:
        if talk.hall_id != hall_id:
            continue
        overlap = _overlap_seconds(start, end, talk.start_time, talk.end_time)
        if overlap > MAX_OVERLAP_SECONDS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Break overlaps talk \"{talk.title}\" {talk.start_time}–{talk.end_time} "
                    f"by {int(overlap)}s (max {MAX_OVERLAP_SECONDS})"
                ),
            )
    for br in day.breaks:
        if br.hall_id != hall_id or br.id == exclude_break_id:
            continue
        overlap = _overlap_seconds(start, end, br.start_time, br.end_time)
        if overlap > MAX_OVERLAP_SECONDS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Break overlaps break {br.start_time}–{br.end_time} "
                    f"by {int(overlap)}s (max {MAX_OVERLAP_SECONDS})"
                ),
            )


def _log(action: str, db: Session, username: str = "") -> None:
    prefix = f"[{username}] " if username else ""
    db.add(models.Log(action=prefix + action))


def _sync_days(conference: models.Conference, db: Session) -> None:
    existing: dict[date, models.ConferenceDay] = {d.date: d for d in conference.days}
    new_dates = set(_date_range(conference.start_date, conference.end_date))

    removed_dates = set(existing.keys()) - new_dates

    if removed_dates:
        # Find the anchor day to receive unassigned talks from removed days
        staying_days = sorted(
            [day for dt, day in existing.items() if dt not in removed_dates],
            key=lambda x: x.date,
        )
        if staying_days:
            anchor_day = staying_days[0]
        else:
            # All existing days are removed — create the first new day now so talks have a home
            first_new_date = min(new_dates)
            anchor_day = models.ConferenceDay(date=first_new_date)
            conference.days.append(anchor_day)
            db.flush()
            # Mark as already added so the bottom loop doesn't create a duplicate
            existing[first_new_date] = anchor_day

        for dt in removed_dates:
            day = existing[dt]
            talk_ids = [t.id for t in day.talks]
            if talk_ids:
                db.query(models.Talk).filter(models.Talk.id.in_(talk_ids)).update(
                    {"hall_id": None, "start_time": None, "end_time": None, "day_id": anchor_day.id},
                    synchronize_session=False,
                )
                db.flush()
            # Expire so SQLAlchemy re-reads day.talks from DB (now empty) before cascade delete
            db.expire(day)
            conference.days.remove(day)
            db.delete(day)

    for d in new_dates:
        if d not in existing:
            conference.days.append(models.ConferenceDay(date=d))


# ---------------------------------------------------------------------------
# Conferences
# ---------------------------------------------------------------------------

@api.get("/conferences", response_model=list[schemas.ConferenceOut])
def list_conferences(db: Session = Depends(get_db)):
    return db.query(models.Conference).all()


@api.post("/conferences", response_model=schemas.ConferenceOut, status_code=201)
def create_conference(data: schemas.ConferenceCreate, db: Session = Depends(get_db), cu: models.User = Depends(get_current_user)):
    conference = models.Conference(**data.model_dump(exclude={"tracks"}))
    conference.tracks = [models.Track(**t.model_dump()) for t in data.tracks]
    db.add(conference)
    db.flush()
    _sync_days(conference, db)
    _log(f"Создана конференция «{conference.name}»", db, cu.username)
    db.commit()
    db.refresh(conference)
    _notify(conference.id)
    return conference


@api.get("/conferences/{conference_id}", response_model=schemas.ConferenceOut)
def get_conference(conference_id: int, db: Session = Depends(get_db)):
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise HTTPException(status_code=404, detail="Conference not found")
    return conference


@api.patch("/conferences/{conference_id}", response_model=schemas.ConferenceOut)
def update_conference(
    conference_id: int, data: schemas.ConferenceUpdate, db: Session = Depends(get_db), cu: models.User = Depends(get_current_user)
):
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise HTTPException(status_code=404, detail="Conference not found")

    updates = data.model_dump(exclude_none=True, exclude={"tracks"})
    for field, value in updates.items():
        setattr(conference, field, value)

    if data.tracks is not None:
        existing_by_name = {t.name: t for t in conference.tracks}
        new_tracks = []
        for track_data in data.tracks:
            if track_data.name in existing_by_name:
                existing = existing_by_name[track_data.name]
                existing.slots = track_data.slots
                new_tracks.append(existing)
            else:
                new_tracks.append(models.Track(**track_data.model_dump()))
        conference.tracks = new_tracks

    _sync_days(conference, db)
    _log(f"Обновлена конференция «{conference.name}»", db, cu.username)
    db.commit()
    db.refresh(conference)
    _notify(conference_id)
    return conference


@api.delete("/conferences/{conference_id}", status_code=204)
def delete_conference(conference_id: int, db: Session = Depends(get_db), cu: models.User = Depends(get_current_user)):
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise HTTPException(status_code=404, detail="Conference not found")
    _log(f"Удалена конференция «{conference.name}»", db, cu.username)
    db.delete(conference)
    db.commit()
    _notify(conference_id)


# ---------------------------------------------------------------------------
# Halls
# ---------------------------------------------------------------------------

@api.post("/conferences/{conference_id}/halls", response_model=schemas.HallOut, status_code=201)
def create_hall(
    conference_id: int, data: schemas.HallBase, db: Session = Depends(get_db), cu: models.User = Depends(get_current_user)
):
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise HTTPException(status_code=404, detail="Conference not found")
    hall = models.Hall(**data.model_dump(), conference_id=conference_id)
    db.add(hall)
    db.flush()
    _log(f"Добавлен зал «{hall.name}» в конференцию «{conference.name}»", db, cu.username)
    db.commit()
    db.refresh(hall)
    _notify(conference_id)
    return hall


@api.delete("/halls/{hall_id}", status_code=204)
def delete_hall(hall_id: int, db: Session = Depends(get_db), cu: models.User = Depends(get_current_user)):
    hall = db.get(models.Hall, hall_id)
    if not hall:
        raise HTTPException(status_code=404, detail="Hall not found")
    db.query(models.Talk).filter(models.Talk.hall_id == hall_id).update(
        {"hall_id": None, "start_time": None, "end_time": None},
        synchronize_session=False,
    )
    db.query(models.Break).filter(models.Break.hall_id == hall_id).delete(synchronize_session=False)
    db.flush()
    conf_id = hall.conference_id
    _log(f"Удалён зал «{hall.name}» (доклады возвращены в очередь)", db, cu.username)
    db.delete(hall)
    db.commit()
    _notify(conf_id)


# ---------------------------------------------------------------------------
# Talks
# ---------------------------------------------------------------------------

@api.post(
    "/conferences/{conference_id}/days/{day_id}/talks",
    response_model=schemas.TalkOut,
    status_code=201,
)
def create_talk(
    conference_id: int,
    day_id: int,
    data: schemas.TalkCreate,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    day = db.get(models.ConferenceDay, day_id)
    if not day or day.conference_id != conference_id:
        raise HTTPException(status_code=404, detail="Day not found")

    _check_hall_in_conference(data.hall_id, conference_id, db)
    if data.primary_track_id is not None:
        _check_track_in_conference(data.primary_track_id, conference_id, db)
    track_objs = []
    for track_id in data.track_ids:
        _check_track_in_conference(track_id, conference_id, db)
        track_objs.append(db.get(models.Track, track_id))
    _check_talk_vs_breaks(data.start_time, data.end_time, data.hall_id, day)
    _check_talk_vs_talks(data.start_time, data.end_time, data.hall_id, day)

    hall = db.get(models.Hall, data.hall_id)
    talk = models.Talk(**data.model_dump(exclude={"track_ids"}), day_id=day_id)
    talk.tracks = track_objs
    db.add(talk)
    db.flush()
    _log(f"Добавлен доклад «{talk.title}» в зал «{hall.name}» ({day.date})", db, cu.username)
    db.commit()
    db.refresh(talk)
    _notify(conference_id)
    return talk


@api.post("/conferences/{conference_id}/talks", response_model=schemas.TalkOut, status_code=201)
def create_unassigned_talk(
    conference_id: int, data: schemas.UnassignedTalkCreate, db: Session = Depends(get_db), cu: models.User = Depends(get_current_user)
):
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise HTTPException(status_code=404, detail="Conference not found")
    if not conference.days:
        raise HTTPException(status_code=400, detail="Conference has no days")

    if data.primary_track_id is not None:
        _check_track_in_conference(data.primary_track_id, conference_id, db)
    track_objs = []
    for track_id in data.track_ids:
        _check_track_in_conference(track_id, conference_id, db)
        track_objs.append(db.get(models.Track, track_id))

    day = conference.days[0]
    talk = models.Talk(title=data.title, primary_track_id=data.primary_track_id, day_id=day.id)
    talk.tracks = track_objs
    db.add(talk)
    db.flush()
    _log(f"Создан доклад «{talk.title}» (без зала)", db, cu.username)
    db.commit()
    db.refresh(talk)
    _notify(conference_id)
    return talk


@api.patch("/talks/{talk_id}", response_model=schemas.TalkOut)
def update_talk(talk_id: int, data: schemas.TalkUpdate, db: Session = Depends(get_db), cu: models.User = Depends(get_current_user)):
    talk = db.get(models.Talk, talk_id)
    if not talk:
        raise HTTPException(status_code=404, detail="Talk not found")

    conference_id = talk.day.conference_id
    effective_hall_id = data.hall_id if data.hall_id is not None else talk.hall_id
    if data.hall_id is not None:
        _check_hall_in_conference(data.hall_id, conference_id, db)
    if "primary_track_id" in data.model_fields_set:
        if data.primary_track_id is not None:
            _check_track_in_conference(data.primary_track_id, conference_id, db)
        talk.primary_track_id = data.primary_track_id
    if data.track_ids is not None:
        track_objs = []
        for track_id in data.track_ids:
            _check_track_in_conference(track_id, conference_id, db)
            track_objs.append(db.get(models.Track, track_id))
        talk.tracks = track_objs

    if data.day_id is not None:
        new_day = db.get(models.ConferenceDay, data.day_id)
        if not new_day or new_day.conference_id != conference_id:
            raise HTTPException(status_code=400, detail="Day does not belong to this conference")
        effective_day = new_day
    else:
        effective_day = talk.day

    effective_start = data.start_time if data.start_time is not None else talk.start_time
    effective_end = data.end_time if data.end_time is not None else talk.end_time
    if effective_hall_id is not None and effective_start is not None and effective_end is not None:
        _check_talk_vs_breaks(effective_start, effective_end, effective_hall_id, effective_day)
        _check_talk_vs_talks(effective_start, effective_end, effective_hall_id, effective_day, exclude_talk_id=talk_id)

    for field, value in data.model_dump(exclude_unset=True, exclude={"track_ids", "primary_track_id"}).items():
        setattr(talk, field, value)

    placed = talk.hall_id is not None and talk.start_time is not None
    _log(f"Обновлён доклад «{talk.title}»" + (f" ({talk.start_time}–{talk.end_time})" if placed else " (без зала)"), db, cu.username)
    db.commit()
    db.refresh(talk)
    _notify(talk.day.conference_id)
    return talk


@api.delete("/talks/{talk_id}", status_code=204)
def delete_talk(talk_id: int, db: Session = Depends(get_db), cu: models.User = Depends(get_current_user)):
    talk = db.get(models.Talk, talk_id)
    if not talk:
        raise HTTPException(status_code=404, detail="Talk not found")
    conf_id = talk.day.conference_id
    _log(f"Удалён доклад «{talk.title}»", db, cu.username)
    db.delete(talk)
    db.commit()
    _notify(conf_id)


# ---------------------------------------------------------------------------
# Breaks
# ---------------------------------------------------------------------------

@api.post(
    "/conferences/{conference_id}/days/{day_id}/breaks",
    response_model=schemas.BreakOut,
    status_code=201,
)
def create_break(
    conference_id: int,
    day_id: int,
    data: schemas.BreakCreate,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    day = db.get(models.ConferenceDay, day_id)
    if not day or day.conference_id != conference_id:
        raise HTTPException(status_code=404, detail="Day not found")

    _check_hall_in_conference(data.hall_id, conference_id, db)
    _check_break_vs_talks_and_breaks(data.start_time, data.end_time, data.hall_id, day)

    hall = db.get(models.Hall, data.hall_id)
    br = models.Break(**data.model_dump(), day_id=day_id)
    db.add(br)
    db.flush()
    _log(f"Добавлен перерыв {br.start_time}–{br.end_time} в зал «{hall.name}» ({day.date})", db, cu.username)
    db.commit()
    db.refresh(br)
    _notify(conference_id)
    return br


@api.patch("/breaks/{break_id}", response_model=schemas.BreakOut)
def update_break(break_id: int, data: schemas.BreakUpdate, db: Session = Depends(get_db), cu: models.User = Depends(get_current_user)):
    br = db.get(models.Break, break_id)
    if not br:
        raise HTTPException(status_code=404, detail="Break not found")

    conference_id = br.day.conference_id
    if data.hall_id is not None:
        _check_hall_in_conference(data.hall_id, conference_id, db)

    if data.day_id is not None:
        new_day = db.get(models.ConferenceDay, data.day_id)
        if not new_day or new_day.conference_id != conference_id:
            raise HTTPException(status_code=400, detail="Day does not belong to this conference")
        effective_day = new_day
    else:
        effective_day = br.day

    effective_hall_id = data.hall_id or br.hall_id
    effective_start = data.start_time or br.start_time
    effective_end = data.end_time or br.end_time
    _check_break_vs_talks_and_breaks(
        effective_start, effective_end, effective_hall_id, effective_day,
        exclude_break_id=break_id if data.day_id is None else None,
    )

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(br, field, value)

    _log(f"Обновлён перерыв {br.start_time}–{br.end_time}", db, cu.username)
    db.commit()
    db.refresh(br)
    _notify(conference_id)
    return br


@api.delete("/breaks/{break_id}", status_code=204)
def delete_break(break_id: int, db: Session = Depends(get_db), cu: models.User = Depends(get_current_user)):
    br = db.get(models.Break, break_id)
    if not br:
        raise HTTPException(status_code=404, detail="Break not found")
    conf_id = br.day.conference_id
    _log(f"Удалён перерыв {br.start_time}–{br.end_time}", db, cu.username)
    db.delete(br)
    db.commit()
    _notify(conf_id)


# ---------------------------------------------------------------------------
# Logs
# ---------------------------------------------------------------------------

@api.get("/logs", response_model=list[schemas.LogOut])
def list_logs(db: Session = Depends(get_db)):
    return db.query(models.Log).order_by(models.Log.id.desc()).all()


app.include_router(api)
