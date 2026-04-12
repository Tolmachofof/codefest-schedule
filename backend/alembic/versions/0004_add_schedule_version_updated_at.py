"""add updated_at to schedule_versions for optimistic locking

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-11
"""
import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("schedule_versions") as batch_op:
        batch_op.add_column(
            sa.Column(
                "updated_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("schedule_versions") as batch_op:
        batch_op.drop_column("updated_at")
