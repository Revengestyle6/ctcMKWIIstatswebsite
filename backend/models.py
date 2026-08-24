import uuid
from datetime import datetime, timezone

from database import Base
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import relationship


def utc_now():
    return datetime.now(timezone.utc)


class Season(Base):
    __tablename__ = "seasons"

    season_id = Column(Integer, primary_key=True)
    league_code = Column(Text, nullable=False, default="ctc")
    season_code = Column(Text, nullable=False)
    season_number = Column(Integer)
    name = Column(Text, nullable=False)
    status = Column(Text, nullable=False, default="unknown")
    starts_on = Column(Date)
    ends_on = Column(Date)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    divisions = relationship("Division", back_populates="season")

    __table_args__ = (UniqueConstraint("league_code", "season_code", name="uq_season_league_code"),)


class Division(Base):
    __tablename__ = "divisions"

    division_id = Column(Integer, primary_key=True)
    season_id = Column(Integer, ForeignKey("seasons.season_id"), nullable=False)
    division_code = Column(Text, nullable=False)
    division_name = Column(Text, nullable=False)

    season = relationship("Season", back_populates="divisions")

    __table_args__ = (
        UniqueConstraint("season_id", "division_code", name="uq_division_season_code"),
    )


class DivisionPlayoffConfig(Base):
    __tablename__ = "division_playoff_configs"

    division_id = Column(Integer, ForeignKey("divisions.division_id"), primary_key=True)
    format_code = Column(Text, nullable=False)
    playoff_team_count = Column(Integer, nullable=False)
    semifinal_series_count = Column(Integer, nullable=False)
    finals_bye_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        CheckConstraint("playoff_team_count >= 2", name="ck_playoff_config_team_count"),
        CheckConstraint("semifinal_series_count >= 0", name="ck_playoff_config_semifinal_count"),
        CheckConstraint("finals_bye_count >= 0", name="ck_playoff_config_bye_count"),
    )


class PlayoffSeries(Base):
    __tablename__ = "playoff_series"

    playoff_series_id = Column(Integer, primary_key=True)
    season_id = Column(Integer, ForeignKey("seasons.season_id"), nullable=False)
    division_id = Column(Integer, ForeignKey("divisions.division_id"), nullable=False)
    stage = Column(Text, nullable=False)
    series_number = Column(Integer, nullable=False, default=1)
    best_of = Column(Integer, nullable=False, default=3)
    display_label = Column(Text)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "division_id", "stage", "series_number", name="uq_playoff_series_division_stage"
        ),
        CheckConstraint("stage IN ('semifinals', 'finals')", name="ck_playoff_series_stage"),
        CheckConstraint("series_number >= 1", name="ck_playoff_series_number"),
        CheckConstraint("best_of >= 1 AND best_of % 2 = 1", name="ck_playoff_series_best_of"),
        Index("ix_playoff_series_scope", "season_id", "division_id"),
    )


class PlayoffSeriesParticipant(Base):
    __tablename__ = "playoff_series_participants"

    playoff_series_participant_id = Column(Integer, primary_key=True)
    playoff_series_id = Column(
        Integer, ForeignKey("playoff_series.playoff_series_id"), nullable=False
    )
    team_id = Column(Integer, ForeignKey("teams.team_id"), nullable=False)
    participant_slot = Column(Integer, nullable=False)

    __table_args__ = (
        UniqueConstraint("playoff_series_id", "team_id", name="uq_playoff_series_participant_team"),
        UniqueConstraint(
            "playoff_series_id", "participant_slot", name="uq_playoff_series_participant_slot"
        ),
        CheckConstraint("participant_slot IN (1, 2)", name="ck_playoff_series_participant_slot"),
    )


