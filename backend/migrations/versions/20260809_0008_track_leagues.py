"""Scope canonical tracks to a league.

Revision ID: 20260809_0008
Revises: 20260809_0007
Create Date: 2026-08-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260809_0008"
down_revision: str | None = "20260809_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tracks",
        sa.Column("league_code", sa.Text(), server_default="ctc", nullable=False),
    )
    op.drop_constraint("uq_track_canonical_name", "tracks", type_="unique")
    op.create_unique_constraint("uq_track_league_name", "tracks", ["league_code", "canonical_name"])
    op.create_index("ix_tracks_league_code", "tracks", ["league_code"])


def downgrade() -> None:
    op.drop_index("ix_tracks_league_code", table_name="tracks")
    op.drop_constraint("uq_track_league_name", "tracks", type_="unique")
    op.drop_column("tracks", "league_code")
    op.create_unique_constraint("uq_track_canonical_name", "tracks", ["canonical_name"])
