"""Unit tests for services/kaiten_service.py — no DB, no HTTP."""
from types import SimpleNamespace

import pytest

from services.kaiten_service import (
    extract_card_field,
    match_track,
    parse_description_fields,
    parse_speaker_from_card_title,
    prop_val_to_str,
)


def make_track(track_id, name):
    return SimpleNamespace(id=track_id, name=name)


# ---------------------------------------------------------------------------
# parse_description_fields
# ---------------------------------------------------------------------------

class TestParseDescriptionFields:
    CFP_TEMPLATE = """
**Тема**
Микросервисы на практике

**Тезисы**
Разберём, как правильно дробить монолит.
Поговорим о подводных камнях.

**БИО**
10 лет в разработке, спикер конференций.

**Компания:** Яндекс
**Должность:** Senior Engineer
**Основной трек:** Backend
**Дополнительный трек:** DevOps
**Формат выступления:** Доклад
**Уровень сложности:** Senior
"""

    def test_parses_talk_title(self):
        result = parse_description_fields(self.CFP_TEMPLATE)
        assert result["talk_title"] == "Микросервисы на практике"

    def test_parses_description(self):
        result = parse_description_fields(self.CFP_TEMPLATE)
        assert "монолит" in result["description"]

    def test_parses_bio(self):
        result = parse_description_fields(self.CFP_TEMPLATE)
        assert "10 лет" in result["speaker_bio"]

    def test_parses_company(self):
        result = parse_description_fields(self.CFP_TEMPLATE)
        assert result["speaker_company"] == "Яндекс"

    def test_parses_position(self):
        result = parse_description_fields(self.CFP_TEMPLATE)
        assert result["speaker_position"] == "Senior Engineer"

    def test_parses_primary_track(self):
        result = parse_description_fields(self.CFP_TEMPLATE)
        assert result["primary_track"] == "Backend"

    def test_parses_additional_track(self):
        result = parse_description_fields(self.CFP_TEMPLATE)
        assert result["additional_track"] == "DevOps"

    def test_parses_talk_format(self):
        result = parse_description_fields(self.CFP_TEMPLATE)
        assert result["talk_format"] == "Доклад"

    def test_parses_speaker_level_senior(self):
        result = parse_description_fields(self.CFP_TEMPLATE)
        assert result["speaker_level"] == "senior"

    def test_parses_speaker_level_junior(self):
        result = parse_description_fields("**Уровень сложности:** Junior")
        assert result["speaker_level"] == "junior"

    def test_parses_speaker_level_middle(self):
        result = parse_description_fields("**Уровень сложности:** Intermediate")
        assert result["speaker_level"] == "middle"

    def test_parses_speaker_level_keynote(self):
        result = parse_description_fields("**Уровень сложности:** Keynote")
        assert result["speaker_level"] == "keynote"

    def test_empty_string_returns_empty(self):
        assert parse_description_fields("") == {}

    def test_none_returns_empty(self):
        assert parse_description_fields(None) == {}

    def test_partial_template(self):
        raw = "**Компания:** Сбер\n**Должность:** CTO"
        result = parse_description_fields(raw)
        assert result["speaker_company"] == "Сбер"
        assert result["speaker_position"] == "CTO"
        assert "talk_title" not in result


# ---------------------------------------------------------------------------
# parse_speaker_from_card_title
# ---------------------------------------------------------------------------

class TestParseSpeakerFromCardTitle:
    def test_full_format(self):
        name, company = parse_speaker_from_card_title("Иван Иванов (Яндекс) — Доклад о чём-то")
        assert name == "Иван Иванов"
        assert company == "Яндекс"

    def test_pipe_separator(self):
        name, company = parse_speaker_from_card_title("Пётр Петров (СБЕР) | Kubernetes в продакшне")
        assert name == "Пётр Петров"
        assert company == "СБЕР"

    def test_no_company(self):
        name, company = parse_speaker_from_card_title("Иван Иванов — Доклад")
        assert name == "Иван Иванов"
        assert company is None

    def test_no_separator_returns_none(self):
        name, company = parse_speaker_from_card_title("Просто заголовок карточки")
        assert name is None
        assert company is None

    def test_format_prefix_stripped(self):
        name, company = parse_speaker_from_card_title("Доклад: Иван Иванов (Mail) — Тема")
        assert name == "Иван Иванов"
        assert company == "Mail"


