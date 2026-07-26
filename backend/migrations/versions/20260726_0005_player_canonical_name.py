"""Rename the player canonical display-name column.

Revision ID: 20260726_0005
Revises: 20260726_0004
Create Date: 2026-07-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260726_0005"
down_revision: str | None = "20260726_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "players",
        "canonical_lounge_name",
        new_column_name="canonical_name",
        existing_type=sa.Text(),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "players",
        "canonical_name",
        new_column_name="canonical_lounge_name",
        existing_type=sa.Text(),
        existing_nullable=True,
    )