class SourceFile(Base):
    __tablename__ = "source_files"

    source_file_id = Column(Integer, primary_key=True)
    season_id = Column(Integer, ForeignKey("seasons.season_id"), nullable=False)
    division_id = Column(Integer, ForeignKey("divisions.division_id"), nullable=False)
    source_path = Column(Text, nullable=False)
    source_filename = Column(Text, nullable=False)
    file_sha256 = Column(Text, nullable=False)
    json_shape = Column(Text, nullable=False)
    storage_provider = Column(Text, nullable=False, default="local")
    storage_object_key = Column(Text)
    archive_status = Column(Text, nullable=False, default="complete")
    storage_generation = Column(Text)
    accepted_by_admin_user_id = Column(Integer, ForeignKey("admin_users.admin_user_id"))
    review_submission_id = Column(Text, ForeignKey("review_submissions.submission_id"))
    archived_at = Column(DateTime(timezone=True))
    archive_attempts = Column(Integer, nullable=False, default=0)
    last_archive_error_code = Column(Text)
    imported_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("source_path", name="uq_source_file_path"),
        UniqueConstraint("file_sha256", name="uq_source_file_sha256"),
        CheckConstraint(
            "storage_provider IN ('local', 'gcs')", name="ck_source_file_storage_provider"
        ),
        CheckConstraint(
            "archive_status IN ('pending', 'complete', 'repair_required')",
            name="ck_source_file_archive_status",
        ),
    )


class DatabaseAdditionLog(Base):
    __tablename__ = "database_addition_logs"

    addition_log_id = Column(Integer, primary_key=True)
    match_id = Column(Integer, ForeignKey("matches.match_id"), index=True)
    entity_type = Column(Text, nullable=False, index=True)
    entity_id = Column(Integer, nullable=False)
    summary = Column(Text, nullable=False)
    details_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False, index=True)


class Team(Base):
    __tablename__ = "teams"

    team_id = Column(Integer, primary_key=True)
    canonical_name = Column(Text, nullable=False)
    canonical_tag = Column(Text, nullable=False)
    canonical_identity_override = Column(Boolean, nullable=False, default=False)
    canonical_league_preference = Column(Text)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)


class TeamLeagueIdentity(Base):
    """A league-scoped tag that explicitly resolves to one canonical team."""

    __tablename__ = "team_league_identities"

    team_league_identity_id = Column(Integer, primary_key=True)
    team_id = Column(
        Integer, ForeignKey("teams.team_id", ondelete="CASCADE"), nullable=False, index=True
    )
    league_code = Column(Text, nullable=False)
    tag = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        Index(
            "uq_team_league_identity_code_tag_ci",
            func.lower(league_code),
            func.lower(tag),
            unique=True,
        ),
    )


class TeamLogo(Base):
    __tablename__ = "team_logos"

    team_logo_id = Column(Integer, primary_key=True)
    team_id = Column(Integer, ForeignKey("teams.team_id"), nullable=False, index=True)
    season_id = Column(Integer, ForeignKey("seasons.season_id"), index=True)
    asset_path = Column(Text, nullable=False)
    alt_text = Column(Text, nullable=False)
    priority = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("team_id", "season_id", "asset_path", name="uq_team_logo_asset"),
    )


class TeamSeasonEntry(Base):
    __tablename__ = "team_season_entries"

    team_season_entry_id = Column(Integer, primary_key=True)
    team_id = Column(Integer, ForeignKey("teams.team_id"), nullable=False)
    season_id = Column(Integer, ForeignKey("seasons.season_id"), nullable=False)
    division_id = Column(Integer, ForeignKey("divisions.division_id"), nullable=False)
    display_name = Column(Text, nullable=False)
    clan_tag = Column(Text, nullable=False)
    hex_color = Column(Text)

    __table_args__ = (
        UniqueConstraint(
            "season_id", "division_id", "clan_tag", name="uq_team_entry_season_division_tag"
        ),
    )