# ---------------------------------------------------------------------------
# match_track
# ---------------------------------------------------------------------------

class TestMatchTrack:
    def _tracks(self):
        return [
            make_track(1, "Backend"),
            make_track(2, "Frontend"),
            make_track(3, "DevOps"),
            make_track(4, "Machine Learning"),
        ]

    def test_exact_match(self):
        result = match_track("Backend", self._tracks())
        assert result.id == 1

    def test_case_insensitive(self):
        result = match_track("backend", self._tracks())
        assert result.id == 1

    def test_substring_match(self):
        result = match_track("Machine Learning и AI", self._tracks())
        assert result.id == 4

    def test_no_match_returns_none(self):
        result = match_track("Квантовые вычисления", self._tracks())
        assert result is None

    def test_none_input_returns_none(self):
        assert match_track(None, self._tracks()) is None

    def test_empty_tracks_returns_none(self):
        assert match_track("Backend", []) is None

    def test_trailing_dot_ignored(self):
        result = match_track("Backend.", self._tracks())
        assert result.id == 1


# ---------------------------------------------------------------------------
# extract_card_field
# ---------------------------------------------------------------------------

class TestExtractCardField:
    def _card(self):
        return {
            "title": "Мой доклад",
            "description": "  Описание доклада  ",
            "responsible": [{"full_name": "Иван Иванов"}],
            "members": [{"full_name": "Петров"}, {"full_name": "Сидоров"}],
            "tags": [{"name": "python"}, {"name": "fastapi"}],
            "size": 5,
            "type": {"name": "Story"},
            "lane": {"title": "В работе"},
            "due_date": "2025-06-01",
            "external_url": "https://example.com",
            "custom_id": 42,
            "properties": {"speed": "fast", "color": None},
        }

    def test_none_field_returns_none(self):
        assert extract_card_field(self._card(), None) is None

    def test_title(self):
        assert extract_card_field(self._card(), "title") == "Мой доклад"

    def test_description_stripped(self):
        assert extract_card_field(self._card(), "description") == "Описание доклада"

    def test_responsible_full_name(self):
        assert extract_card_field(self._card(), "responsible.full_name") == "Иван Иванов"

    def test_members_full_name_joined(self):
        result = extract_card_field(self._card(), "members.full_name")
        assert result == "Петров, Сидоров"

    def test_tags_joined(self):
        assert extract_card_field(self._card(), "tags") == "python, fastapi"

    def test_size(self):
        assert extract_card_field(self._card(), "size") == "5"

    def test_type_name(self):
        assert extract_card_field(self._card(), "type.name") == "Story"

    def test_lane_title(self):
        assert extract_card_field(self._card(), "lane.title") == "В работе"

    def test_due_date(self):
        assert extract_card_field(self._card(), "due_date") == "2025-06-01"

    def test_external_url(self):
        assert extract_card_field(self._card(), "external_url") == "https://example.com"

    def test_custom_id(self):
        assert extract_card_field(self._card(), "custom_id") == "42"

    def test_prop_dict_existing(self):
        assert extract_card_field(self._card(), "prop:speed") == "fast"

    def test_prop_none_value_returns_none(self):
        assert extract_card_field(self._card(), "prop:color") is None

    def test_responsible_as_dict(self):
        card = {**self._card(), "responsible": {"full_name": "Одиночный"}}
        assert extract_card_field(card, "responsible.full_name") == "Одиночный"

    def test_responsible_empty_list(self):
        card = {**self._card(), "responsible": []}
        assert extract_card_field(card, "responsible.full_name") is None


# ---------------------------------------------------------------------------
# prop_val_to_str
# ---------------------------------------------------------------------------

class TestPropValToStr:
    def test_none(self):
        assert prop_val_to_str(None) is None

    def test_int(self):
        assert prop_val_to_str(42) == "42"

    def test_bool_true(self):
        assert prop_val_to_str(True) == "true"

    def test_string(self):
        assert prop_val_to_str("hello") == "hello"

    def test_empty_string_returns_none(self):
        assert prop_val_to_str("  ") is None

    def test_dict_with_value(self):
        assert prop_val_to_str({"value": "foo"}) == "foo"

    def test_list_of_dicts(self):
        result = prop_val_to_str([{"value": "a"}, {"title": "b"}])
        assert result == "a, b"
