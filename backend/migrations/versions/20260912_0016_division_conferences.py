"""Add configurable two-conference divisions.

Revision ID: 20260912_0016
Revises: 20260905_0015
"""

import sqlalchemy as sa
from alembic import op

revision = "20260912_0016"
down_revision = "20260905_0015"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "divisions",
        sa.Column("is_conference_based", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "division_conferences",
        sa.Column("division_conference_id", sa.Integer(), primary_key=True),
        sa.Column("division_id", sa.Integer(), nullable=False),
        sa.Column("conference_code", sa.Text(), nullable=False),
        sa.Column("conference_name", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column(
            "last_update_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["division_id"], ["divisions.division_id"]),
        sa.UniqueConstraint("division_id", "conference_code", name="uq_division_conference_code"),
        sa.UniqueConstraint("division_id", "sort_order", name="uq_division_conference_order"),
        sa.CheckConstraint("sort_order IN (1, 2)", name="ck_division_conference_order"),
    )
    op.create_index("ix_division_conferences_division_id", "division_conferences", ["division_id"])
    op.add_column("team_season_entries", sa.Column("conference_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_team_season_entries_conference_id",
        "team_season_entries",
        "division_conferences",
        ["conference_id"],
        ["division_conference_id"],
    )


def downgrade():
    op.drop_constraint(
        "fk_team_season_entries_conference_id", "team_season_entries", type_="foreignkey"
    )
    op.drop_column("team_season_entries", "conference_id")
    op.drop_index("ix_division_conferences_division_id", table_name="division_conferences")
    op.drop_table("division_conferences")
    op.drop_column("divisions", "is_conference_based")