class TeamAlias(Base):
    __tablename__ = "team_aliases"

    team_alias_id = Column(Integer, primary_key=True)
    team_id = Column(Integer, ForeignKey("teams.team_id"), nullable=False)
    alias_value = Column(Text, nullable=False)

    __table_args__ = (UniqueConstraint("alias_value", name="uq_team_alias_value"),)


class Player(Base):
    __tablename__ = "players"

    player_id = Column(Integer, primary_key=True)
    canonical_name = Column(Text)
    canonical_name_override = Column(Boolean, nullable=False, default=False)
    primary_friend_code = Column(Text)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)


class PlayerFriendCode(Base):
    __tablename__ = "player_friend_codes"

    player_friend_code_id = Column(Integer, primary_key=True)
    player_id = Column(Integer, ForeignKey("players.player_id"), nullable=False)
    friend_code = Column(Text, nullable=False)
    first_seen_match_id = Column(Integer, ForeignKey("matches.match_id"))
    last_seen_match_id = Column(Integer, ForeignKey("matches.match_id"))

    __table_args__ = (UniqueConstraint("friend_code", name="uq_player_friend_code"),)


class PlayerAlias(Base):
    __tablename__ = "player_aliases"

    player_alias_id = Column(Integer, primary_key=True)
    player_id = Column(Integer, ForeignKey("players.player_id"), nullable=False)
    alias_type = Column(Text, nullable=False)
    alias_value = Column(Text, nullable=False)
    first_seen_match_id = Column(Integer, ForeignKey("matches.match_id"))
    last_seen_match_id = Column(Integer, ForeignKey("matches.match_id"))
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    last_observed_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("player_id", "alias_type", "alias_value", name="uq_player_alias_value"),
    )


class PlayerSeasonEntry(Base):
    __tablename__ = "player_season_entries"

    player_season_entry_id = Column(Integer, primary_key=True)
    player_id = Column(Integer, ForeignKey("players.player_id"), nullable=False)
    team_season_entry_id = Column(
        Integer, ForeignKey("team_season_entries.team_season_entry_id"), nullable=False
    )
    season_id = Column(Integer, ForeignKey("seasons.season_id"), nullable=False)
    division_id = Column(Integer, ForeignKey("divisions.division_id"), nullable=False)
    primary_lounge_name = Column(Text)
    primary_mii_name = Column(Text)
    flag = Column(Text)
    first_seen_match_id = Column(Integer, ForeignKey("matches.match_id"))
    last_seen_match_id = Column(Integer, ForeignKey("matches.match_id"))

    __table_args__ = (
        UniqueConstraint("player_id", "team_season_entry_id", name="uq_player_entry_team"),
    )


class Match(Base):
    __tablename__ = "matches"

    match_id = Column(Integer, primary_key=True)
    season_id = Column(Integer, ForeignKey("seasons.season_id"), nullable=False)
    division_id = Column(Integer, ForeignKey("divisions.division_id"), nullable=False)
    source_file_id = Column(Integer, ForeignKey("source_files.source_file_id"), nullable=False)
    match_index_in_source = Column(Integer, nullable=False, default=0)
    match_type = Column(Text, nullable=False, default="regular")
    match_number = Column(Integer)
    playoff_series_id = Column(Integer, ForeignKey("playoff_series.playoff_series_id"))
    series_match_number = Column(Integer)
    match_label = Column(Text, nullable=False)
    title_str = Column(Text)
    format = Column(Text)
    races_played = Column(Integer, nullable=False)
    raw_json = Column(Text)
    import_status = Column(Text, nullable=False, default="imported")
    review_notes = Column(Text)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("source_file_id", "match_index_in_source", name="uq_match_source_index"),
        CheckConstraint(
            "import_status IN ('imported', 'needs_review')", name="ck_match_import_status"
        ),
        CheckConstraint("match_type IN ('regular', 'playoff')", name="ck_match_type"),
        CheckConstraint(
            "(match_type = 'regular' AND playoff_series_id IS NULL "
            "AND series_match_number IS NULL) OR "
            "(match_type = 'playoff' AND match_number IS NULL "
            "AND playoff_series_id IS NOT NULL AND series_match_number >= 1)",
            name="ck_match_competition_metadata",
        ),
        UniqueConstraint(
            "playoff_series_id", "series_match_number", name="uq_match_playoff_series_number"
        ),
        Index("ix_matches_match_type", "match_type"),
    )


