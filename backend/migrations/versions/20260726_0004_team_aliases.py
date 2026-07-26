"""Add durable team aliases.

Revision ID: 20260726_0004
Revises: 20260725_0003
Create Date: 2026-07-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260726_0004"
down_revision: str | None = "20260725_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "team_aliases",
        sa.Column("team_alias_id", sa.Integer(), primary_key=True),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("alias_value", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["team_id"], ["teams.team_id"]),
        sa.UniqueConstraint("alias_value", name="uq_team_alias_value"),
    )


def downgrade() -> None:
    op.drop_table("team_aliases")
