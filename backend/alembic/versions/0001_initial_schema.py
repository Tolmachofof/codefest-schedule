"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-04-10
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("username", sa.String(), nullable=False, unique=True, index=True),
        sa.Column("hashed_password", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
    )

    op.create_table(
        "conferences",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("city", sa.String(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("schedule_prompt", sa.Text(), nullable=True),
    )

    op.create_table(
        "tracks",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("slots", sa.Integer(), nullable=False),
        sa.Column("conference_id", sa.Integer(), sa.ForeignKey("conferences.id"), nullable=False),
    )

    op.create_table(
        "halls",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False),
        sa.Column("conference_id", sa.Integer(), sa.ForeignKey("conferences.id"), nullable=False),
    )

    op.create_table(
        "conference_days",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("conference_id", sa.Integer(), sa.ForeignKey("conferences.id"), nullable=False),
    )

    op.create_table(
        "talks",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=True),
        sa.Column("end_time", sa.Time(), nullable=True),
        sa.Column("day_id", sa.Integer(), sa.ForeignKey("conference_days.id"), nullable=False),
        sa.Column("hall_id", sa.Integer(), sa.ForeignKey("halls.id"), nullable=True),
        sa.Column(
            "primary_track_id",
            sa.Integer(),
            sa.ForeignKey("tracks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("speaker_name", sa.String(), nullable=True),
        sa.Column("speaker_level", sa.String(), nullable=True),
        sa.Column("speaker_company", sa.String(), nullable=True),
        sa.Column("speaker_position", sa.String(), nullable=True),
        sa.Column("speaker_bio", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("talk_format", sa.String(), nullable=True),
        sa.Column("duration_minutes", sa.Integer(), nullable=False, server_default="40"),
        sa.Column("relevance", sa.Integer(), nullable=True),
        sa.Column("novelty", sa.Integer(), nullable=True),
        sa.Column("applicability", sa.Integer(), nullable=True),
        sa.Column("mass_appeal", sa.Integer(), nullable=True),
        sa.Column("speaker_experience", sa.Integer(), nullable=True),
        sa.Column("kaiten_card_id", sa.String(), nullable=True),
    )

    op.create_table(
        "talk_tracks",
        sa.Column(
            "talk_id",
            sa.Integer(),
            sa.ForeignKey("talks.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "track_id",
            sa.Integer(),
            sa.ForeignKey("tracks.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    op.create_table(
        "breaks",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("day_id", sa.Integer(), sa.ForeignKey("conference_days.id"), nullable=False),
        sa.Column("hall_id", sa.Integer(), sa.ForeignKey("halls.id"), nullable=False),
    )

    op.create_table(
        "schedule_versions",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "conference_id",
            sa.Integer(),
            sa.ForeignKey("conferences.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("summary", sa.Text(), nullable=True),
    )

    op.create_table(
        "talk_placements",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "version_id",
            sa.Integer(),
            sa.ForeignKey("schedule_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "talk_id",
            sa.Integer(),
            sa.ForeignKey("talks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("day_id", sa.Integer(), sa.ForeignKey("conference_days.id"), nullable=False),
        sa.Column("hall_id", sa.Integer(), sa.ForeignKey("halls.id"), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("reasoning", sa.Text(), nullable=True),
    )

    op.create_table(
        "logs",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
    )

    op.create_table(
        "kaiten_settings",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "conference_id",
            sa.Integer(),
            sa.ForeignKey("conferences.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("base_url", sa.String(), nullable=False, server_default=""),
        sa.Column("token", sa.String(), nullable=False, server_default=""),
        sa.Column("space_id", sa.Integer(), nullable=True),
        sa.Column("board_id", sa.Integer(), nullable=True),
        sa.Column("column_id", sa.Integer(), nullable=True),
        sa.Column("space_name", sa.String(), nullable=True),
        sa.Column("board_name", sa.String(), nullable=True),
        sa.Column("column_name", sa.String(), nullable=True),
        sa.Column("field_mapping", sa.Text(), nullable=True),
        sa.Column("boards", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("kaiten_settings")
    op.drop_table("logs")
    op.drop_table("talk_placements")
    op.drop_table("schedule_versions")
    op.drop_table("breaks")
    op.drop_table("talk_tracks")
    op.drop_table("talks")
    op.drop_table("conference_days")
    op.drop_table("halls")
    op.drop_table("tracks")
    op.drop_table("conferences")
    op.drop_table("users")
