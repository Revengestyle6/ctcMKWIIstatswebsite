"""Scope team logos to season and division entries.

Revision ID: 20260913_0017
Revises: 20260912_0016
"""

import sqlalchemy as sa
from alembic import op

revision = "20260913_0017"
down_revision = "20260912_0016"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("team_logos", sa.Column("team_season_entry_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_team_logos_team_season_entry_id",
        "team_logos",
        "team_season_entries",
        ["team_season_entry_id"],
        ["team_season_entry_id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_team_logos_team_season_entry_id", "team_logos", ["team_season_entry_id"])
    op.drop_constraint("uq_team_logo_asset", "team_logos", type_="unique")
    op.create_unique_constraint(
        "uq_team_logo_asset",
        "team_logos",
        ["team_id", "season_id", "team_season_entry_id", "asset_path"],
    )


def downgrade():
    op.drop_constraint("uq_team_logo_asset", "team_logos", type_="unique")
    op.execute(
        """
        DELETE FROM team_logos AS duplicate
        USING team_logos AS retained
        WHERE duplicate.team_id = retained.team_id
          AND duplicate.season_id IS NOT DISTINCT FROM retained.season_id
          AND duplicate.asset_path = retained.asset_path
          AND duplicate.team_logo_id < retained.team_logo_id
        """
    )
    op.create_unique_constraint(
        "uq_team_logo_asset", "team_logos", ["team_id", "season_id", "asset_path"]
    )
    op.drop_index("ix_team_logos_team_season_entry_id", table_name="team_logos")
    op.drop_constraint("fk_team_logos_team_season_entry_id", "team_logos", type_="foreignkey")
    op.drop_column("team_logos", "team_season_entry_id")
