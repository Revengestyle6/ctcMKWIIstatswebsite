"""Add standings statuses and metadata-only match results.

Revision ID: 20260830_0013
Revises: 20260823_0012
"""

import sqlalchemy as sa
from alembic import op

revision = "20260830_0013"
down_revision = "20260823_0012"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "team_season_entries",
        sa.Column("competition_status", sa.Text(), nullable=False, server_default="active"),
    )
    op.add_column(
        "team_season_entries", sa.Column("competition_status_note", sa.Text(), nullable=True)
    )
    op.add_column(
        "team_season_entries",
        sa.Column("competition_status_updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "ck_team_season_entry_competition_status",
        "team_season_entries",
        "competition_status IN ('active', 'dropped', 'disqualified')",
    )

    op.add_column(
        "matches", sa.Column("result_type", sa.Text(), nullable=False, server_default="played")
    )
    op.create_check_constraint(
        "ck_match_result_type",
        "matches",
        "result_type IN ('played', 'free_win', 'mutual_tie')",
    )
    op.create_check_constraint(
        "ck_match_special_result",
        "matches",
        "(result_type = 'played') OR (match_type = 'regular' AND races_played = 0)",
    )


def downgrade():
    op.drop_constraint("ck_match_special_result", "matches", type_="check")
    op.drop_constraint("ck_match_result_type", "matches", type_="check")
    op.drop_column("matches", "result_type")
    op.drop_constraint(
        "ck_team_season_entry_competition_status", "team_season_entries", type_="check"
    )
    op.drop_column("team_season_entries", "competition_status_updated_at")
    op.drop_column("team_season_entries", "competition_status_note")
    op.drop_column("team_season_entries", "competition_status")
