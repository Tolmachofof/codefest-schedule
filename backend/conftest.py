"""
Test configuration. Patches the database engine to SQLite in-memory
and mocks the PostgreSQL-specific startup migrations before importing main.
"""
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# ---------------------------------------------------------------------------
# Patch database module BEFORE main.py is imported (it runs migrations on import)
# ---------------------------------------------------------------------------
import database as _db_module

_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

_db_module.engine = _engine
_db_module.SessionLocal = _Session

_mock_conn = MagicMock()
_mock_conn.execute = MagicMock()
_mock_conn.commit = MagicMock()


@contextmanager
def _noop_connect():
    yield _mock_conn


with patch.object(_engine, "connect", side_effect=_noop_connect):
    from main import app
    from auth import get_current_user, hash_password
    from database import Base, get_db
    import models

Base.metadata.create_all(bind=_engine)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def clean_tables():
    """Clear all rows between tests."""
    yield
    db = _Session()
    for table in reversed(Base.metadata.sorted_tables):
        db.execute(table.delete())
    db.commit()
    db.close()


@pytest.fixture
def db():
    session = _Session()
    yield session
    session.close()


@pytest.fixture
def test_user(db):
    user = models.User(username="tester", hashed_password=hash_password("password123"))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def client(test_user):
    def override_db():
        s = _Session()
        try:
            yield s
        finally:
            s.close()

    def override_auth():
        s = _Session()
        return s.get(models.User, test_user.id)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_auth

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()
