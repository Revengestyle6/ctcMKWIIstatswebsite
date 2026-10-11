"""Store aggregate scores separately from accounted race facts.

Revision ID: 20261010_0018
Revises: 20260913_0017
"""

import sqlalchemy as sa
from alembic import op

revision = "20261010_0018"
down_revision = "20260913_0017"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "unaccounted_matches",
        sa.Column("match_id", sa.Integer(), sa.ForeignKey("matches.match_id"), primary_key=True),
        sa.Column("entry_mode", sa.Text(), nullable=False),
        sa.CheckConstraint("entry_mode IN ('gp', 'totals')", name="ck_unaccounted_entry_mode"),
    )
    op.create_table(
        "unaccounted_player_scores",
        sa.Column("unaccounted_player_score_id", sa.Integer(), primary_key=True),
        sa.Column(
            "match_player_id",
            sa.Integer(),
            sa.ForeignKey("match_players.match_player_id"),
            nullable=False,
        ),
        sa.Column("gp_number", sa.Integer(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("points", sa.Integer(), nullable=False),
        sa.Column("races", sa.Integer(), nullable=False),
        sa.Column("disconnection_points", sa.Integer(), nullable=False),
        sa.UniqueConstraint(
            "match_player_id", "gp_number", "role", name="uq_unaccounted_player_period_role"
        ),
        sa.CheckConstraint("gp_number >= 0", name="ck_unaccounted_player_period"),
        sa.CheckConstraint("role IN ('runner', 'bagger')", name="ck_unaccounted_player_role"),
        sa.CheckConstraint(
            "races >= 0 AND points >= 0 AND points <= races * 15",
            name="ck_unaccounted_player_score",
        ),
        sa.CheckConstraint(
            "disconnection_points >= 0 AND disconnection_points <= points",
            name="ck_unaccounted_disconnect",
        ),
    )
    op.create_table(
        "unaccounted_team_awards",
        sa.Column("unaccounted_team_award_id", sa.Integer(), primary_key=True),
        sa.Column(
            "match_team_id",
            sa.Integer(),
            sa.ForeignKey("match_teams.match_team_id"),
            nullable=False,
        ),
        sa.Column("gp_number", sa.Integer(), nullable=False),
        sa.Column("points", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.CheckConstraint("gp_number >= 0 AND points >= 0", name="ck_unaccounted_team_award"),
        sa.CheckConstraint(
            "reason IN ('short_roster', 'unreplaced_disconnect', 'unknown')",
            name="ck_unaccounted_award_reason",
        ),
    )


def downgrade():
    op.drop_table("unaccounted_team_awards")
    op.drop_table("unaccounted_player_scores")
    op.drop_table("unaccounted_matches")
