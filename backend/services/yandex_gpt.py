"""
YandexGPT-based schedule generator
====================================

Переменные окружения
--------------------
YANDEX_API_KEY    — API-ключ YandexGPT
YANDEX_FOLDER_ID  — ID каталога Yandex Cloud
YANDEX_MODEL      — модель (default: yandexgpt/latest)
"""

import json
import logging
import os
import re

import httpx

logger = logging.getLogger(__name__)

YANDEX_API_URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"


def call_yandex_gpt(
    talks_data: list[dict],
    halls_data: list[dict],
    days_data: list[dict],
    tracks_data: list[dict],
    conf_name: str,
    conf_city: str,
    system_prompt: str,
) -> tuple[list[dict], str]:
    """
    Вызывает YandexGPT и возвращает (placements, summary).
    placements — список dict с ключами talk_id, day_id, hall_id, start_time (str), reasoning.
    """
    api_key = os.getenv("YANDEX_API_KEY", "")
    folder_id = os.getenv("YANDEX_FOLDER_ID", "")
    model_name = os.getenv("YANDEX_MODEL", "yandexgpt/latest")

    if not api_key or not folder_id:
        raise RuntimeError("YANDEX_API_KEY и YANDEX_FOLDER_ID не заданы")

    model_uri = f"gpt://{folder_id}/{model_name}"

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
        "modelUri": model_uri,
        "completionOptions": {
            "stream": False,
            "temperature": 0.3,
            "maxTokens": 8000,
        },
        "messages": [
            {"role": "system", "text": system_prompt},
            {"role": "user", "text": user_message},
        ],
    }

    with httpx.Client(timeout=120) as client:
        resp = client.post(
            YANDEX_API_URL,
            json=payload,
            headers={"Authorization": f"Api-Key {api_key}"},
        )
        if not resp.is_success:
            logger.error("YandexGPT HTTP %s: %s", resp.status_code, resp.text[:1000])
            raise RuntimeError(f"YandexGPT {resp.status_code}: {resp.text[:500]}")

    result = resp.json()
    text = result["result"]["alternatives"][0]["message"]["text"]
    logger.debug("YandexGPT raw response: %s", text[:500])

    json_match = re.search(r'\{[\s\S]*\}', text)
    if not json_match:
        raise ValueError(f"YandexGPT не вернул JSON. Ответ: {text[:300]}")

    parsed = json.loads(json_match.group())
    return parsed.get("placements", []), parsed.get("summary", "")
