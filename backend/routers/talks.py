from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from auth import get_current_user
from database import get_db
from services.conference_service import log
from services.pubsub import notify
from services.validation import check_track_in_conference

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.post("/conferences/{conference_id}/talks", response_model=schemas.TalkOut, status_code=201)
def create_unassigned_talk(
    conference_id: int,
    data: schemas.UnassignedTalkCreate,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    conference = db.get(models.Conference, conference_id)
    if not conference:
        raise HTTPException(status_code=404, detail="Conference not found")
    if not conference.days:
        raise HTTPException(status_code=400, detail="Conference has no days")

    if data.primary_track_id is not None:
        check_track_in_conference(data.primary_track_id, conference_id, db)
    track_objs = []
    for track_id in data.track_ids:
        check_track_in_conference(track_id, conference_id, db)
        track_objs.append(db.get(models.Track, track_id))

    day = conference.days[0]
    talk = models.Talk(
        **data.model_dump(exclude={"track_ids"}),
        day_id=day.id,
    )
    talk.tracks = track_objs
    db.add(talk)
    db.flush()
    log(f"Создан доклад «{talk.title}» (без зала)", db, cu.username)
    db.commit()
    db.refresh(talk)
    notify(conference_id)
    return talk


@router.patch("/talks/{talk_id}", response_model=schemas.TalkOut)
def update_talk(
    talk_id: int,
    data: schemas.TalkUpdate,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    talk = db.get(models.Talk, talk_id)
    if not talk:
        raise HTTPException(status_code=404, detail="Talk not found")

    conference_id = talk.day.conference_id
    if "primary_track_id" in data.model_fields_set:
        if data.primary_track_id is not None:
            check_track_in_conference(data.primary_track_id, conference_id, db)
        talk.primary_track_id = data.primary_track_id
    if data.track_ids is not None:
        track_objs = []
        for track_id in data.track_ids:
            check_track_in_conference(track_id, conference_id, db)
            track_objs.append(db.get(models.Track, track_id))
        talk.tracks = track_objs

    for field, value in data.model_dump(exclude_unset=True, exclude={"track_ids", "primary_track_id"}).items():
        setattr(talk, field, value)

    log(f"Обновлён доклад «{talk.title}»", db, cu.username)
    db.commit()
    db.refresh(talk)
    notify(conference_id)
    return talk


@router.delete("/talks/{talk_id}", status_code=204)
def delete_talk(
    talk_id: int,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    talk = db.get(models.Talk, talk_id)
    if not talk:
        raise HTTPException(status_code=404, detail="Talk not found")
    conf_id = talk.day.conference_id
    log(f"Удалён доклад «{talk.title}»", db, cu.username)
    db.delete(talk)
    db.commit()
    notify(conf_id)
