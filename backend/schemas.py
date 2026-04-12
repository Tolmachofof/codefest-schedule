from datetime import date, datetime, time
from pydantic import BaseModel, Field, model_validator, field_validator
# Note: `time` is still used by Break and Placement schemas below


class TrackBase(BaseModel):
    id: int | None = None  # присутствует при обновлении существующего трека
    name: str = Field(min_length=1, max_length=100)
    slots: int = Field(ge=0)


class TrackOut(TrackBase):
    id: int

    model_config = {"from_attributes": True}


class HallBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    capacity: int = Field(ge=1)


class HallOut(HallBase):
    id: int

    model_config = {"from_attributes": True}


class UnassignedTalkCreate(BaseModel):
    title: str
    primary_track_id: int | None = None
    track_ids: list[int] = []
    speaker_name: str | None = None
    speaker_level: str | None = None
    speaker_company: str | None = None
    speaker_position: str | None = None
    speaker_bio: str | None = None
    description: str | None = None
    talk_format: str | None = None
    duration_minutes: int = Field(default=40, ge=5, le=480)
    relevance: int | None = Field(default=None, ge=1, le=5)
    novelty: int | None = Field(default=None, ge=1, le=5)
    applicability: int | None = Field(default=None, ge=1, le=5)
    mass_appeal: int | None = Field(default=None, ge=1, le=5)
    speaker_experience: int | None = Field(default=None, ge=1, le=5)


class TalkUpdate(BaseModel):
    title: str | None = None
    primary_track_id: int | None = None
    track_ids: list[int] | None = None
    speaker_name: str | None = None
    speaker_level: str | None = None
    speaker_company: str | None = None
    speaker_position: str | None = None
    speaker_bio: str | None = None
    description: str | None = None
    talk_format: str | None = None
    duration_minutes: int | None = Field(default=None, ge=5, le=480)
    relevance: int | None = Field(default=None, ge=1, le=5)
    novelty: int | None = Field(default=None, ge=1, le=5)
    applicability: int | None = Field(default=None, ge=1, le=5)
    mass_appeal: int | None = Field(default=None, ge=1, le=5)
    speaker_experience: int | None = Field(default=None, ge=1, le=5)


class TalkOut(BaseModel):
    id: int
    title: str
    day_id: int
    primary_track_id: int | None = None
    track_ids: list[int] = []
    speaker_name: str | None = None
    speaker_level: str | None = None
    speaker_company: str | None = None
    speaker_position: str | None = None
    speaker_bio: str | None = None
    description: str | None = None
    talk_format: str | None = None
    duration_minutes: int = 40
    relevance: int | None = None
    novelty: int | None = None
    applicability: int | None = None
    mass_appeal: int | None = None
    speaker_experience: int | None = None
    kaiten_card_id: str | None = None

    model_config = {"from_attributes": True}


class BreakCreate(BaseModel):
    hall_id: int
    start_time: time
    end_time: time

    @model_validator(mode="after")
    def check_times(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be > start_time")
        return self


class BreakUpdate(BaseModel):
    hall_id: int | None = None
    day_id: int | None = None
    start_time: time | None = None
    end_time: time | None = None

    @model_validator(mode="after")
    def check_times(self):
        if self.start_time and self.end_time and self.end_time <= self.start_time:
            raise ValueError("end_time must be > start_time")
        return self


class BreakOut(BaseModel):
    id: int
    hall_id: int
    start_time: time
    end_time: time

    model_config = {"from_attributes": True}


class DayOut(BaseModel):
    id: int
    date: date
    talks: list[TalkOut]
    breaks: list[BreakOut]

    model_config = {"from_attributes": True}


class ConferenceBase(BaseModel):
    name: str
    city: str
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def check_dates(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be >= start_date")
        return self


class ConferenceCreate(ConferenceBase):
    tracks: list[TrackBase] = []


class ConferenceUpdate(BaseModel):
    name: str | None = None
    city: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    tracks: list[TrackBase] | None = None

    @model_validator(mode="after")
    def check_dates(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must be >= start_date")
        return self


class ConferenceSummary(ConferenceBase):
    """Лёгкая версия без вложенных дней/докладов/перерывов — для списка конференций."""
    id: int
    tracks: list[TrackOut]
    halls: list[HallOut]

    model_config = {"from_attributes": True}


class ConferenceOut(ConferenceSummary):
    days: list[DayOut]


class LogOut(BaseModel):
    id: int
    timestamp: datetime
    action: str

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Kaiten integration
# ---------------------------------------------------------------------------

class KaitenBoardConfig(BaseModel):
    space_id: int | None = None
    board_id: int | None = None
    column_id: int | None = None
    space_name: str | None = None
    board_name: str | None = None
    column_name: str | None = None


class KaitenSettingsIn(BaseModel):
    boards: list[KaitenBoardConfig] | None = None
    field_mapping: dict[str, str | None] | None = None


class KaitenSettingsOut(BaseModel):
    boards: list[KaitenBoardConfig] = []
    field_mapping: dict[str, str | None] | None = None

    model_config = {"from_attributes": True}

    @field_validator("boards", mode="before")
    @classmethod
    def parse_boards(cls, v):
        import json
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                return parsed if isinstance(parsed, list) else []
            except Exception:
                return []
        if v is None:
            return []
        return v

    @field_validator("field_mapping", mode="before")
    @classmethod
    def parse_field_mapping(cls, v):
        import json
        if isinstance(v, str):
            try:
                return json.loads(v)
            except Exception:
                return None
        return v


# ---------------------------------------------------------------------------
# Schedule versions
# ---------------------------------------------------------------------------

class PlacementUpdate(BaseModel):
    hall_id: int
    day_id: int
    start_time: time
    end_time: time

    @model_validator(mode="after")
    def check_times(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be > start_time")
        return self


class PlacementCreate(BaseModel):
    talk_id: int
    hall_id: int
    day_id: int
    start_time: time
    end_time: time

    @model_validator(mode="after")
    def check_times(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be > start_time")
        return self

class TalkPlacementOut(BaseModel):
    id: int
    talk_id: int
    talk_title: str
    day_id: int
    day_date: date
    hall_id: int
    hall_name: str
    start_time: time
    end_time: time
    reasoning: str | None = None
    primary_track_id: int | None = None
    track_ids: list[int] = []


class ScheduleVersionOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    updated_at: datetime
    is_active: bool
    summary: str | None
    placement_count: int
    placements: list[TalkPlacementOut] = []
