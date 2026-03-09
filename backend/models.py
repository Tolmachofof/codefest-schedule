from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Date, Time, ForeignKey, Table
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

    tracks = relationship("Track", back_populates="conference", cascade="all, delete-orphan")
    halls = relationship("Hall", back_populates="conference", cascade="all, delete-orphan")
    days = relationship(
        "ConferenceDay",
        back_populates="conference",
        cascade="all, delete-orphan",
        order_by="ConferenceDay.date",
    )


class Track(Base):
    __tablename__ = "tracks"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    slots = Column(Integer, nullable=False)
    conference_id = Column(Integer, ForeignKey("conferences.id"), nullable=False)

    conference = relationship("Conference", back_populates="tracks")


class Hall(Base):
    __tablename__ = "halls"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    capacity = Column(Integer, nullable=False)
    conference_id = Column(Integer, ForeignKey("conferences.id"), nullable=False)

    conference = relationship("Conference", back_populates="halls")


class ConferenceDay(Base):
    __tablename__ = "conference_days"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False)
    conference_id = Column(Integer, ForeignKey("conferences.id"), nullable=False)

    conference = relationship("Conference", back_populates="days")
    talks = relationship("Talk", back_populates="day", cascade="all, delete-orphan")
    breaks = relationship("Break", back_populates="day", cascade="all, delete-orphan")


class Talk(Base):
    __tablename__ = "talks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    start_time = Column(Time, nullable=True)
    end_time = Column(Time, nullable=True)
    day_id = Column(Integer, ForeignKey("conference_days.id"), nullable=False)
    hall_id = Column(Integer, ForeignKey("halls.id"), nullable=True)
    primary_track_id = Column(Integer, ForeignKey("tracks.id", ondelete="SET NULL"), nullable=True)

    day = relationship("ConferenceDay", back_populates="talks")
    hall = relationship("Hall")
    primary_track = relationship("Track", foreign_keys=[primary_track_id])
    tracks = relationship("Track", secondary=talk_tracks)

    @property
    def track_ids(self) -> list[int]:
        return [t.id for t in self.tracks]


class Break(Base):
    __tablename__ = "breaks"

    id = Column(Integer, primary_key=True, index=True)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    day_id = Column(Integer, ForeignKey("conference_days.id"), nullable=False)
    hall_id = Column(Integer, ForeignKey("halls.id"), nullable=False)

    day = relationship("ConferenceDay", back_populates="breaks")
    hall = relationship("Hall")


class Log(Base):
    __tablename__ = "logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, nullable=False, default=datetime.utcnow)
    action = Column(String, nullable=False)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
