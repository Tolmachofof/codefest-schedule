"""add index on logs.timestamp for ORDER BY performance

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-11
"""
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_logs_timestamp", "logs", ["timestamp"])


def downgrade() -> None:
    op.drop_index("ix_logs_timestamp", "logs")
