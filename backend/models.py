from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Date, ForeignKey, Table, Text, Time
from sqlalchemy.orm import relationship
from database import Base


talk_tracks = Table(
    "talk_tracks",
    Base.metadata,
    Column("talk_id", Integer, ForeignKey("talks.id", ondelete="CASCADE"), primary_key=True),
    Column("track_id", Integer, ForeignKey("tracks.id", ondelete="CASCADE"), primary_key=True),
)


class Conference(Base):
    __tablename__ = "conferences"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    city = Column(String, nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    schedule_prompt = Column(Text, nullable=True)

    tracks = relationship("Track", back_populates="conference", cascade="all, delete-orphan")
    halls = relationship("Hall", back_populates="conference", cascade="all, delete-orphan")
    days = relationship(
        "ConferenceDay",
        back_populates="conference",
        cascade="all, delete-orphan",
        order_by="ConferenceDay.date",
    )
    schedule_versions = relationship(
        "ScheduleVersion",
        back_populates="conference",
        cascade="all, delete-orphan",
        order_by="ScheduleVersion.created_at.desc()",
    )


class Track(Base):
    __tablename__ = "tracks"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    slots = Column(Integer, nullable=False)
    conference_id = Column(Integer, ForeignKey("conferences.id"), nullable=False, index=True)

    conference = relationship("Conference", back_populates="tracks")


class Hall(Base):
    __tablename__ = "halls"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    capacity = Column(Integer, nullable=False)
    conference_id = Column(Integer, ForeignKey("conferences.id"), nullable=False, index=True)

    conference = relationship("Conference", back_populates="halls")


class ConferenceDay(Base):
    __tablename__ = "conference_days"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False)
    conference_id = Column(Integer, ForeignKey("conferences.id"), nullable=False, index=True)

    conference = relationship("Conference", back_populates="days")
    talks = relationship("Talk", back_populates="day", cascade="all, delete-orphan")
    breaks = relationship("Break", back_populates="day", cascade="all, delete-orphan")


class Talk(Base):
    __tablename__ = "talks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    day_id = Column(Integer, ForeignKey("conference_days.id"), nullable=False, index=True)
    primary_track_id = Column(Integer, ForeignKey("tracks.id", ondelete="SET NULL"), nullable=True)

    # Speaker & scheduling metadata
    speaker_name = Column(String, nullable=True)
    speaker_level = Column(String, nullable=True)   # keynote | senior | middle | junior
    speaker_company = Column(String, nullable=True)
    speaker_position = Column(String, nullable=True)
    speaker_bio = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    talk_format = Column(String, nullable=True)      # RegularTalk | Workshop | LightningTalk | ...
    duration_minutes = Column(Integer, nullable=False, default=40)

    # Ratings 1–5 (all optional)
    relevance = Column(Integer, nullable=True)         # Актуальность
    novelty = Column(Integer, nullable=True)           # Новизна
    applicability = Column(Integer, nullable=True)     # Применимость
    mass_appeal = Column(Integer, nullable=True)       # Массовость
    speaker_experience = Column(Integer, nullable=True)  # Опыт спикера

    day = relationship("ConferenceDay", back_populates="talks")
    primary_track = relationship("Track", foreign_keys=[primary_track_id])
    tracks = relationship("Track", secondary=talk_tracks, lazy="selectin")

    kaiten_card_id = Column(String, nullable=True, index=True)

    @property
    def track_ids(self) -> list[int]:
        return [t.id for t in self.tracks]


class Break(Base):
    __tablename__ = "breaks"

    id = Column(Integer, primary_key=True, index=True)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    day_id = Column(Integer, ForeignKey("conference_days.id"), nullable=False, index=True)
    hall_id = Column(Integer, ForeignKey("halls.id", ondelete="CASCADE"), nullable=False, index=True)

    day = relationship("ConferenceDay", back_populates="breaks")
    hall = relationship("Hall")


class ScheduleVersion(Base):
    __tablename__ = "schedule_versions"

    id = Column(Integer, primary_key=True, index=True)
    conference_id = Column(Integer, ForeignKey("conferences.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    is_active = Column(Boolean, nullable=False, default=False)
    summary = Column(Text, nullable=True)

    conference = relationship("Conference", back_populates="schedule_versions")
    placements = relationship("TalkPlacement", back_populates="version", cascade="all, delete-orphan")


class TalkPlacement(Base):
    __tablename__ = "talk_placements"

    id = Column(Integer, primary_key=True, index=True)
    version_id = Column(Integer, ForeignKey("schedule_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    talk_id = Column(Integer, ForeignKey("talks.id", ondelete="CASCADE"), nullable=False, index=True)
    day_id = Column(Integer, ForeignKey("conference_days.id", ondelete="CASCADE"), nullable=False)
    hall_id = Column(Integer, ForeignKey("halls.id", ondelete="CASCADE"), nullable=False)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    reasoning = Column(Text, nullable=True)

    version = relationship("ScheduleVersion", back_populates="placements")
    talk = relationship("Talk", lazy="selectin")
    day = relationship("ConferenceDay", lazy="selectin")
    hall = relationship("Hall", lazy="selectin")


class Log(Base):
    __tablename__ = "logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    action = Column(String, nullable=False)


class KaitenSettings(Base):
    __tablename__ = "kaiten_settings"

    id = Column(Integer, primary_key=True, index=True)
    conference_id = Column(Integer, ForeignKey("conferences.id", ondelete="CASCADE"), nullable=False, unique=True)
    base_url = Column(String, nullable=False, default="")
    token = Column(String, nullable=False, default="")
    # Legacy single-board fields (kept for backward compat)
    space_id = Column(Integer, nullable=True)
    board_id = Column(Integer, nullable=True)
    column_id = Column(Integer, nullable=True)
    space_name = Column(String, nullable=True)
    board_name = Column(String, nullable=True)
    column_name = Column(String, nullable=True)
    field_mapping = Column(Text, nullable=True)  # JSON: {talk_field: kaiten_field_id}
    boards = Column(Text, nullable=True)  # JSON: [{space_id, board_id, column_id, space_name, board_name, column_name}]


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
