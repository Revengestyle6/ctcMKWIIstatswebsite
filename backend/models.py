from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from database import Base


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

    __table_args__ = (UniqueConstraint("season_id", "division_code", name="uq_division_season_code"),)


class SourceFile(Base):
    __tablename__ = "source_files"

    source_file_id = Column(Integer, primary_key=True)
    season_id = Column(Integer, ForeignKey("seasons.season_id"), nullable=False)
    division_id = Column(Integer, ForeignKey("divisions.division_id"), nullable=False)
    source_path = Column(Text, nullable=False)
    source_filename = Column(Text, nullable=False)
    file_sha256 = Column(Text, nullable=False)
    json_shape = Column(Text, nullable=False)
    imported_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("source_path", name="uq_source_file_path"),
        UniqueConstraint("file_sha256", name="uq_source_file_sha256"),
    )


class Team(Base):
    __tablename__ = "teams"

    team_id = Column(Integer, primary_key=True)
    canonical_name = Column(Text, nullable=False)
    canonical_tag = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (UniqueConstraint("canonical_tag", name="uq_team_canonical_tag"),)


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
        UniqueConstraint("season_id", "division_id", "clan_tag", name="uq_team_entry_season_division_tag"),
    )


class Player(Base):
    __tablename__ = "players"

    player_id = Column(Integer, primary_key=True)
    canonical_lounge_name = Column(Text)
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

    __table_args__ = (
        UniqueConstraint("player_id", "alias_type", "alias_value", name="uq_player_alias_value"),
    )


class PlayerSeasonEntry(Base):
    __tablename__ = "player_season_entries"

    player_season_entry_id = Column(Integer, primary_key=True)
    player_id = Column(Integer, ForeignKey("players.player_id"), nullable=False)
    team_season_entry_id = Column(Integer, ForeignKey("team_season_entries.team_season_entry_id"), nullable=False)
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
    week_number = Column(Integer)
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
        CheckConstraint("import_status IN ('imported', 'needs_review')", name="ck_match_import_status"),
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
    team_season_entry_id = Column(Integer, ForeignKey("team_season_entries.team_season_entry_id"), nullable=False)
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
    player_season_entry_id = Column(Integer, ForeignKey("player_season_entries.player_season_entry_id"))
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

    __table_args__ = (UniqueConstraint("match_team_id", "friend_code_raw", name="uq_match_player_friend_code"),)


class Track(Base):
    __tablename__ = "tracks"

    track_id = Column(Integer, primary_key=True)
    canonical_name = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (UniqueConstraint("canonical_name", name="uq_track_canonical_name"),)


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
    team_season_entry_id = Column(Integer, ForeignKey("team_season_entries.team_season_entry_id"), nullable=False)
    score = Column(Integer)
    position = Column(Integer)
    role = Column(Text, nullable=False, default="unknown")
    role_source = Column(Text, nullable=False, default="unknown")
    is_subbed_out_result = Column(Boolean, nullable=False, default=False)

    __table_args__ = (
        UniqueConstraint("race_id", "match_player_id", name="uq_race_player_result"),
        CheckConstraint("role IN ('runner', 'bagger', 'unknown')", name="ck_result_role"),
        CheckConstraint("role_source IN ('manual', 'inferred', 'unknown')", name="ck_result_role_source"),
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
        CheckConstraint("penalty_scope IN ('team', 'player', 'race', 'unknown')", name="ck_penalty_scope"),
    )
