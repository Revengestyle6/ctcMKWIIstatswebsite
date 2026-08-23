"""Add MKCentral player-name synchronization metadata.

Revision ID: 20260822_0009
Revises: 20260809_0008
Create Date: 2026-08-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260822_0009"
down_revision: str | None = "20260809_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "players",
        sa.Column(
            "canonical_name_override",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    op.add_column(
        "player_aliases",
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        """
        UPDATE player_aliases AS alias
        SET created_at = match.created_at
        FROM matches AS match
        WHERE match.match_id = alias.first_seen_match_id
          AND alias.created_at IS NULL
        """
    )
    op.execute("UPDATE player_aliases SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL")
    op.alter_column(
        "player_aliases",
        "created_at",
        nullable=False,
        server_default=sa.func.now(),
    )
    op.create_table(
        "mkc_refresh_previews",
        sa.Column("preview_id", sa.Text(), primary_key=True),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column("player_id", sa.Integer()),
        sa.Column("status", sa.Text(), server_default="pending", nullable=False),
        sa.Column("requested_by_admin_user_id", sa.Integer()),
        sa.Column("applied_by_admin_user_id", sa.Integer()),
        sa.Column("results_json", sa.Text(), nullable=False),
        sa.Column("summary_json", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("scope IN ('bulk', 'individual')", name="ck_mkc_refresh_preview_scope"),
        sa.CheckConstraint(
            "status IN ('pending', 'applied', 'rejected')",
            name="ck_mkc_refresh_preview_status",
        ),
        sa.ForeignKeyConstraint(["player_id"], ["players.player_id"]),
        sa.ForeignKeyConstraint(["requested_by_admin_user_id"], ["admin_users.admin_user_id"]),
        sa.ForeignKeyConstraint(["applied_by_admin_user_id"], ["admin_users.admin_user_id"]),
    )
    op.create_index("ix_mkc_refresh_previews_created_at", "mkc_refresh_previews", ["created_at"])
    op.create_index("ix_mkc_refresh_previews_expires_at", "mkc_refresh_previews", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_mkc_refresh_previews_expires_at", table_name="mkc_refresh_previews")
    op.drop_index("ix_mkc_refresh_previews_created_at", table_name="mkc_refresh_previews")
    op.drop_table("mkc_refresh_previews")
    op.drop_column("player_aliases", "created_at")
    op.drop_column("players", "canonical_name_override")
