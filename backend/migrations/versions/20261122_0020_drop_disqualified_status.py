"""Consolidate inactive team season entries under dropped.

Revision ID: 20261122_0020
Revises: 20261011_0019
"""

from alembic import op

revision = "20261122_0020"
down_revision = "20261011_0019"
branch_labels = None
depends_on = None

STATUS_CONSTRAINT = "ck_team_season_entry_competition_status"
TEAM_ENTRIES = "team_season_entries"


def upgrade():
    op.execute("""
        UPDATE team_season_entries
        SET competition_status = 'dropped'
        WHERE competition_status = 'disqualified'
    """)
    op.drop_constraint(STATUS_CONSTRAINT, TEAM_ENTRIES, type_="check")
    op.create_check_constraint(
        STATUS_CONSTRAINT, TEAM_ENTRIES, "competition_status IN ('active', 'dropped')"
    )


def downgrade():
    op.drop_constraint(STATUS_CONSTRAINT, TEAM_ENTRIES, type_="check")
    op.create_check_constraint(
        STATUS_CONSTRAINT,
        TEAM_ENTRIES,
        "competition_status IN ('active', 'dropped', 'disqualified')",
    )
