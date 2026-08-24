"""Add automatic team canonical-identity priority settings.

Revision ID: 20260823_0011
Revises: 20260822_0010
"""

import sqlalchemy as sa
from alembic import op

revision = "20260823_0011"
down_revision = "20260822_0010"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "teams",
        sa.Column(
            "canonical_identity_override",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    op.add_column(
        "teams",
        sa.Column("canonical_league_preference", sa.Text(), nullable=True),
    )

    # Existing teams enter automatic mode using their newest recorded season
    # identity. Season IDs break ties when two leagues share a season number.
    op.execute(
        """
        WITH latest_identity AS (
            SELECT DISTINCT ON (entry.team_id)
                entry.team_id,
                entry.display_name,
                entry.clan_tag
            FROM team_season_entries AS entry
            JOIN seasons AS season ON season.season_id = entry.season_id
            ORDER BY
                entry.team_id,
                season.season_number DESC NULLS LAST,
                season.season_id DESC,
                entry.team_season_entry_id DESC
        )
        UPDATE teams AS team
        SET canonical_name = latest_identity.display_name,
            canonical_tag = latest_identity.clan_tag
        FROM latest_identity
        WHERE latest_identity.team_id = team.team_id
        """
    )


def downgrade():
    op.drop_column("teams", "canonical_league_preference")
    op.drop_column("teams", "canonical_identity_override")
