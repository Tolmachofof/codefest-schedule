import asyncio
import contextlib
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

import models
from auth import router as auth_router
from database import SessionLocal
from kaiten import router as kaiten_webhook_router
from rate_limit import limiter
from routers.breaks import router as breaks_router
from routers.conferences import router as conferences_router
from routers.events import router as events_router
from routers.kaiten_api import router as kaiten_api_router
from routers.schedule import router as logs_router
from routers.schedule_export import router as schedule_export_router
from routers.schedule_placements import router as schedule_placements_router
from routers.schedule_versions import router as schedule_versions_router
from routers.talks import router as talks_router

logger = logging.getLogger(__name__)

LOG_RETENTION_DAYS = int(os.getenv("LOG_RETENTION_DAYS", "30"))
_CLEANUP_INTERVAL = 24 * 3600  # секунд


async def _log_cleanup_loop() -> None:
    """Раз в сутки удаляет записи логов старше LOG_RETENTION_DAYS дней.

    Первый проход — сразу при старте, затем каждые 24 часа.
    При LOG_RETENTION_DAYS=0 чистка отключена.
    """
    while True:
        if LOG_RETENTION_DAYS > 0:
            try:
                cutoff = datetime.now(timezone.utc) - timedelta(days=LOG_RETENTION_DAYS)
                db = SessionLocal()
                try:
                    deleted = db.query(models.Log).filter(models.Log.timestamp < cutoff).delete()
                    db.commit()
                    if deleted:
                        logger.info(
                            "Log cleanup: удалено %d записей старше %d дней",
                            deleted,
                            LOG_RETENTION_DAYS,
                        )
                finally:
                    db.close()
            except Exception as exc:
                logger.warning("Log cleanup error: %s", exc)
        await asyncio.sleep(_CLEANUP_INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_log_cleanup_loop())
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


app = FastAPI(title="CodeFest Schedule API", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.include_router(auth_router)
app.include_router(kaiten_webhook_router)
app.include_router(events_router)
app.include_router(conferences_router)
app.include_router(talks_router)
app.include_router(breaks_router)
app.include_router(logs_router)
app.include_router(schedule_versions_router)
app.include_router(schedule_placements_router)
app.include_router(schedule_export_router)
app.include_router(kaiten_api_router)
