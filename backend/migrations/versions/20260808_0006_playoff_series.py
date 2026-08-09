"""Add division playoff formats and best-of series metadata.

Revision ID: 20260808_0006
Revises: 20260726_0005
Create Date: 2026-08-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260808_0006"
down_revision: str | None = "20260726_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "division_playoff_configs",
        sa.Column("division_id", sa.Integer(), nullable=False),
        sa.Column("format_code", sa.Text(), nullable=False),
        sa.Column("playoff_team_count", sa.Integer(), nullable=False),
        sa.Column("semifinal_series_count", sa.Integer(), nullable=False),
        sa.Column("finals_bye_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("playoff_team_count >= 2", name="ck_playoff_config_team_count"),
        sa.CheckConstraint("semifinal_series_count >= 0", name="ck_playoff_config_semifinal_count"),
        sa.CheckConstraint("finals_bye_count >= 0", name="ck_playoff_config_bye_count"),
        sa.ForeignKeyConstraint(["division_id"], ["divisions.division_id"]),
        sa.PrimaryKeyConstraint("division_id"),
    )
    op.create_table(
        "playoff_series",
        sa.Column("playoff_series_id", sa.Integer(), nullable=False),
        sa.Column("season_id", sa.Integer(), nullable=False),
        sa.Column("division_id", sa.Integer(), nullable=False),
        sa.Column("stage", sa.Text(), nullable=False),
        sa.Column("series_number", sa.Integer(), server_default="1", nullable=False),
        sa.Column("best_of", sa.Integer(), server_default="3", nullable=False),
        sa.Column("display_label", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("stage IN ('semifinals', 'finals')", name="ck_playoff_series_stage"),
        sa.CheckConstraint("series_number >= 1", name="ck_playoff_series_number"),
        sa.CheckConstraint("best_of >= 1 AND best_of % 2 = 1", name="ck_playoff_series_best_of"),
        sa.ForeignKeyConstraint(["division_id"], ["divisions.division_id"]),
        sa.ForeignKeyConstraint(["season_id"], ["seasons.season_id"]),
        sa.PrimaryKeyConstraint("playoff_series_id"),
        sa.UniqueConstraint(
            "division_id", "stage", "series_number", name="uq_playoff_series_division_stage"
        ),
    )
    op.create_index("ix_playoff_series_scope", "playoff_series", ["season_id", "division_id"])
    op.create_table(
        "playoff_series_participants",
        sa.Column("playoff_series_participant_id", sa.Integer(), nullable=False),
        sa.Column("playoff_series_id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("participant_slot", sa.Integer(), nullable=False),
        sa.CheckConstraint("participant_slot IN (1, 2)", name="ck_playoff_series_participant_slot"),
        sa.ForeignKeyConstraint(["playoff_series_id"], ["playoff_series.playoff_series_id"]),
        sa.ForeignKeyConstraint(["team_id"], ["teams.team_id"]),
        sa.PrimaryKeyConstraint("playoff_series_participant_id"),
        sa.UniqueConstraint(
            "playoff_series_id", "participant_slot", name="uq_playoff_series_participant_slot"
        ),
        sa.UniqueConstraint(
            "playoff_series_id", "team_id", name="uq_playoff_series_participant_team"
        ),
    )
    op.add_column(
        "matches", sa.Column("match_type", sa.Text(), server_default="regular", nullable=False)
    )
    op.add_column("matches", sa.Column("playoff_series_id", sa.Integer()))
    op.add_column("matches", sa.Column("series_match_number", sa.Integer()))
    op.create_foreign_key(
        "fk_matches_playoff_series_id",
        "matches",
        "playoff_series",
        ["playoff_series_id"],
        ["playoff_series_id"],
    )
    op.create_check_constraint("ck_match_type", "matches", "match_type IN ('regular', 'playoff')")
    op.create_check_constraint(
        "ck_match_competition_metadata",
        "matches",
        "(match_type = 'regular' AND playoff_series_id IS NULL "
        "AND series_match_number IS NULL) OR "
        "(match_type = 'playoff' AND week_number IS NULL "
        "AND playoff_series_id IS NOT NULL AND series_match_number >= 1)",
    )
    op.create_unique_constraint(
        "uq_match_playoff_series_number",
        "matches",
        ["playoff_series_id", "series_match_number"],
    )
    op.create_index("ix_matches_match_type", "matches", ["match_type"])


def downgrade() -> None:
    op.drop_index("ix_matches_match_type", table_name="matches")
    op.drop_constraint("uq_match_playoff_series_number", "matches", type_="unique")
    op.drop_constraint("ck_match_competition_metadata", "matches", type_="check")
    op.drop_constraint("ck_match_type", "matches", type_="check")
    op.drop_constraint("fk_matches_playoff_series_id", "matches", type_="foreignkey")
    op.drop_column("matches", "series_match_number")
    op.drop_column("matches", "playoff_series_id")
    op.drop_column("matches", "match_type")
    op.drop_table("playoff_series_participants")
    op.drop_index("ix_playoff_series_scope", table_name="playoff_series")
    op.drop_table("playoff_series")
    op.drop_table("division_playoff_configs")
