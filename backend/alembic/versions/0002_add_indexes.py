"""add indexes on foreign keys and hot lookup columns

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-10
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # talks
    op.create_index("ix_talks_day_id", "talks", ["day_id"])
    op.create_index("ix_talks_hall_id", "talks", ["hall_id"])
    op.create_index("ix_talks_kaiten_card_id", "talks", ["kaiten_card_id"])

    # breaks
    op.create_index("ix_breaks_day_id", "breaks", ["day_id"])
    op.create_index("ix_breaks_hall_id", "breaks", ["hall_id"])

    # talk_placements
    op.create_index("ix_talk_placements_version_id", "talk_placements", ["version_id"])
    op.create_index("ix_talk_placements_talk_id", "talk_placements", ["talk_id"])

    # schedule_versions
    op.create_index("ix_schedule_versions_conference_id", "schedule_versions", ["conference_id"])

    # conference_days
    op.create_index("ix_conference_days_conference_id", "conference_days", ["conference_id"])

    # tracks, halls
    op.create_index("ix_tracks_conference_id", "tracks", ["conference_id"])
    op.create_index("ix_halls_conference_id", "halls", ["conference_id"])


def downgrade() -> None:
    op.drop_index("ix_halls_conference_id", "halls")
    op.drop_index("ix_tracks_conference_id", "tracks")
    op.drop_index("ix_conference_days_conference_id", "conference_days")
    op.drop_index("ix_schedule_versions_conference_id", "schedule_versions")
    op.drop_index("ix_talk_placements_talk_id", "talk_placements")
    op.drop_index("ix_talk_placements_version_id", "talk_placements")
    op.drop_index("ix_breaks_hall_id", "breaks")
    op.drop_index("ix_breaks_day_id", "breaks")
    op.drop_index("ix_talks_kaiten_card_id", "talks")
    op.drop_index("ix_talks_hall_id", "talks")
    op.drop_index("ix_talks_day_id", "talks")
