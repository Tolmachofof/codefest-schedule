import json
import os
import re

from fastapi import HTTPException
from sqlalchemy.orm import Session

import models


def kaiten_credentials() -> tuple[str, str]:
    """Return (base_url, token) from environment variables."""
    base_url = os.environ.get("KAITEN_BASE_URL", "").rstrip("/")
    token = os.environ.get("KAITEN_TOKEN", "")
    if not base_url or not token:
        raise HTTPException(
            status_code=503,
            detail="KAITEN_BASE_URL и KAITEN_TOKEN не заданы в переменных окружения",
        )
    return base_url, token


def get_kaiten_settings(conference_id: int, db: Session) -> models.KaitenSettings | None:
    return (
        db.query(models.KaitenSettings)
        .filter(models.KaitenSettings.conference_id == conference_id)
        .first()
    )


def prop_val_to_str(val) -> str | None:
    if val is None:
        return None
    if isinstance(val, bool):
        return str(val).lower()
    if isinstance(val, (int, float)):
        return str(val)
    if isinstance(val, str):
        return val.strip() or None
    if isinstance(val, dict):
        text = val.get("value") or val.get("title") or val.get("name") or val.get("full_name") or ""
        return str(text).strip() or None
    if isinstance(val, list):
        parts = []
        for item in val:
            if isinstance(item, dict):
                text = item.get("value") or item.get("title") or item.get("name") or item.get("full_name") or ""
                if text:
                    parts.append(str(text))
            else:
                parts.append(str(item))
        return ", ".join(parts) or None
    return str(val).strip() or None


def parse_description_fields(raw: str | None) -> dict:
    """Parse structured Kaiten description (CFP template) into separate talk fields."""
    if not raw:
        return {}

    result: dict = {}

    m = re.search(r'\*\*Тезисы\*\*\s*\n(.*?)(?=\n\*\*|\n---|\Z)', raw, re.DOTALL)
    if m:
        result['description'] = m.group(1).strip()

    m = re.search(r'\*\*БИО\*\*\s*\n(.*?)(?=\n\*\*|\n---|\Z)', raw, re.DOTALL)
    if m:
        result['speaker_bio'] = m.group(1).strip()

    m = re.search(r'\*\*Компания:\*\*\s*(.+)', raw)
    if m:
        result['speaker_company'] = m.group(1).strip()

    m = re.search(r'\*\*Должность:\*\*\s*(.+)', raw)
    if m:
        result['speaker_position'] = m.group(1).strip()

    m = re.search(r'\*\*Тема\*\*\s*\n(.+?)(?=\n\n|\n\*\*|\Z)', raw, re.DOTALL)
    if m:
        result['talk_title'] = m.group(1).strip()

    m = re.search(r'\*\*Основной трек:\*\*\s*(.+)', raw)
    if m:
        result['primary_track'] = m.group(1).strip().rstrip('.')

    m = re.search(r'\*\*Дополнительный трек\*\*:?\s*(.+)', raw)
    if not m:
        m = re.search(r'\*\*Дополнительный трек:\*\*\s*(.+)', raw)
    if m:
        result['additional_track'] = m.group(1).strip().rstrip('.')

    m = re.search(r'\*\*Формат выступления:\*\*\s*(.+)', raw)
    if m:
        result['talk_format'] = m.group(1).strip()

    m = re.search(r'\*\*Уровень сложности:\*\*\s*(.+)', raw)
    if m:
        lvl = m.group(1).strip().lower()
        if 'junior' in lvl or 'начинающ' in lvl:
            result['speaker_level'] = 'junior'
        elif 'intermediate' in lvl or 'средн' in lvl:
            result['speaker_level'] = 'middle'
        elif 'senior' in lvl or 'продвинут' in lvl or 'expert' in lvl or 'эксперт' in lvl:
            result['speaker_level'] = 'senior'
        elif 'keynote' in lvl:
            result['speaker_level'] = 'keynote'

    return result


def parse_speaker_from_card_title(card_title: str) -> tuple[str | None, str | None]:
    """Parse 'Name (Company) — Talk title'. Returns (speaker_name, company)."""
    clean = re.sub(r'^[А-ЯЁA-Z][^:]{0,15}:\s*', '', card_title).strip()
    parts = re.split(r'\s*[—|]\s*', clean, maxsplit=1)
    if len(parts) < 2:
        return None, None
    left = parts[0].strip()
    company_m = re.search(r'\(([^)]+)\)', left)
    company = company_m.group(1).strip() if company_m else None
    name = re.sub(r'\s*\([^)]+\)', '', left).strip()
    return name or None, company


def match_track(name: str | None, tracks: list) -> "models.Track | None":
    """Fuzzy match a track name string to a Track object."""
    if not name or not tracks:
        return None

    def normalize(s: str) -> str:
        s = s.lower().strip().rstrip('.')
        s = re.sub(r'[^\w\s]', '', s)
        return re.sub(r'\s+', ' ', s)

    norm_name = normalize(name)

    for t in tracks:
        if normalize(t.name) == norm_name:
            return t

    for t in tracks:
        nt = normalize(t.name)
        if nt in norm_name or norm_name in nt:
            return t

    name_words = set(norm_name.split())
    best_score, best_track = 0.0, None
    for t in tracks:
        track_words = set(normalize(t.name).split())
        if not track_words:
            continue
        overlap = len(name_words & track_words)
        score = overlap / max(len(name_words), len(track_words))
        if score > best_score:
            best_score, best_track = score, t

    return best_track if best_score >= 0.5 else None


def extract_card_field(card: dict, field_id: str | None) -> str | None:
    if not field_id:
        return None
    if field_id == "title":
        return card.get("title") or None
    if field_id == "description":
        val = card.get("description") or ""
        return val.strip() or None
    if field_id == "responsible.full_name":
        resp = card.get("responsible") or []
        if isinstance(resp, list):
            return resp[0].get("full_name") if resp else None
        if isinstance(resp, dict):
            return resp.get("full_name") or None
        return None
    if field_id == "members.full_name":
        members = card.get("members") or []
        names = [m.get("full_name", "") for m in members if m.get("full_name")]
        return ", ".join(names) or None
    if field_id == "tags":
        tags = card.get("tags") or []
        names = [t.get("name", "") for t in tags if t.get("name")]
        return ", ".join(names) or None
    if field_id == "size":
        val = card.get("size")
        return str(val) if val is not None else None
    if field_id == "type.name":
        t = card.get("type") or {}
        return t.get("name") or None
    if field_id == "lane.title":
        lane = card.get("lane") or {}
        return lane.get("title") or None
    if field_id == "due_date":
        return card.get("due_date") or None
    if field_id == "external_url":
        return card.get("external_url") or None
    if field_id == "custom_id":
        return str(card["custom_id"]).strip() if card.get("custom_id") is not None else None
    if field_id == "blocked_reason":
        return card.get("blocked_reason") or None
    if field_id.startswith("prop:"):
        prop_key = field_id[5:]
        props = card.get("properties")
        if isinstance(props, dict):
            val = props.get(prop_key)
            return prop_val_to_str(val) if val is not None else None
        if isinstance(props, list):
            try:
                prop_id = int(prop_key)
            except ValueError:
                return None
            for p in props:
                if not isinstance(p, dict):
                    continue
                if p.get("id") == prop_id:
                    return prop_val_to_str(p.get("value"))
        return None
    return None
