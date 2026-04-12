"""Сериализация данных конференции для передачи в LLM."""

import models


def serialize_talk(t: models.Talk, track_name_map: dict, truncate_desc: bool = True) -> dict:
    """Сериализует доклад для LLM, пропуская пустые поля."""
    d: dict = {
        "id": t.id,
        "title": t.title,
        "dur": t.duration_minutes or 40,
        "lvl": t.speaker_level or "middle",
    }
    if t.description:
        d["desc"] = t.description[:300] if truncate_desc else t.description[:700]
    if t.speaker_company:
        d["company"] = t.speaker_company
    if t.speaker_position:
        d["position"] = t.speaker_position
    primary = track_name_map.get(t.primary_track_id) if t.primary_track_id else None
    if primary:
        d["track"] = primary
    extra = [
        track_name_map[tr.id]
        for tr in t.tracks
        if tr.id in track_name_map and track_name_map[tr.id] != primary
    ]
    if extra:
        d["tracks"] = extra
    for src, dst in (
        ("relevance", "rel"),
        ("novelty", "nov"),
        ("applicability", "app"),
        ("mass_appeal", "mass"),
        ("speaker_experience", "exp"),
    ):
        val = getattr(t, src)
        if val is not None:
            d[dst] = val
    return d


def build_llm_payload(
    talks: list[models.Talk],
    halls: list[models.Hall],
    days: list[models.ConferenceDay],
    tracks: list[models.Track],
    truncate_desc: bool = True,
) -> tuple[list[dict], list[dict], list[dict], list[str]]:
    """Возвращает (talks_data, halls_data, days_data, tracks_data) для call_llm."""
    track_name_map = {t.id: t.name for t in tracks}
    talks_data = [serialize_talk(t, track_name_map, truncate_desc=truncate_desc) for t in talks]
    halls_data = [{"id": h.id, "name": h.name, "capacity": h.capacity} for h in halls]
    days_data = [{"id": d.id, "date": d.date.isoformat(), "breaks": []} for d in days]
    tracks_data = [t.name for t in tracks]
    return talks_data, halls_data, days_data, tracks_data
