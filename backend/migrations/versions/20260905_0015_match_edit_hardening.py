"""Harden match editing provenance, attribution, and timestamps.

Revision ID: 20260905_0015
Revises: 20260830_0014
"""

import sqlalchemy as sa
from alembic import op

revision = "20260905_0015"
down_revision = "20260830_0014"
branch_labels = None
depends_on = None


TIMESTAMP_TABLES = (
    "seasons",
    "divisions",
    "division_playoff_configs",
    "playoff_series",
    "playoff_series_participants",
    "source_files",
    "teams",
    "team_league_identities",
    "team_logos",
    "team_season_entries",
    "team_aliases",
    "players",
    "player_friend_codes",
    "player_aliases",
    "player_season_entries",
    "tracks",
    "track_aliases",
    "matches",
    "match_table_refs",
    "match_teams",
    "match_players",
    "races",
    "race_team_results",
    "race_player_results",
    "penalties",
    "admin_users",
    "review_submissions",
    "health_issue_reviews",
    "mkc_refresh_previews",
)


def upgrade():
    op.add_column("source_files", sa.Column("original_source_path", sa.Text(), nullable=True))
    op.execute("UPDATE source_files SET original_source_path = source_path")
    op.alter_column("source_files", "original_source_path", nullable=False)

    for table_name in TIMESTAMP_TABLES:
        op.add_column(
            table_name,
            sa.Column(
                "last_update_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )

    op.add_column(
        "player_friend_codes",
        sa.Column("origin", sa.Text(), nullable=False, server_default="admin"),
    )
    op.execute(
        "UPDATE player_friend_codes SET origin = 'match_import' "
        "WHERE first_seen_match_id IS NOT NULL OR last_seen_match_id IS NOT NULL"
    )
    op.create_check_constraint(
        "ck_player_friend_code_origin",
        "player_friend_codes",
        "origin IN ('match_import', 'admin')",
    )

    op.add_column(
        "player_aliases",
        sa.Column("origin", sa.Text(), nullable=False, server_default="admin"),
    )
    op.execute(
        "UPDATE player_aliases SET origin = 'match_import' "
        "WHERE first_seen_match_id IS NOT NULL OR last_seen_match_id IS NOT NULL"
    )
    op.create_check_constraint(
        "ck_player_alias_origin",
        "player_aliases",
        "origin IN ('match_import', 'admin')",
    )

    op.add_column(
        "database_addition_logs",
        sa.Column("operation_type", sa.Text(), nullable=False, server_default="addition"),
    )
    op.add_column(
        "database_addition_logs",
        sa.Column("admin_user_id", sa.Integer(), nullable=True),
    )
    op.add_column("database_addition_logs", sa.Column("admin_email", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_database_addition_logs_admin_user_id",
        "database_addition_logs",
        "admin_users",
        ["admin_user_id"],
        ["admin_user_id"],
    )
    op.create_check_constraint(
        "ck_addition_log_operation",
        "database_addition_logs",
        "operation_type IN ('addition', 'edit')",
    )
    op.execute(
        """
        UPDATE database_addition_logs AS dal
        SET admin_user_id = sf.accepted_by_admin_user_id,
            admin_email = au.email
        FROM matches AS m
        JOIN source_files AS sf ON sf.source_file_id = m.source_file_id
        LEFT JOIN admin_users AS au
          ON au.admin_user_id = sf.accepted_by_admin_user_id
        WHERE dal.match_id = m.match_id
          AND sf.accepted_by_admin_user_id IS NOT NULL
        """
    )


def downgrade():
    op.drop_constraint("ck_addition_log_operation", "database_addition_logs", type_="check")
    op.drop_constraint(
        "fk_database_addition_logs_admin_user_id",
        "database_addition_logs",
        type_="foreignkey",
    )
    op.drop_column("database_addition_logs", "admin_email")
    op.drop_column("database_addition_logs", "admin_user_id")
    op.drop_column("database_addition_logs", "operation_type")

    op.drop_constraint("ck_player_alias_origin", "player_aliases", type_="check")
    op.drop_column("player_aliases", "origin")
    op.drop_constraint("ck_player_friend_code_origin", "player_friend_codes", type_="check")
    op.drop_column("player_friend_codes", "origin")

    for table_name in reversed(TIMESTAMP_TABLES):
        op.drop_column(table_name, "last_update_at")

    op.drop_column("source_files", "original_source_path")
