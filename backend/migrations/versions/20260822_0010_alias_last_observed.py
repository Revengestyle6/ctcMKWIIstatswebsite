"""Track when an alias was most recently observed.

Revision ID: 20260822_0010
Revises: 20260822_0009
"""

import sqlalchemy as sa
from alembic import op

revision = "20260822_0010"
down_revision = "20260822_0009"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "player_aliases",
        sa.Column("last_observed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("UPDATE player_aliases SET last_observed_at = created_at")
    op.alter_column(
        "player_aliases",
        "last_observed_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def downgrade():
    op.drop_column("player_aliases", "last_observed_at")