class MatchTableRef(Base):
    __tablename__ = "match_table_refs"

    match_table_ref_id = Column(Integer, primary_key=True)
    match_id = Column(Integer, ForeignKey("matches.match_id"), nullable=False)
    ref_value = Column(Text, nullable=False)
    ref_order = Column(Integer, nullable=False)

    __table_args__ = (UniqueConstraint("match_id", "ref_order", name="uq_match_ref_order"),)


class MatchTeam(Base):
    __tablename__ = "match_teams"

    match_team_id = Column(Integer, primary_key=True)
    match_id = Column(Integer, ForeignKey("matches.match_id"), nullable=False)
    team_season_entry_id = Column(
        Integer, ForeignKey("team_season_entries.team_season_entry_id"), nullable=False
    )
    raw_team_key = Column(Text, nullable=False)
    table_tag_str = Column(Text)
    hex_color = Column(Text)
    raw_total_score = Column(Integer, nullable=False, default=0)
    team_penalty_points = Column(Integer, nullable=False, default=0)
    table_penalty_str = Column(Text)
    final_score = Column(Integer)

    __table_args__ = (UniqueConstraint("match_id", "raw_team_key", name="uq_match_team_key"),)


class MatchPlayer(Base):
    __tablename__ = "match_players"

    match_player_id = Column(Integer, primary_key=True)
    match_team_id = Column(Integer, ForeignKey("match_teams.match_team_id"), nullable=False)
    player_id = Column(Integer, ForeignKey("players.player_id"), nullable=False)
    player_season_entry_id = Column(
        Integer, ForeignKey("player_season_entries.player_season_entry_id")
    )
    friend_code_raw = Column(Text, nullable=False)
    lounge_name_raw = Column(Text)
    mii_name_raw = Column(Text)
    table_name_raw = Column(Text)
    tag_raw = Column(Text)
    flag = Column(Text)
    table_str = Column(Text)
    raw_total_score = Column(Integer, nullable=False, default=0)
    player_penalty_points = Column(Integer, nullable=False, default=0)
    had_penalties = Column(Boolean, nullable=False, default=False)
    subbed_out = Column(Boolean, nullable=False, default=False)
    gp_scores_json = Column(Text)

    __table_args__ = (
        UniqueConstraint("match_team_id", "friend_code_raw", name="uq_match_player_friend_code"),
    )


class Track(Base):
    __tablename__ = "tracks"

    track_id = Column(Integer, primary_key=True)
    league_code = Column(Text, nullable=False, default="ctc", index=True)
    canonical_name = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("league_code", "canonical_name", name="uq_track_league_name"),
    )


class TrackAlias(Base):
    __tablename__ = "track_aliases"

    track_alias_id = Column(Integer, primary_key=True)
    track_id = Column(Integer, ForeignKey("tracks.track_id"), nullable=False)
    alias_value = Column(Text, nullable=False)

    __table_args__ = (UniqueConstraint("track_id", "alias_value", name="uq_track_alias_value"),)


class Race(Base):
    __tablename__ = "races"

    race_id = Column(Integer, primary_key=True)
    match_id = Column(Integer, ForeignKey("matches.match_id"), nullable=False)
    race_number = Column(Integer, nullable=False)
    track_id = Column(Integer, ForeignKey("tracks.track_id"), nullable=False)
    track_name_raw = Column(Text, nullable=False)
    has_penalty = Column(Boolean, nullable=False, default=False)

    __table_args__ = (UniqueConstraint("match_id", "race_number", name="uq_race_match_number"),)


