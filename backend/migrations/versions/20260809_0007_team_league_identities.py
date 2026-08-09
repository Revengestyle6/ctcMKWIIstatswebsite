"""Add explicit league-scoped team identities.

Revision ID: 20260809_0007
Revises: 20260808_0006
Create Date: 2026-08-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260809_0007"
down_revision: str | None = "20260808_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("uq_team_canonical_tag", "teams", type_="unique")
    op.create_table(
        "team_league_identities",
        sa.Column("team_league_identity_id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("league_code", sa.Text(), nullable=False),
        sa.Column("tag", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["team_id"], ["teams.team_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("team_league_identity_id"),
    )
    op.create_index(
        "ix_team_league_identities_team_id",
        "team_league_identities",
        ["team_id"],
    )
    op.execute(
        """
        INSERT INTO team_league_identities (team_id, league_code, tag, created_at)
        SELECT DISTINCT ON (lower(s.league_code), lower(tse.clan_tag))
               tse.team_id, lower(s.league_code), tse.clan_tag, CURRENT_TIMESTAMP
          FROM team_season_entries tse
          JOIN seasons s ON s.season_id = tse.season_id
         ORDER BY lower(s.league_code), lower(tse.clan_tag), tse.team_season_entry_id
        """
    )
    op.execute(
        """
        INSERT INTO team_league_identities (team_id, league_code, tag, created_at)
        SELECT t.team_id, 'ctc', t.canonical_tag, CURRENT_TIMESTAMP
          FROM teams t
         WHERE NOT EXISTS (
             SELECT 1
               FROM team_league_identities tli
              WHERE lower(tli.league_code) = 'ctc'
                AND lower(tli.tag) = lower(t.canonical_tag)
         )
        """
    )
    op.create_index(
        "uq_team_league_identity_code_tag_ci",
        "team_league_identities",
        [sa.text("lower(league_code)"), sa.text("lower(tag)")],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_team_league_identity_code_tag_ci", table_name="team_league_identities")
    op.drop_index("ix_team_league_identities_team_id", table_name="team_league_identities")
    op.drop_table("team_league_identities")
    op.create_unique_constraint("uq_team_canonical_tag", "teams", ["canonical_tag"])
