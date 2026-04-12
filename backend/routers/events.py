import asyncio

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from services.pubsub import _subscribers

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/conferences/{conference_id}/events")
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
            subs = _subscribers.get(conference_id)
            if subs:
                subs.discard(q)
                if not subs:
                    _subscribers.pop(conference_id, None)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
