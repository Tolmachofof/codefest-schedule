from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from auth import get_current_user
from database import get_db
from services.conference_service import log, sync_days
from services.pubsub import notify

router = APIRouter(dependencies=[Depends(get_current_user)])


# ---------------------------------------------------------------------------
# Conferences
# ---------------------------------------------------------------------------

@router.get("/conferences", response_model=list[schemas.ConferenceSummary])
def list_conferences(db: Session = Depends(get_db)):
    return db.query(models.Conference).all()


@router.post("/conferences", response_model=schemas.ConferenceOut, status_code=201)
def create_conference(
    data: schemas.ConferenceCreate,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    conference = models.Conference(**data.model_dump(exclude={"tracks"}))
    conference.tracks = [models.Track(**t.model_dump()) for t in data.tracks]
    db.add(conference)
    db.flush()
    sync_days(conference, db)
    log(f"Создана конференция «{conference.name}»", db, cu.username)
    db.commit()
    db.refresh(conference)
    notify(conference.id)
    return conference


@router.get("/conferences/{conference_id}", response_model=schemas.ConferenceOut)
def get_conference(conference_id: int, db: Session = Depends(get_db)):
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise HTTPException(status_code=404, detail="Conference not found")
    return conference


@router.patch("/conferences/{conference_id}", response_model=schemas.ConferenceOut)
def update_conference(
    conference_id: int,
    data: schemas.ConferenceUpdate,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise HTTPException(status_code=404, detail="Conference not found")

    effective_start = data.start_date if data.start_date is not None else conference.start_date
    effective_end = data.end_date if data.end_date is not None else conference.end_date
    if effective_end < effective_start:
        raise HTTPException(status_code=400, detail="end_date must be >= start_date")

    updates = data.model_dump(exclude_none=True, exclude={"tracks"})
    for field, value in updates.items():
        setattr(conference, field, value)

    if data.tracks is not None:
        existing_by_id = {t.id: t for t in conference.tracks}
        new_tracks = []
        for track_data in data.tracks:
            if track_data.id is not None and track_data.id in existing_by_id:
                existing = existing_by_id[track_data.id]
                existing.name = track_data.name
                existing.slots = track_data.slots
                new_tracks.append(existing)
            else:
                new_tracks.append(models.Track(**track_data.model_dump(exclude={"id"})))
        conference.tracks = new_tracks

    sync_days(conference, db)
    log(f"Обновлена конференция «{conference.name}»", db, cu.username)
    db.commit()
    db.refresh(conference)
    notify(conference_id)
    return conference


@router.delete("/conferences/{conference_id}", status_code=204)
def delete_conference(
    conference_id: int,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise HTTPException(status_code=404, detail="Conference not found")
    log(f"Удалена конференция «{conference.name}»", db, cu.username)
    db.delete(conference)
    db.commit()
    notify(conference_id)


# ---------------------------------------------------------------------------
# Halls
# ---------------------------------------------------------------------------

@router.post("/conferences/{conference_id}/halls", response_model=schemas.HallOut, status_code=201)
def create_hall(
    conference_id: int,
    data: schemas.HallBase,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise HTTPException(status_code=404, detail="Conference not found")
    hall = models.Hall(**data.model_dump(), conference_id=conference_id)
    db.add(hall)
    db.flush()
    log(f"Добавлен зал «{hall.name}» в конференцию «{conference.name}»", db, cu.username)
    db.commit()
    db.refresh(hall)
    notify(conference_id)
    return hall


@router.delete("/halls/{hall_id}", status_code=204)
def delete_hall(
    hall_id: int,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    hall = db.get(models.Hall, hall_id)
    if not hall:
        raise HTTPException(status_code=404, detail="Hall not found")
    conf_id = hall.conference_id
    log(f"Удалён зал «{hall.name}» (доклады возвращены в очередь)", db, cu.username)
    db.delete(hall)
    db.commit()
    notify(conf_id)