class RaceTeamResult(Base):
    __tablename__ = "race_team_results"

    race_team_result_id = Column(Integer, primary_key=True)
    race_id = Column(Integer, ForeignKey("races.race_id"), nullable=False)
    match_team_id = Column(Integer, ForeignKey("match_teams.match_team_id"), nullable=False)
    score = Column(Integer, nullable=False)
    result_type = Column(Text, nullable=False, default="missing_player")
    reason = Column(Text, nullable=False, default="unknown")

    __table_args__ = (
        CheckConstraint("result_type IN ('missing_player')", name="ck_team_result_type"),
        CheckConstraint(
            "reason IN ('short_roster', 'unreplaced_disconnect', 'unknown')",
            name="ck_team_result_reason",
        ),
    )


class RacePlayerResult(Base):
    __tablename__ = "race_player_results"

    race_player_result_id = Column(Integer, primary_key=True)
    race_id = Column(Integer, ForeignKey("races.race_id"), nullable=False)
    match_player_id = Column(Integer, ForeignKey("match_players.match_player_id"), nullable=False)
    player_id = Column(Integer, ForeignKey("players.player_id"), nullable=False)
    match_team_id = Column(Integer, ForeignKey("match_teams.match_team_id"), nullable=False)
    team_season_entry_id = Column(
        Integer, ForeignKey("team_season_entries.team_season_entry_id"), nullable=False
    )
    score = Column(Integer)
    position = Column(Integer)
    role = Column(Text, nullable=False, default="unknown")
    role_source = Column(Text, nullable=False, default="unknown")
    is_subbed_out_result = Column(Boolean, nullable=False, default=False)

    __table_args__ = (
        UniqueConstraint("race_id", "match_player_id", name="uq_race_player_result"),
        CheckConstraint("role IN ('runner', 'bagger', 'unknown')", name="ck_result_role"),
        CheckConstraint(
            "role_source IN ('manual', 'inferred', 'unknown')", name="ck_result_role_source"
        ),
    )


class Penalty(Base):
    __tablename__ = "penalties"

    penalty_id = Column(Integer, primary_key=True)
    match_id = Column(Integer, ForeignKey("matches.match_id"), nullable=False)
    race_id = Column(Integer, ForeignKey("races.race_id"))
    match_team_id = Column(Integer, ForeignKey("match_teams.match_team_id"))
    match_player_id = Column(Integer, ForeignKey("match_players.match_player_id"))
    penalty_scope = Column(Text, nullable=False)
    penalty_points = Column(Integer, nullable=False)
    raw_penalty_text = Column(Text)
    source_field = Column(Text, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "penalty_scope IN ('team', 'player', 'race', 'unknown')", name="ck_penalty_scope"
        ),
    )


class AdminUser(Base):
    __tablename__ = "admin_users"

    admin_user_id = Column(Integer, primary_key=True)
    firebase_uid = Column(Text, unique=True)
    email = Column(Text, nullable=False)
    normalized_email = Column(Text, nullable=False, unique=True)
    role = Column(Text, nullable=False, default="admin")
    status = Column(Text, nullable=False, default="invited")
    github_username = Column(Text)
    database_access_status = Column(Text, nullable=False, default="not_requested")
    repository_access_status = Column(Text, nullable=False, default="not_requested")
    created_by_admin_user_id = Column(Integer, ForeignKey("admin_users.admin_user_id"))
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    activated_at = Column(DateTime(timezone=True))
    revoked_at = Column(DateTime(timezone=True))
    last_login_at = Column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint("role IN ('owner', 'admin')", name="ck_admin_user_role"),
        CheckConstraint("status IN ('invited', 'active', 'revoked')", name="ck_admin_user_status"),
        CheckConstraint(
            "database_access_status IN ('not_requested', 'provisioned', 'revoked')",
            name="ck_admin_user_database_access",
        ),
        CheckConstraint(
            "repository_access_status IN ('not_requested', 'provisioned', 'revoked')",
            name="ck_admin_user_repository_access",
        ),
    )


