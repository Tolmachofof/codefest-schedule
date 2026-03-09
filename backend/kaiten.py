"""
Kaiten webhook integration
==========================

Создаёт доклад в «Нужно распределить» при переводе карточки
в заданный столбец (статус) Kaiten.

Переменные окружения
--------------------
KAITEN_WEBHOOK_SECRET   — секрет для проверки HMAC-подписи (опционально).
                          Если не задан — подпись не проверяется.
KAITEN_TARGET_COLUMN_ID — ID столбца Kaiten, при переводе в который
                          создаётся доклад. Если не задан — реагируем
                          на любое перемещение карточки.
KAITEN_CONFERENCE_ID    — ID конференции в нашей БД, куда добавляются доклады.

Как настроить вебхук в Kaiten
------------------------------
Kaiten → Настройки пространства → Вебхуки → Добавить вебхук
  URL:    https://<your-domain>/integrations/kaiten/webhook
  Метод:  POST
  События: card_moved (или все — лишние будут игнорироваться)

Отладка
-------
GET  /integrations/kaiten/config  — текущие настройки (без секрета)
POST /integrations/kaiten/echo    — возвращает входящий payload как есть
"""

import hashlib
import hmac
import json
import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

import models
from database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrations/kaiten", tags=["kaiten"])

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

WEBHOOK_SECRET: str = os.getenv("KAITEN_WEBHOOK_SECRET", "")
TARGET_COLUMN_ID: str = os.getenv("KAITEN_TARGET_COLUMN_ID", "")
CONFERENCE_ID: int = int(os.getenv("KAITEN_CONFERENCE_ID", "0"))

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _verify_signature(body: bytes, header: str | None) -> bool:
    """Проверяем HMAC-SHA256, если секрет задан."""
    if not WEBHOOK_SECRET:
        return True
    if not header:
        return False
    expected = hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    # Kaiten отправляет "sha256=<hex>" или просто "<hex>"
    received = header.removeprefix("sha256=")
    return hmac.compare_digest(expected, received)


def _extract(payload: dict[str, Any]) -> tuple[dict | None, dict | None]:
    """
    Извлекаем card и целевой column из payload.

    Kaiten может присылать несколько вариантов структуры:
      1. { "type": "card_moved", "card": {...}, "column": {...} }
      2. { "type": "card_moved", "card": {...}, "to_column": {...} }
      3. { "type": "card_moved", "data": { "card": {...}, "to_column": {...} } }
    Обрабатываем все три.
    """
    # Плоская структура
    card: dict | None = payload.get("card")
    column: dict | None = payload.get("to_column") or payload.get("column")

    # Вложенная в "data"
    if not card:
        data: dict = payload.get("data") or {}
        card = data.get("card")
        column = data.get("to_column") or data.get("column")

    # Иногда column приходит внутри card
    if card and not column:
        column = card.get("column")

    return card, column


def _create_talk(title: str, card_id: Any, db: Session) -> models.Talk:
    conference = db.get(models.Conference, CONFERENCE_ID)
    if not conference:
        raise HTTPException(
            status_code=400,
            detail=f"Конференция с id={CONFERENCE_ID} не найдена. "
                   "Проверьте KAITEN_CONFERENCE_ID.",
        )
    if not conference.days:
        raise HTTPException(
            status_code=400,
            detail="У конференции нет дней — невозможно создать доклад.",
        )

    day = conference.days[0]
    talk = models.Talk(title=title, day_id=day.id)
    db.add(talk)
    db.flush()
    db.add(models.Log(
        action=f"Kaiten: создан доклад «{title}» (карточка #{card_id})"
    ))
    db.commit()
    db.refresh(talk)
    logger.info("Kaiten: создан доклад id=%d «%s»", talk.id, title)
    return talk


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/webhook")
async def kaiten_webhook(
    request: Request,
    x_kaiten_signature: str | None = Header(None),
    x_hub_signature_256: str | None = Header(None),
    db: Session = Depends(get_db),
):
    body = await request.body()
    signature = x_kaiten_signature or x_hub_signature_256

    if not _verify_signature(body, signature):
        raise HTTPException(status_code=401, detail="Неверная подпись вебхука")

    try:
        payload: dict[str, Any] = json.loads(body)
    except Exception:
        raise HTTPException(status_code=400, detail="Невалидный JSON")

    event_type: str = (
        payload.get("type")
        or payload.get("event")
        or payload.get("event_type")
        or ""
    )
    logger.debug("Kaiten webhook event_type=%r", event_type)

    # Игнорируем события, не связанные с перемещением карточки
    MOVE_EVENTS = {"card_moved", "card_condition_changed", "card_column_changed", ""}
    if event_type and event_type not in MOVE_EVENTS:
        return {"status": "ignored", "reason": f"event_type={event_type!r}"}

    card, column = _extract(payload)

    if not card:
        logger.debug("Kaiten webhook: карточка не найдена в payload, игнорируем")
        return {"status": "ignored", "reason": "no card in payload"}

    if not column:
        logger.debug("Kaiten webhook: столбец не найден в payload, игнорируем")
        return {"status": "ignored", "reason": "no column in payload"}

    # Проверяем целевой столбец
    column_id = str(column.get("id", ""))
    if TARGET_COLUMN_ID and column_id != TARGET_COLUMN_ID:
        return {
            "status": "ignored",
            "reason": f"column_id={column_id!r} != target={TARGET_COLUMN_ID!r}",
        }

    if not CONFERENCE_ID:
        raise HTTPException(
            status_code=500,
            detail="KAITEN_CONFERENCE_ID не задан в переменных окружения",
        )

    title = (card.get("title") or "").strip()
    if not title:
        return {"status": "ignored", "reason": "пустой заголовок карточки"}

    talk = _create_talk(title, card.get("id"), db)
    return {"status": "created", "talk_id": talk.id, "title": talk.title}


@router.get("/config")
def kaiten_config():
    """Показывает текущие настройки интеграции (без секрета)."""
    return {
        "conference_id": CONFERENCE_ID,
        "target_column_id": TARGET_COLUMN_ID or "(любой)",
        "signature_verification": bool(WEBHOOK_SECRET),
    }


@router.post("/echo")
async def kaiten_echo(request: Request):
    """Отладочный эндпоинт — возвращает входящий payload как есть."""
    try:
        return await request.json()
    except Exception:
        return {"raw": (await request.body()).decode(errors="replace")}
