"""Rename regular-season week number to match number.

Revision ID: 20260823_0012
Revises: 20260823_0011
"""

from alembic import op

revision = "20260823_0012"
down_revision = "20260823_0011"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("ck_match_competition_metadata", "matches", type_="check")
    op.alter_column("matches", "week_number", new_column_name="match_number")
    op.create_check_constraint(
        "ck_match_competition_metadata",
        "matches",
        "(match_type = 'regular' AND playoff_series_id IS NULL "
        "AND series_match_number IS NULL) OR "
        "(match_type = 'playoff' AND match_number IS NULL "
        "AND playoff_series_id IS NOT NULL AND series_match_number >= 1)",
    )


def downgrade():
    op.drop_constraint("ck_match_competition_metadata", "matches", type_="check")
    op.alter_column("matches", "match_number", new_column_name="week_number")
    op.create_check_constraint(
        "ck_match_competition_metadata",
        "matches",
        "(match_type = 'regular' AND playoff_series_id IS NULL "
        "AND series_match_number IS NULL) OR "
        "(match_type = 'playoff' AND week_number IS NULL "
        "AND playoff_series_id IS NOT NULL AND series_match_number >= 1)",
    )
