from datetime import date, datetime, time
from pydantic import BaseModel, model_validator


class TrackBase(BaseModel):
    name: str
    slots: int


class TrackOut(TrackBase):
    id: int

    model_config = {"from_attributes": True}


class HallBase(BaseModel):
    name: str
    capacity: int


class HallOut(HallBase):
    id: int

    model_config = {"from_attributes": True}


class TalkCreate(BaseModel):
    title: str
    hall_id: int
    start_time: time
    end_time: time
    primary_track_id: int | None = None
    track_ids: list[int] = []

    @model_validator(mode="after")
    def check_times(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be > start_time")
        return self


class UnassignedTalkCreate(BaseModel):
    title: str
    primary_track_id: int | None = None
    track_ids: list[int] = []


class TalkUpdate(BaseModel):
    title: str | None = None
    hall_id: int | None = None
    day_id: int | None = None
    start_time: time | None = None
    end_time: time | None = None
    primary_track_id: int | None = None
    track_ids: list[int] | None = None

    @model_validator(mode="after")
    def check_times(self):
        if self.start_time and self.end_time and self.end_time <= self.start_time:
            raise ValueError("end_time must be > start_time")
        return self


class TalkOut(BaseModel):
    id: int
    title: str
    day_id: int
    hall_id: int | None = None
    start_time: time | None = None
    end_time: time | None = None
    primary_track_id: int | None = None
    track_ids: list[int] = []

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


class ConferenceOut(ConferenceBase):
    id: int
    tracks: list[TrackOut]
    halls: list[HallOut]
    days: list[DayOut]

    model_config = {"from_attributes": True}


class LogOut(BaseModel):
    id: int
    timestamp: datetime
    action: str

    model_config = {"from_attributes": True}
