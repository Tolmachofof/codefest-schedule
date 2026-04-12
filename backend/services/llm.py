"""
LLM dispatcher для генерации расписания.

Маршрутизирует запрос к нужному провайдеру (YandexGPT или GigaChat)
и формирует системный промпт с жёсткими техническими правилами.

Переменные окружения
--------------------
LLM_PROVIDER — провайдер: "yandex" (default) или "gigachat"
"""

import logging
import os

logger = logging.getLogger(__name__)

LLM_PROVIDER_YANDEX = "yandex"
LLM_PROVIDER_GIGACHAT = "gigachat"

DEFAULT_SCHEDULE_PROMPT = (
    "Ты — алгоритм автоматического составления расписания конференций.\n"
    "Распредели ВСЕ доклады по залам и времени, соблюдая правила:\n"
    "1. Доклады с высокими оценками (relevance, mass_appeal) → прайм-тайм (10:00–12:00 и 14:00–16:00).\n"
    "2. Высокая массовость (mass_appeal=4–5) → залы большей вместимости.\n"
    "3. Keynote/senior спикеры и высокий speaker_experience → лучшие слоты и большие залы.\n"
    "4. Доклады одного трека — не ставить параллельно (разные залы в одно время).\n"
    "5. Прогрессия сложности: низкая применимость (applicability) → вдохновение в начале, высокая → практика ближе к концу.\n"
    "6. После 13:00 — доклады с высокой applicability (практические, toolkit).\n"
    "7. Не ставить доклады на время перерывов.\n"
    "8. Учитывай duration_minutes каждого доклада — это длина слота.\n"
    "9. Рабочее время: 10:00–18:00.\n"
    "10. Между последовательными докладами в одном зале ОБЯЗАТЕЛЬНО оставляй 20 минут перерыва "
    "(например, если доклад заканчивается в 10:40, следующий начинается не раньше 11:00).\n"
    "11. Кейнот (speaker_level=keynote) — это пленарный доклад для всей аудитории: ставь его в главный зал "
    "(с наибольшей вместимостью), а в это же время НЕ ставь НИКАКИХ других докладов ни в одном зале.\n\n"
    "Оценки 1–5: relevance (актуальность), novelty (новизна), applicability (применимость), "
    "mass_appeal (массовость), speaker_experience (опыт спикера). null = не указано.\n"
    "У каждого доклада есть: title (тема), description (тезисы), "
    "speaker_name, speaker_level (junior/middle/senior/keynote), speaker_company, speaker_position, speaker_bio — "
    "используй эти данные для оценки глубины доклада, аудитории и подбора слота. "
    "Например: senior-спикер из известной компании с высоким speaker_experience → прайм-тайм; "
    "вводный доклад (низкий applicability) → утро; практический (высокий applicability) → после обеда.\n"
    "У докладов есть поля currently_placed, current_day, current_hall_id, current_start_time — "
    "текущее размещение, можешь использовать как подсказку, но можешь переставить если нужно для лучшего расписания."
)

_HARD_RULES = (
    "\n\nОБЯЗАТЕЛЬНЫЕ ТЕХНИЧЕСКИЕ ПРАВИЛА (приоритет выше любых других критериев):\n"
    "- Доклад с lvl=keynote — пленарный. Ставь его в зал с наибольшей вместимостью. "
    "В то же самое время НЕ ставь НИ ОДИН другой доклад ни в каком другом зале.\n"
    "- Каждый доклад размещается ровно один раз.\n"
    "- Не ставь доклады на время перерывов.\n"
)

_JSON_SCHEMA_FULL = (
    "Верни ТОЛЬКО JSON без markdown-блоков и без пояснений вне JSON:\n"
    "{\n"
    '  "placements": [\n'
    '    {"talk_id": <int>, "day_id": <int>, "hall_id": <int>, "start_time": "HH:MM"}\n'
    "  ],\n"
    '  "summary": "<общее описание логики расписания>"\n'
    "}"
)

_JSON_SCHEMA_COMPACT = (
    "Верни ТОЛЬКО JSON без markdown-блоков и пояснений:\n"
    '{"placements":[{"talk_id":<int>,"day_id":<int>,"hall_id":<int>,"start_time":"HH:MM"}]}'
)


def call_llm(
    talks_data: list[dict],
    halls_data: list[dict],
    days_data: list[dict],
    tracks_data: list[dict],
    conf_name: str,
    conf_city: str,
    custom_prompt: str | None = None,
    provider: str | None = None,
) -> tuple[list[dict], str]:
    """Вызывает нужный LLM-провайдер и возвращает (placements, summary).

    provider переопределяет env LLM_PROVIDER.
    """
    provider = (provider or os.getenv("LLM_PROVIDER", LLM_PROVIDER_YANDEX)).lower()
    criteria = custom_prompt if custom_prompt else DEFAULT_SCHEDULE_PROMPT

    if provider == LLM_PROVIDER_GIGACHAT:
        from gigachat import call_gigachat
        logger.info("Используем GigaChat для генерации расписания")
        prompt = criteria.rstrip() + _HARD_RULES + "\n" + _JSON_SCHEMA_COMPACT
        return call_gigachat(talks_data, halls_data, days_data, tracks_data, conf_name, conf_city, prompt)

    from services.yandex_gpt import call_yandex_gpt
    logger.info("Используем YandexGPT для генерации расписания")
    prompt = criteria.rstrip() + _HARD_RULES + "\n" + _JSON_SCHEMA_FULL
    return call_yandex_gpt(talks_data, halls_data, days_data, tracks_data, conf_name, conf_city, prompt)
