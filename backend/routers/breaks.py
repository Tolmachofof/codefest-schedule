from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from auth import get_current_user
from database import get_db
from services.conference_service import log
from services.pubsub import notify
from services.validation import check_break_vs_talks_and_breaks, check_hall_in_conference

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.post(
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

    check_hall_in_conference(data.hall_id, conference_id, db)
    check_break_vs_talks_and_breaks(data.start_time, data.end_time, data.hall_id, day)

    hall = db.get(models.Hall, data.hall_id)
    br = models.Break(**data.model_dump(), day_id=day_id)
    db.add(br)
    db.flush()
    log(f"Добавлен перерыв {br.start_time}–{br.end_time} в зал «{hall.name}» ({day.date})", db, cu.username)
    db.commit()
    db.refresh(br)
    notify(conference_id)
    return br


@router.patch("/breaks/{break_id}", response_model=schemas.BreakOut)
def update_break(
    break_id: int,
    data: schemas.BreakUpdate,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    br = db.get(models.Break, break_id)
    if not br:
        raise HTTPException(status_code=404, detail="Break not found")

    conference_id = br.day.conference_id
    if data.hall_id is not None:
        check_hall_in_conference(data.hall_id, conference_id, db)

    if data.day_id is not None:
        new_day = db.get(models.ConferenceDay, data.day_id)
        if not new_day or new_day.conference_id != conference_id:
            raise HTTPException(status_code=400, detail="Day does not belong to this conference")
        effective_day = new_day
    else:
        effective_day = br.day

    effective_hall_id = data.hall_id if data.hall_id is not None else br.hall_id
    effective_start = data.start_time if data.start_time is not None else br.start_time
    effective_end = data.end_time if data.end_time is not None else br.end_time
    check_break_vs_talks_and_breaks(
        effective_start, effective_end, effective_hall_id, effective_day,
        exclude_break_id=break_id if effective_day.id == br.day_id else None,
    )

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(br, field, value)

    log(f"Обновлён перерыв {br.start_time}–{br.end_time}", db, cu.username)
    db.commit()
    db.refresh(br)
    notify(conference_id)
    return br


@router.delete("/breaks/{break_id}", status_code=204)
def delete_break(
    break_id: int,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    br = db.get(models.Break, break_id)
    if not br:
        raise HTTPException(status_code=404, detail="Break not found")
    conf_id = br.day.conference_id
    log(f"Удалён перерыв {br.start_time}–{br.end_time}", db, cu.username)
    db.delete(br)
    db.commit()
    notify(conf_id)
