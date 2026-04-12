"""remove start_time, end_time, hall_id from talks (placement is now in TalkPlacement only)

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-10
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("talks") as batch_op:
        batch_op.drop_index("ix_talks_hall_id")
        batch_op.drop_column("start_time")
        batch_op.drop_column("end_time")
        batch_op.drop_column("hall_id")


def downgrade() -> None:
    with op.batch_alter_table("talks") as batch_op:
        batch_op.add_column(sa.Column("hall_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("start_time", sa.Time(), nullable=True))
        batch_op.add_column(sa.Column("end_time", sa.Time(), nullable=True))
        batch_op.create_foreign_key("fk_talks_hall_id_halls", "halls", ["hall_id"], ["id"])
        batch_op.create_index("ix_talks_hall_id", ["hall_id"])