class ReviewSubmission(Base):
    __tablename__ = "review_submissions"

    submission_id = Column(Text, primary_key=True, default=lambda: str(uuid.uuid4()))
    fingerprint = Column(Text, nullable=False)
    queue_object_key = Column(Text, nullable=False, unique=True)
    original_filename = Column(Text, nullable=False)
    content_length = Column(Integer, nullable=False)
    validation_version = Column(Text, nullable=False)
    warnings_json = Column(Text, nullable=False, default="[]")
    warnings_acknowledged = Column(Boolean, nullable=False, default=False)
    status = Column(Text, nullable=False, default="pending")
    claimed_by_admin_user_id = Column(Integer, ForeignKey("admin_users.admin_user_id"))
    claimed_at = Column(DateTime(timezone=True))
    reviewed_by_admin_user_id = Column(Integer, ForeignKey("admin_users.admin_user_id"))
    reviewed_at = Column(DateTime(timezone=True))
    decision_note = Column(Text)
    accepted_match_id = Column(
        Integer,
        ForeignKey(
            "matches.match_id",
            name="fk_review_submissions_accepted_match_id",
            use_alter=True,
        ),
    )
    submitted_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'in_review', 'accepted', 'rejected', 'expired', 'failed')",
            name="ck_review_submission_status",
        ),
        Index("ix_review_submissions_status_submitted", "status", "submitted_at"),
        Index("ix_review_submissions_fingerprint", "fingerprint"),
        Index(
            "uq_review_submissions_active_fingerprint",
            "fingerprint",
            unique=True,
            postgresql_where=text("status IN ('pending', 'in_review')"),
        ),
    )


class SubmissionRateLimit(Base):
    __tablename__ = "submission_rate_limits"

    network_key = Column(Text, primary_key=True)
    window_started_at = Column(DateTime(timezone=True), primary_key=True)
    request_count = Column(Integer, nullable=False, default=1)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)


class HealthIssueReview(Base):
    __tablename__ = "health_issue_reviews"

    issue_key = Column(Text, primary_key=True)
    status = Column(Text, nullable=False)
    note = Column(Text, nullable=False, default="")
    reviewed_by_admin_user_id = Column(
        Integer, ForeignKey("admin_users.admin_user_id"), nullable=False
    )
    reviewed_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        CheckConstraint("status IN ('open', 'dismissed')", name="ck_health_issue_review_status"),
    )


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"

    admin_audit_log_id = Column(Integer, primary_key=True)
    admin_user_id = Column(Integer, ForeignKey("admin_users.admin_user_id"))
    action = Column(Text, nullable=False, index=True)
    target_type = Column(Text)
    target_id = Column(Text)
    request_id = Column(Text, nullable=False, index=True)
    details_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False, index=True)


class MkcRefreshPreview(Base):
    __tablename__ = "mkc_refresh_previews"

    preview_id = Column(Text, primary_key=True, default=lambda: str(uuid.uuid4()))
    scope = Column(Text, nullable=False)
    player_id = Column(Integer, ForeignKey("players.player_id"))
    status = Column(Text, nullable=False, default="pending")
    requested_by_admin_user_id = Column(Integer, ForeignKey("admin_users.admin_user_id"))
    applied_by_admin_user_id = Column(Integer, ForeignKey("admin_users.admin_user_id"))
    results_json = Column(Text, nullable=False)
    summary_json = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    decided_at = Column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint("scope IN ('bulk', 'individual')", name="ck_mkc_refresh_preview_scope"),
        CheckConstraint(
            "status IN ('pending', 'applied', 'rejected')",
            name="ck_mkc_refresh_preview_status",
        ),
    )
