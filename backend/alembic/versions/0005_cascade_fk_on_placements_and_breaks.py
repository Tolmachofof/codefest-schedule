"""add ON DELETE CASCADE to TalkPlacement.hall_id, TalkPlacement.day_id, Break.hall_id

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-11

Fixes:
  - Deleting a hall no longer raises FK violation when schedule versions contain placements.
    Placements are removed automatically; talks return to the unassigned pool.
  - Deleting a conference day (via sync_days on date range change) no longer raises FK
    violation when placements reference that day.
"""
import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("talk_placements") as batch_op:
        batch_op.drop_constraint("talk_placements_hall_id_fkey", type_="foreignkey")
        batch_op.drop_constraint("talk_placements_day_id_fkey", type_="foreignkey")
        batch_op.create_foreign_key(
            "talk_placements_hall_id_fkey", "halls", ["hall_id"], ["id"], ondelete="CASCADE"
        )
        batch_op.create_foreign_key(
            "talk_placements_day_id_fkey", "conference_days", ["day_id"], ["id"], ondelete="CASCADE"
        )

    with op.batch_alter_table("breaks") as batch_op:
        batch_op.drop_constraint("breaks_hall_id_fkey", type_="foreignkey")
        batch_op.create_foreign_key(
            "breaks_hall_id_fkey", "halls", ["hall_id"], ["id"], ondelete="CASCADE"
        )


def downgrade() -> None:
    with op.batch_alter_table("talk_placements") as batch_op:
        batch_op.drop_constraint("talk_placements_hall_id_fkey", type_="foreignkey")
        batch_op.drop_constraint("talk_placements_day_id_fkey", type_="foreignkey")
        batch_op.create_foreign_key(
            "talk_placements_hall_id_fkey", "halls", ["hall_id"], ["id"]
        )
        batch_op.create_foreign_key(
            "talk_placements_day_id_fkey", "conference_days", ["day_id"], ["id"]
        )

    with op.batch_alter_table("breaks") as batch_op:
        batch_op.drop_constraint("breaks_hall_id_fkey", type_="foreignkey")
        batch_op.create_foreign_key(
            "breaks_hall_id_fkey", "halls", ["hall_id"], ["id"]
        )
