from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

import models
import schemas
from auth import get_current_user
from database import get_db

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/logs", response_model=list[schemas.LogOut])
def list_logs(
    db: Session = Depends(get_db),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    return (
        db.query(models.Log)
        .order_by(models.Log.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
