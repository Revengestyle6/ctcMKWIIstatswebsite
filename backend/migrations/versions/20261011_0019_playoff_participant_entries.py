"""Identify playoff participants by competing season entry.

Revision ID: 20261011_0019
Revises: 20261010_0018
"""

import sqlalchemy as sa
from alembic import op

revision = "20261011_0019"
down_revision = "20261010_0018"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "playoff_series_participants",
        sa.Column("team_season_entry_id", sa.Integer(), nullable=True),
    )
    # The old registration policy guaranteed one entry per canonical team in a
    # division. Refuse ambiguous legacy data rather than choosing an arbitrary side.
    op.execute("""
        DO $$ BEGIN
          IF EXISTS (
            SELECT p.playoff_series_participant_id
            FROM playoff_series_participants p
            JOIN playoff_series s USING (playoff_series_id)
            LEFT JOIN team_season_entries e
              ON e.team_id = p.team_id AND e.season_id = s.season_id
              AND e.division_id = s.division_id
            GROUP BY p.playoff_series_participant_id
            HAVING count(e.team_season_entry_id) <> 1
          ) THEN
            RAISE EXCEPTION 'Cannot unambiguously backfill playoff participant season entries';
          END IF;
        END $$;
        UPDATE playoff_series_participants p
        SET team_season_entry_id = e.team_season_entry_id
        FROM playoff_series s, team_season_entries e
        WHERE s.playoff_series_id = p.playoff_series_id
          AND e.team_id = p.team_id AND e.season_id = s.season_id
          AND e.division_id = s.division_id;
    """)
    op.alter_column("playoff_series_participants", "team_season_entry_id", nullable=False)
    op.create_foreign_key(
        "fk_playoff_participant_entry",
        "playoff_series_participants",
        "team_season_entries",
        ["team_season_entry_id"],
        ["team_season_entry_id"],
    )
    op.drop_constraint(
        "uq_playoff_series_participant_team", "playoff_series_participants", type_="unique"
    )
    op.create_unique_constraint(
        "uq_playoff_series_participant_entry",
        "playoff_series_participants",
        ["playoff_series_id", "team_season_entry_id"],
    )


def downgrade():
    # Restoring the old uniqueness rule fails safely if sibling entries have
    # since played in one series; do not delete their match history.
    op.create_unique_constraint(
        "uq_playoff_series_participant_team",
        "playoff_series_participants",
        ["playoff_series_id", "team_id"],
    )
    op.drop_constraint(
        "uq_playoff_series_participant_entry", "playoff_series_participants", type_="unique"
    )
    op.drop_constraint(
        "fk_playoff_participant_entry", "playoff_series_participants", type_="foreignkey"
    )
    op.drop_column("playoff_series_participants", "team_season_entry_id")
