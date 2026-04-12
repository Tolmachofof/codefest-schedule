"""
GigaChat-based schedule generator
==================================

Вызывает GigaChat (Sber) для умного распределения докладов по залам и времени.

Переменные окружения
--------------------
GIGACHAT_CREDENTIALS  — base64(client_id:secret), получить в личном кабинете Sber
GIGACHAT_SCOPE        — GIGACHAT_API_PERS (личный) или GIGACHAT_API_CORP (корп.), default: GIGACHAT_API_PERS
GIGACHAT_MODEL        — модель (default: GigaChat-Pro)
GIGACHAT_CA_BUNDLE    — путь к CA-bundle для верификации SSL (default: certs/sber_ca_bundle.pem рядом с модулем)
"""

import json
import logging
import os
import re
import uuid
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

GIGACHAT_AUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
GIGACHAT_API_URL = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions"

_DEFAULT_CA_BUNDLE = Path(__file__).parent / "certs" / "sber_ca_bundle.pem"


def _ssl_verify() -> str | bool:
    """Возвращает путь к CA-bundle или False если явно отключено через env."""
    ca = os.getenv("GIGACHAT_CA_BUNDLE", str(_DEFAULT_CA_BUNDLE))
    if ca.lower() == "false":
        logger.warning("SSL-верификация GigaChat отключена через GIGACHAT_CA_BUNDLE=false")
        return False
    if Path(ca).exists():
        return ca
    logger.warning("CA-bundle не найден: %s — SSL-верификация отключена", ca)
    return False


def _get_token() -> str:
    credentials = os.getenv("GIGACHAT_CREDENTIALS", "")
    if not credentials:
        raise RuntimeError("GIGACHAT_CREDENTIALS не задан")

    scope = os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")

    with httpx.Client(verify=_ssl_verify(), timeout=30) as client:
        resp = client.post(
            GIGACHAT_AUTH_URL,
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
                "RqUID": str(uuid.uuid4()),
            },
            data={"scope": scope},
        )
        if not resp.is_success:
            logger.error("GigaChat auth HTTP %s: %s", resp.status_code, resp.text[:500])
            raise RuntimeError(f"GigaChat auth {resp.status_code}: {resp.text[:300]}")

    return resp.json()["access_token"]


def call_gigachat(
    talks_data: list[dict],
    halls_data: list[dict],
    days_data: list[dict],
    tracks_data: list[dict],
    conf_name: str,
    conf_city: str,
    system_prompt: str,
) -> tuple[list[dict], str]:
    """
    Вызывает GigaChat и возвращает (placements, summary).
    placements — список dict с ключами talk_id, day_id, hall_id, start_time (str), reasoning.
    """
    model = os.getenv("GIGACHAT_MODEL", "GigaChat-Pro")
    token = _get_token()

    tracks_section = (
        f"Треки конференции:\n{json.dumps(tracks_data, ensure_ascii=False)}\n\n"
    ) if tracks_data else ""

    user_message = (
        f"Конференция: {conf_name}, г. {conf_city}\n\n"
        f"Залы:\n{json.dumps(halls_data, ensure_ascii=False, indent=2)}\n\n"
        f"Дни и перерывы (время HH:MM):\n{json.dumps(days_data, ensure_ascii=False, indent=2)}\n\n"
        f"{tracks_section}"
        f"Доклады для распределения:\n{json.dumps(talks_data, ensure_ascii=False, indent=2)}\n\n"
        "Расставь все доклады. Не пропускай ни один."
    )

    payload = {
        "model": model,
        "temperature": 0.3,
        "max_tokens": 8000,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
    }

    with httpx.Client(verify=_ssl_verify(), timeout=300) as client:
        resp = client.post(
            GIGACHAT_API_URL,
            json=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )
        if not resp.is_success:
            logger.error("GigaChat HTTP %s: %s", resp.status_code, resp.text[:1000])
            raise RuntimeError(f"GigaChat {resp.status_code}: {resp.text[:500]}")

    result = resp.json()
    text = result["choices"][0]["message"]["content"]
    logger.debug("GigaChat raw response: %s", text[:500])

    json_match = re.search(r'\{[\s\S]*\}', text)
    if not json_match:
        raise ValueError(f"GigaChat не вернул JSON. Ответ: {text[:300]}")

    parsed = json.loads(json_match.group())
    return parsed.get("placements", []), parsed.get("summary", "")
