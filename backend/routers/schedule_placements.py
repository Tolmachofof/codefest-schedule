from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

import models
import schemas
from auth import get_current_user
from database import get_db
from services.conference_service import log
from services.pubsub import notify
from services.schedule_planner import has_conflict
from services.schedule_service import version_to_schema

router = APIRouter(dependencies=[Depends(get_current_user)])


def _version_placements_as_dicts(version: models.ScheduleVersion, exclude_talk_id: int | None = None) -> list[dict]:
    """Возвращает текущие размещения версии в формате, понятном has_conflict()."""
    return [
        {
            "talk_id": p.talk_id,
            "day_id": p.day_id,
            "hall_id": p.hall_id,
            "start_time": p.start_time,
            "end_time": p.end_time,
        }
        for p in version.placements
        if p.talk_id != exclude_talk_id
    ]


def _bump_version(db: Session, version: models.ScheduleVersion, original_updated_at: datetime) -> None:
    """Атомарно обновляет updated_at версии расписания.

    Если строка уже была изменена другим запросом (updated_at сдвинулся),
    rowcount == 0 → 409 Conflict.
    """
    now = datetime.now(timezone.utc)
    result = db.execute(
        update(models.ScheduleVersion)
        .where(
            models.ScheduleVersion.id == version.id,
            models.ScheduleVersion.updated_at == original_updated_at,
        )
        .values(updated_at=now)
    )
    if result.rowcount == 0:
        raise HTTPException(
            status_code=409,
            detail="Версия расписания была изменена другим пользователем — обновите страницу",
        )
    version.updated_at = now


@router.delete(
    "/conferences/{conference_id}/schedule/versions/{version_id}/talks/{talk_id}",
    status_code=204,
)
def remove_placement_from_version(
    conference_id: int,
    version_id: int,
    talk_id: int,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    version = db.get(models.ScheduleVersion, version_id)
    if not version or version.conference_id != conference_id:
        raise HTTPException(status_code=404, detail="Version not found")
    placement = (
        db.query(models.TalkPlacement)
        .filter(
            models.TalkPlacement.version_id == version_id,
            models.TalkPlacement.talk_id == talk_id,
        )
        .first()
    )
    if not placement:
        raise HTTPException(status_code=404, detail="Placement not found")
    talk = db.get(models.Talk, talk_id)
    title = talk.title if talk else str(talk_id)
    original_updated_at = version.updated_at
    db.delete(placement)
    _bump_version(db, version, original_updated_at)
    log(f"Доклад «{title}» возвращён в нераспределённые (версия «{version.name}»)", db, cu.username)
    db.commit()
    notify(conference_id)


@router.patch(
    "/conferences/{conference_id}/schedule/versions/{version_id}/talks/{talk_id}",
    response_model=schemas.ScheduleVersionOut,
)
def update_placement_in_version(
    conference_id: int,
    version_id: int,
    talk_id: int,
    data: schemas.PlacementUpdate,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    version = db.get(models.ScheduleVersion, version_id)
    if not version or version.conference_id != conference_id:
        raise HTTPException(status_code=404, detail="Version not found")
    placement = (
        db.query(models.TalkPlacement)
        .filter(
            models.TalkPlacement.version_id == version_id,
            models.TalkPlacement.talk_id == talk_id,
        )
        .first()
    )
    if not placement:
        raise HTTPException(status_code=404, detail="Placement not found")
    hall = db.get(models.Hall, data.hall_id)
    if not hall or hall.conference_id != conference_id:
        raise HTTPException(status_code=400, detail="Hall not found in this conference")
    day = db.get(models.ConferenceDay, data.day_id)
    if not day or day.conference_id != conference_id:
        raise HTTPException(status_code=400, detail="Day not found in this conference")
    existing = _version_placements_as_dicts(version, exclude_talk_id=talk_id)
    if has_conflict(data.start_time, data.end_time, data.hall_id, day, existing):
        raise HTTPException(status_code=400, detail="Время пересекается с перерывом или другим докладом в этом зале")

    original_updated_at = version.updated_at
    placement.hall_id = data.hall_id
    placement.day_id = data.day_id
    placement.start_time = data.start_time
    placement.end_time = data.end_time
    _bump_version(db, version, original_updated_at)
    db.commit()
    db.refresh(version)
    notify(conference_id)
    return version_to_schema(version)


@router.post(
    "/conferences/{conference_id}/schedule/versions/{version_id}/talks",
    response_model=schemas.ScheduleVersionOut,
    status_code=201,
)
def add_placement_to_version(
    conference_id: int,
    version_id: int,
    data: schemas.PlacementCreate,
    db: Session = Depends(get_db),
    cu: models.User = Depends(get_current_user),
):
    version = db.get(models.ScheduleVersion, version_id)
    if not version or version.conference_id != conference_id:
        raise HTTPException(status_code=404, detail="Version not found")
    existing = (
        db.query(models.TalkPlacement)
        .filter(
            models.TalkPlacement.version_id == version_id,
            models.TalkPlacement.talk_id == data.talk_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Talk already placed in this version")
    hall = db.get(models.Hall, data.hall_id)
    if not hall or hall.conference_id != conference_id:
        raise HTTPException(status_code=400, detail="Hall not found in this conference")
    day = db.get(models.ConferenceDay, data.day_id)
    if not day or day.conference_id != conference_id:
        raise HTTPException(status_code=400, detail="Day not found in this conference")
    talk = db.get(models.Talk, data.talk_id)
    if not talk:
        raise HTTPException(status_code=404, detail="Talk not found")

    existing = _version_placements_as_dicts(version)
    if has_conflict(data.start_time, data.end_time, data.hall_id, day, existing):
        raise HTTPException(status_code=400, detail="Время пересекается с перерывом или другим докладом в этом зале")

    original_updated_at = version.updated_at
    placement = models.TalkPlacement(
        version_id=version_id,
        talk_id=data.talk_id,
        hall_id=data.hall_id,
        day_id=data.day_id,
        start_time=data.start_time,
        end_time=data.end_time,
    )
    db.add(placement)
    _bump_version(db, version, original_updated_at)
    log(f"Доклад «{talk.title}» добавлен в версию «{version.name}»", db, cu.username)
    db.commit()
    db.refresh(version)
    notify(conference_id)
    return version_to_schema(version)
