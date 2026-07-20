"""Create the frozen Phase 2 analytics schema.

Revision ID: 20260719_0001
Revises:
Create Date: 2026-07-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260719_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "seasons",
        sa.Column("season_id", sa.Integer(), primary_key=True),
        sa.Column("league_code", sa.Text(), nullable=False),
        sa.Column("season_code", sa.Text(), nullable=False),
        sa.Column("season_number", sa.Integer()),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("starts_on", sa.Date()),
        sa.Column("ends_on", sa.Date()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("league_code", "season_code", name="uq_season_league_code"),
    )
    op.create_table(
        "divisions",
        sa.Column("division_id", sa.Integer(), primary_key=True),
        sa.Column("season_id", sa.Integer(), nullable=False),
        sa.Column("division_code", sa.Text(), nullable=False),
        sa.Column("division_name", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["season_id"], ["seasons.season_id"]),
        sa.UniqueConstraint("season_id", "division_code", name="uq_division_season_code"),
    )
    op.create_table(
        "teams",
        sa.Column("team_id", sa.Integer(), primary_key=True),
        sa.Column("canonical_name", sa.Text(), nullable=False),
        sa.Column("canonical_tag", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("canonical_tag", name="uq_team_canonical_tag"),
    )
    op.create_table(
        "players",
        sa.Column("player_id", sa.Integer(), primary_key=True),
        sa.Column("canonical_lounge_name", sa.Text()),
        sa.Column("primary_friend_code", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "tracks",
        sa.Column("track_id", sa.Integer(), primary_key=True),
        sa.Column("canonical_name", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("canonical_name", name="uq_track_canonical_name"),
    )
    op.create_table(
        "source_files",
        sa.Column("source_file_id", sa.Integer(), primary_key=True),
        sa.Column("season_id", sa.Integer(), nullable=False),
        sa.Column("division_id", sa.Integer(), nullable=False),
        sa.Column("source_path", sa.Text(), nullable=False),
        sa.Column("source_filename", sa.Text(), nullable=False),
        sa.Column("file_sha256", sa.Text(), nullable=False),
        sa.Column("json_shape", sa.Text(), nullable=False),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["division_id"], ["divisions.division_id"]),
        sa.ForeignKeyConstraint(["season_id"], ["seasons.season_id"]),
        sa.UniqueConstraint("file_sha256", name="uq_source_file_sha256"),
        sa.UniqueConstraint("source_path", name="uq_source_file_path"),
    )
    op.create_table(
        "team_logos",
        sa.Column("team_logo_id", sa.Integer(), primary_key=True),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("season_id", sa.Integer()),
        sa.Column("asset_path", sa.Text(), nullable=False),
        sa.Column("alt_text", sa.Text(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["season_id"], ["seasons.season_id"]),
        sa.ForeignKeyConstraint(["team_id"], ["teams.team_id"]),
        sa.UniqueConstraint("team_id", "season_id", "asset_path", name="uq_team_logo_asset"),
    )
    op.create_index("ix_team_logos_season_id", "team_logos", ["season_id"])
    op.create_index("ix_team_logos_team_id", "team_logos", ["team_id"])
    op.create_table(
        "team_season_entries",
        sa.Column("team_season_entry_id", sa.Integer(), primary_key=True),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("season_id", sa.Integer(), nullable=False),
        sa.Column("division_id", sa.Integer(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("clan_tag", sa.Text(), nullable=False),
        sa.Column("hex_color", sa.Text()),
        sa.ForeignKeyConstraint(["division_id"], ["divisions.division_id"]),
        sa.ForeignKeyConstraint(["season_id"], ["seasons.season_id"]),
        sa.ForeignKeyConstraint(["team_id"], ["teams.team_id"]),
        sa.UniqueConstraint(
            "season_id",
            "division_id",
            "clan_tag",
            name="uq_team_entry_season_division_tag",
        ),
    )
    op.create_table(
        "matches",
        sa.Column("match_id", sa.Integer(), primary_key=True),
        sa.Column("season_id", sa.Integer(), nullable=False),
        sa.Column("division_id", sa.Integer(), nullable=False),
        sa.Column("source_file_id", sa.Integer(), nullable=False),
        sa.Column("match_index_in_source", sa.Integer(), nullable=False),
        sa.Column("week_number", sa.Integer()),
        sa.Column("match_label", sa.Text(), nullable=False),
        sa.Column("title_str", sa.Text()),
        sa.Column("format", sa.Text()),
        sa.Column("races_played", sa.Integer(), nullable=False),
        sa.Column("raw_json", sa.Text()),
        sa.Column("import_status", sa.Text(), nullable=False),
        sa.Column("review_notes", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "import_status IN ('imported', 'needs_review')", name="ck_match_import_status"
        ),
        sa.ForeignKeyConstraint(["division_id"], ["divisions.division_id"]),
        sa.ForeignKeyConstraint(["season_id"], ["seasons.season_id"]),
        sa.ForeignKeyConstraint(["source_file_id"], ["source_files.source_file_id"]),
        sa.UniqueConstraint(
            "source_file_id", "match_index_in_source", name="uq_match_source_index"
        ),
    )
    op.create_table(
        "database_addition_logs",
        sa.Column("addition_log_id", sa.Integer(), primary_key=True),
        sa.Column("match_id", sa.Integer()),
        sa.Column("entity_type", sa.Text(), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("details_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["match_id"], ["matches.match_id"]),
    )
    op.create_index(
        "ix_database_addition_logs_created_at", "database_addition_logs", ["created_at"]
    )
    op.create_index(
        "ix_database_addition_logs_entity_type", "database_addition_logs", ["entity_type"]
    )
    op.create_index("ix_database_addition_logs_match_id", "database_addition_logs", ["match_id"])
    op.create_table(
        "player_friend_codes",
        sa.Column("player_friend_code_id", sa.Integer(), primary_key=True),
        sa.Column("player_id", sa.Integer(), nullable=False),
        sa.Column("friend_code", sa.Text(), nullable=False),
        sa.Column("first_seen_match_id", sa.Integer()),
        sa.Column("last_seen_match_id", sa.Integer()),
        sa.ForeignKeyConstraint(["first_seen_match_id"], ["matches.match_id"]),
        sa.ForeignKeyConstraint(["last_seen_match_id"], ["matches.match_id"]),
        sa.ForeignKeyConstraint(["player_id"], ["players.player_id"]),
        sa.UniqueConstraint("friend_code", name="uq_player_friend_code"),
    )
    op.create_table(
        "player_aliases",
        sa.Column("player_alias_id", sa.Integer(), primary_key=True),
        sa.Column("player_id", sa.Integer(), nullable=False),
        sa.Column("alias_type", sa.Text(), nullable=False),
        sa.Column("alias_value", sa.Text(), nullable=False),
        sa.Column("first_seen_match_id", sa.Integer()),
        sa.Column("last_seen_match_id", sa.Integer()),
        sa.ForeignKeyConstraint(["first_seen_match_id"], ["matches.match_id"]),
        sa.ForeignKeyConstraint(["last_seen_match_id"], ["matches.match_id"]),
        sa.ForeignKeyConstraint(["player_id"], ["players.player_id"]),
        sa.UniqueConstraint("player_id", "alias_type", "alias_value", name="uq_player_alias_value"),
    )
    op.create_table(
        "player_season_entries",
        sa.Column("player_season_entry_id", sa.Integer(), primary_key=True),
        sa.Column("player_id", sa.Integer(), nullable=False),
        sa.Column("team_season_entry_id", sa.Integer(), nullable=False),
        sa.Column("season_id", sa.Integer(), nullable=False),
        sa.Column("division_id", sa.Integer(), nullable=False),
        sa.Column("primary_lounge_name", sa.Text()),
        sa.Column("primary_mii_name", sa.Text()),
        sa.Column("flag", sa.Text()),
        sa.Column("first_seen_match_id", sa.Integer()),
        sa.Column("last_seen_match_id", sa.Integer()),
        sa.ForeignKeyConstraint(["division_id"], ["divisions.division_id"]),
        sa.ForeignKeyConstraint(["first_seen_match_id"], ["matches.match_id"]),
        sa.ForeignKeyConstraint(["last_seen_match_id"], ["matches.match_id"]),
        sa.ForeignKeyConstraint(["player_id"], ["players.player_id"]),
        sa.ForeignKeyConstraint(["season_id"], ["seasons.season_id"]),
        sa.ForeignKeyConstraint(
            ["team_season_entry_id"], ["team_season_entries.team_season_entry_id"]
        ),
        sa.UniqueConstraint("player_id", "team_season_entry_id", name="uq_player_entry_team"),
    )
    op.create_table(
        "match_table_refs",
        sa.Column("match_table_ref_id", sa.Integer(), primary_key=True),
        sa.Column("match_id", sa.Integer(), nullable=False),
        sa.Column("ref_value", sa.Text(), nullable=False),
        sa.Column("ref_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["match_id"], ["matches.match_id"]),
        sa.UniqueConstraint("match_id", "ref_order", name="uq_match_ref_order"),
    )
    op.create_table(
        "match_teams",
        sa.Column("match_team_id", sa.Integer(), primary_key=True),
        sa.Column("match_id", sa.Integer(), nullable=False),
        sa.Column("team_season_entry_id", sa.Integer(), nullable=False),
        sa.Column("raw_team_key", sa.Text(), nullable=False),
        sa.Column("table_tag_str", sa.Text()),
        sa.Column("hex_color", sa.Text()),
        sa.Column("raw_total_score", sa.Integer(), nullable=False),
        sa.Column("team_penalty_points", sa.Integer(), nullable=False),
        sa.Column("table_penalty_str", sa.Text()),
        sa.Column("final_score", sa.Integer()),
        sa.ForeignKeyConstraint(["match_id"], ["matches.match_id"]),
        sa.ForeignKeyConstraint(
            ["team_season_entry_id"], ["team_season_entries.team_season_entry_id"]
        ),
        sa.UniqueConstraint("match_id", "raw_team_key", name="uq_match_team_key"),
    )
    op.create_table(
        "match_players",
        sa.Column("match_player_id", sa.Integer(), primary_key=True),
        sa.Column("match_team_id", sa.Integer(), nullable=False),
        sa.Column("player_id", sa.Integer(), nullable=False),
        sa.Column("player_season_entry_id", sa.Integer()),
        sa.Column("friend_code_raw", sa.Text(), nullable=False),
        sa.Column("lounge_name_raw", sa.Text()),
        sa.Column("mii_name_raw", sa.Text()),
        sa.Column("table_name_raw", sa.Text()),
        sa.Column("tag_raw", sa.Text()),
        sa.Column("flag", sa.Text()),
        sa.Column("table_str", sa.Text()),
        sa.Column("raw_total_score", sa.Integer(), nullable=False),
        sa.Column("player_penalty_points", sa.Integer(), nullable=False),
        sa.Column("had_penalties", sa.Boolean(), nullable=False),
        sa.Column("subbed_out", sa.Boolean(), nullable=False),
        sa.Column("gp_scores_json", sa.Text()),
        sa.ForeignKeyConstraint(["match_team_id"], ["match_teams.match_team_id"]),
        sa.ForeignKeyConstraint(["player_id"], ["players.player_id"]),
        sa.ForeignKeyConstraint(
            ["player_season_entry_id"], ["player_season_entries.player_season_entry_id"]
        ),
        sa.UniqueConstraint("match_team_id", "friend_code_raw", name="uq_match_player_friend_code"),
    )
    op.create_table(
        "track_aliases",
        sa.Column("track_alias_id", sa.Integer(), primary_key=True),
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("alias_value", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.track_id"]),
        sa.UniqueConstraint("track_id", "alias_value", name="uq_track_alias_value"),
    )
    op.create_table(
        "races",
        sa.Column("race_id", sa.Integer(), primary_key=True),
        sa.Column("match_id", sa.Integer(), nullable=False),
        sa.Column("race_number", sa.Integer(), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("track_name_raw", sa.Text(), nullable=False),
        sa.Column("has_penalty", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["match_id"], ["matches.match_id"]),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.track_id"]),
        sa.UniqueConstraint("match_id", "race_number", name="uq_race_match_number"),
    )
    op.create_table(
        "race_team_results",
        sa.Column("race_team_result_id", sa.Integer(), primary_key=True),
        sa.Column("race_id", sa.Integer(), nullable=False),
        sa.Column("match_team_id", sa.Integer(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("result_type", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.CheckConstraint("result_type IN ('missing_player')", name="ck_team_result_type"),
        sa.CheckConstraint(
            "reason IN ('short_roster', 'unreplaced_disconnect', 'unknown')",
            name="ck_team_result_reason",
        ),
        sa.ForeignKeyConstraint(["match_team_id"], ["match_teams.match_team_id"]),
        sa.ForeignKeyConstraint(["race_id"], ["races.race_id"]),
    )
    op.create_table(
        "race_player_results",
        sa.Column("race_player_result_id", sa.Integer(), primary_key=True),
        sa.Column("race_id", sa.Integer(), nullable=False),
        sa.Column("match_player_id", sa.Integer(), nullable=False),
        sa.Column("player_id", sa.Integer(), nullable=False),
        sa.Column("match_team_id", sa.Integer(), nullable=False),
        sa.Column("team_season_entry_id", sa.Integer(), nullable=False),
        sa.Column("score", sa.Integer()),
        sa.Column("position", sa.Integer()),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("role_source", sa.Text(), nullable=False),
        sa.Column("is_subbed_out_result", sa.Boolean(), nullable=False),
        sa.CheckConstraint("role IN ('runner', 'bagger', 'unknown')", name="ck_result_role"),
        sa.CheckConstraint(
            "role_source IN ('manual', 'inferred', 'unknown')", name="ck_result_role_source"
        ),
        sa.ForeignKeyConstraint(["match_player_id"], ["match_players.match_player_id"]),
        sa.ForeignKeyConstraint(["match_team_id"], ["match_teams.match_team_id"]),
        sa.ForeignKeyConstraint(["player_id"], ["players.player_id"]),
        sa.ForeignKeyConstraint(["race_id"], ["races.race_id"]),
        sa.ForeignKeyConstraint(
            ["team_season_entry_id"], ["team_season_entries.team_season_entry_id"]
        ),
        sa.UniqueConstraint("race_id", "match_player_id", name="uq_race_player_result"),
    )
    op.create_table(
        "penalties",
        sa.Column("penalty_id", sa.Integer(), primary_key=True),
        sa.Column("match_id", sa.Integer(), nullable=False),
        sa.Column("race_id", sa.Integer()),
        sa.Column("match_team_id", sa.Integer()),
        sa.Column("match_player_id", sa.Integer()),
        sa.Column("penalty_scope", sa.Text(), nullable=False),
        sa.Column("penalty_points", sa.Integer(), nullable=False),
        sa.Column("raw_penalty_text", sa.Text()),
        sa.Column("source_field", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "penalty_scope IN ('team', 'player', 'race', 'unknown')",
            name="ck_penalty_scope",
        ),
        sa.ForeignKeyConstraint(["match_id"], ["matches.match_id"]),
        sa.ForeignKeyConstraint(["match_player_id"], ["match_players.match_player_id"]),
        sa.ForeignKeyConstraint(["match_team_id"], ["match_teams.match_team_id"]),
        sa.ForeignKeyConstraint(["race_id"], ["races.race_id"]),
    )


def downgrade() -> None:
    op.drop_table("penalties")
    op.drop_table("race_player_results")
    op.drop_table("race_team_results")
    op.drop_table("races")
    op.drop_table("track_aliases")
    op.drop_table("match_players")
    op.drop_table("match_teams")
    op.drop_table("match_table_refs")
    op.drop_table("player_season_entries")
    op.drop_table("player_aliases")
    op.drop_table("player_friend_codes")
    op.drop_index("ix_database_addition_logs_match_id", table_name="database_addition_logs")
    op.drop_index("ix_database_addition_logs_entity_type", table_name="database_addition_logs")
    op.drop_index("ix_database_addition_logs_created_at", table_name="database_addition_logs")
    op.drop_table("database_addition_logs")
    op.drop_table("matches")
    op.drop_table("team_season_entries")
    op.drop_index("ix_team_logos_team_id", table_name="team_logos")
    op.drop_index("ix_team_logos_season_id", table_name="team_logos")
    op.drop_table("team_logos")
    op.drop_table("source_files")
    op.drop_table("tracks")
    op.drop_table("players")
    op.drop_table("teams")
    op.drop_table("divisions")
    op.drop_table("seasons")
