import argparse
import csv
import hashlib
import json
import math
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from database import BASE_DIR, get_session_factory
from match_results import result_type
from mkc_registry import lookup_mkc_player
from models import (
    Division,
    DivisionPlayoffConfig,
    Match,
    MatchPlayer,
    MatchTableRef,
    MatchTeam,
    Penalty,
    Player,
    PlayerAlias,
    PlayerFriendCode,
    PlayerSeasonEntry,
    Race,
    RacePlayerResult,
    RaceTeamResult,
    Season,
    SourceFile,
    Team,
    TeamAlias,
    TeamLeagueIdentity,
    TeamSeasonEntry,
    Track,
    TrackAlias,
)
from player_naming import (
    MKC_ALIAS_TYPE,
    MKC_ID_ALIAS_TYPE,
    add_player_alias,
    apply_shared_mkc_name_priorities,
    latest_mkc_name,
)
from playoff_service import (
    ensure_match_label,
    match_type,
    playoff_format_new_entry,
    resolve_playoff_series,
    validate_competition_metadata,
    validate_playoff_against_existing,
)
from sqlalchemy import func, or_, select, update
from team_identity_management import apply_canonical_identity_priority

JSON_ROOT = BASE_DIR / "JSON"
HISTORICAL_TEAM_CORRECTIONS_PATH = BASE_DIR / "data" / "team_aliases.csv"
PLAYER_IDENTITY_PATH = BASE_DIR / "data" / "player_identities.csv"
LEGACY_WEEK_RE = re.compile(r"\bW(\d+)\b", re.IGNORECASE)
CREATE_PLAYER_IDENTITY = "create"


@dataclass
class PlayerIdentities:
    friend_code_to_canonical: dict[str, str] = field(default_factory=dict)
    canonical_to_friend_codes: dict[str, set[str]] = field(default_factory=dict)
    canonical_names: dict[str, str] = field(default_factory=dict)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def season_number_from_code(season_code: str) -> int | None:
    match = re.fullmatch(r"s(\d+)", season_code.lower())
    return int(match.group(1)) if match else None


def division_name_from_code(division_code: str) -> str:
    suffix = division_code[1:] if division_code.lower().startswith("d") else division_code
    return f"Division {suffix.replace('_', '-')}"


def match_number_from_filename(path: Path) -> int | None:
    """Read match numbers from historical archive names such as W3."""
    match = LEGACY_WEEK_RE.search(path.stem)
    return int(match.group(1)) if match else None


def preferred_json_files(root: Path) -> list[Path]:
    candidates = sorted(
        p for p in root.rglob("*") if p.suffix.lower() in {".json", ".txt"} and p.stat().st_size > 0
    )
    stems_with_json = {
        p.with_suffix("").as_posix() for p in candidates if p.suffix.lower() == ".json"
    }
    output = []
    for path in candidates:
        if path.suffix.lower() == ".txt" and path.with_suffix("").as_posix() in stems_with_json:
            continue
        output.append(path)
    return output


def is_missing_player_placeholder(player_data: dict[str, Any]) -> bool:
    return any(
        "missing player" in str(player_data.get(field) or "").lower()
        for field in ("table_str", "mii_name", "lounge_name", "table_name")
    )


def load_historical_team_corrections(
    path: Path = HISTORICAL_TEAM_CORRECTIONS_PATH,
) -> dict[tuple[str, str, str, str, str], dict[str, Any]]:
    """Load parsing corrections used only when rebuilding the historical archive."""
    aliases = {}
    if path.exists():
        with path.open("r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                key = (
                    (row.get("league_code") or "").strip(),
                    (row.get("season_code") or "").strip(),
                    (row.get("division_code") or "").strip(),
                    (row.get("match_label") or "").strip(),
                    (row.get("raw_team_key") or "").strip(),
                )
                aliases[key] = {
                    "canonical_tag": (row.get("canonical_tag") or "").strip(),
                    "display_name": (
                        row.get("display_name") or row.get("canonical_tag") or ""
                    ).strip(),
                    "note": (row.get("note") or "").strip(),
                }
    return aliases


def load_database_team_aliases(
    session,
) -> dict[tuple[str, str, str, str, str], dict[str, Any]]:
    """Load live, administrator-managed aliases from the operational database."""
    aliases = {}
    league_identities = session.execute(
        select(
            TeamLeagueIdentity.league_code,
            TeamLeagueIdentity.tag,
            Team.team_id,
            Team.canonical_tag,
            Team.canonical_name,
        )
        .join(Team, Team.team_id == TeamLeagueIdentity.team_id)
        .order_by(TeamLeagueIdentity.team_league_identity_id)
    )
    for row in league_identities:
        aliases[(row.league_code, "", "", "", row.tag)] = {
            "team_id": row.team_id,
            "canonical_tag": row.canonical_tag,
            "display_name": row.canonical_name,
            "note": "League-scoped team identity.",
        }
    database_aliases = session.execute(
        select(TeamAlias.alias_value, Team.team_id, Team.canonical_tag, Team.canonical_name)
        .join(Team, Team.team_id == TeamAlias.team_id)
        .order_by(TeamAlias.team_alias_id)
    )
    for row in database_aliases:
        aliases[("", "", "", "", row.alias_value)] = {
            "team_id": row.team_id,
            "canonical_tag": row.canonical_tag,
            "display_name": row.canonical_name,
            "note": "Database-managed team alias.",
        }
    return aliases


def load_archive_team_aliases(
    session,
) -> dict[tuple[str, str, str, str, str], dict[str, str]]:
    """Combine historical parsing corrections with live aliases for a full rebuild."""
    aliases = load_historical_team_corrections()
    aliases.update(load_database_team_aliases(session))
    return aliases


def load_player_identities(path: Path = PLAYER_IDENTITY_PATH) -> PlayerIdentities:
    identities = PlayerIdentities()
    if not path.exists():
        return identities

    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            canonical_friend_code = (row.get("canonical_friend_code") or "").strip()
            friend_code = (row.get("friend_code") or "").strip()
            canonical_name = (
                row.get("canonical_name") or row.get("canonical_lounge_name") or ""
            ).strip()
            if not canonical_friend_code or not friend_code:
                continue

            identities.friend_code_to_canonical[friend_code] = canonical_friend_code
            identities.canonical_to_friend_codes.setdefault(canonical_friend_code, set()).update(
                {canonical_friend_code, friend_code}
            )
            if canonical_name:
                identities.canonical_names[canonical_friend_code] = canonical_name
    return identities


def resolve_team_alias(
    aliases: dict[tuple[str, str, str, str, str], dict[str, str]],
    league_code: str,
    season_code: str,
    division_code: str,
    match_label: str,
    raw_team_key: str,
) -> dict[str, Any]:
    exact_key = (league_code, season_code, division_code, match_label, raw_team_key)
    division_key = (league_code, season_code, division_code, "", raw_team_key)
    league_key = (league_code, "", "", "", raw_team_key)
    global_key = ("", "", "", "", raw_team_key)
    return (
        aliases.get(exact_key)
        or aliases.get(division_key)
        or aliases.get(league_key)
        or aliases.get(global_key)
        or {
            "canonical_tag": raw_team_key,
            "display_name": raw_team_key,
            "note": "",
        }
    )


def get_or_create_season(session, league_code: str, season_code: str) -> Season:
    season = session.scalar(
        select(Season).where(Season.league_code == league_code, Season.season_code == season_code)
    )
    if season:
        return season

    season_number = season_number_from_code(season_code)
    name = f"{league_code.upper()} Season {season_number or season_code}"
    season = Season(
        league_code=league_code,
        season_code=season_code,
        season_number=season_number,
        name=name,
        status="unknown",
    )
    session.add(season)
    session.flush()
    return season


def get_or_create_division(session, season: Season, division_code: str) -> Division:
    division = session.scalar(
        select(Division).where(
            Division.season_id == season.season_id, Division.division_code == division_code
        )
    )
    if division:
        return division

    division = Division(
        season_id=season.season_id,
        division_code=division_code,
        division_name=division_name_from_code(division_code),
    )
    session.add(division)
    session.flush()
    return division


def get_or_create_team(
    session,
    league_code: str,
    canonical_tag: str,
    display_name: str | None = None,
    linked_team_id: int | None = None,
) -> Team:
    team = session.get(Team, linked_team_id) if linked_team_id is not None else None
    if team is None:
        team = session.scalar(
            select(Team)
            .join(TeamLeagueIdentity, TeamLeagueIdentity.team_id == Team.team_id)
            .where(
                func.lower(TeamLeagueIdentity.league_code) == league_code.casefold(),
                func.lower(TeamLeagueIdentity.tag) == canonical_tag.casefold(),
            )
        )
    if team:
        league_identity = session.scalar(
            select(TeamLeagueIdentity).where(
                TeamLeagueIdentity.team_id == team.team_id,
                func.lower(TeamLeagueIdentity.league_code) == league_code.casefold(),
                func.lower(TeamLeagueIdentity.tag) == canonical_tag.casefold(),
            )
        )
        if league_identity is None:
            session.add(
                TeamLeagueIdentity(
                    team_id=team.team_id,
                    league_code=league_code,
                    tag=canonical_tag,
                )
            )
        if (
            display_name
            and not team.canonical_identity_override
            and team.canonical_name == team.canonical_tag
        ):
            team.canonical_name = display_name
        session.flush()
        return team

    team = Team(canonical_name=display_name or canonical_tag, canonical_tag=canonical_tag)
    session.add(team)
    session.flush()
    session.add(
        TeamLeagueIdentity(team_id=team.team_id, league_code=league_code, tag=canonical_tag)
    )
    session.flush()
    return team


def get_or_create_team_entry(
    session,
    team: Team,
    season: Season,
    division: Division,
    canonical_tag: str,
    display_name: str,
    hex_color: str | None,
) -> TeamSeasonEntry:
    existing_team_entry = session.scalar(
        select(TeamSeasonEntry)
        .where(
            TeamSeasonEntry.team_id == team.team_id,
            TeamSeasonEntry.season_id == season.season_id,
            TeamSeasonEntry.division_id == division.division_id,
        )
        .order_by(TeamSeasonEntry.team_season_entry_id)
        .limit(1)
    )
    if existing_team_entry:
        if hex_color and not existing_team_entry.hex_color:
            existing_team_entry.hex_color = hex_color
        return existing_team_entry

    entry = session.scalar(
        select(TeamSeasonEntry).where(
            TeamSeasonEntry.season_id == season.season_id,
            TeamSeasonEntry.division_id == division.division_id,
            TeamSeasonEntry.clan_tag == canonical_tag,
        )
    )
    if entry:
        if hex_color and not entry.hex_color:
            entry.hex_color = hex_color
        return entry

    entry = TeamSeasonEntry(
        team_id=team.team_id,
        season_id=season.season_id,
        division_id=division.division_id,
        display_name=display_name,
        clan_tag=canonical_tag,
        hex_color=hex_color,
    )
    session.add(entry)
    session.flush()
    apply_canonical_identity_priority(session, team)
    session.flush()
    return entry


def display_player_name(player_data: dict[str, Any]) -> str | None:
    return (
        player_data.get("lounge_name")
        or player_data.get("table_name")
        or player_data.get("mii_name")
        or None
    )


def normalize_lounge_name(value: str | None) -> str:
    return " ".join(str(value or "").split()).casefold()


def player_identity_summary(session, player_id: int) -> dict[str, Any]:
    player = session.get(Player, player_id)
    friend_codes = session.scalars(
        select(PlayerFriendCode.friend_code)
        .where(PlayerFriendCode.player_id == player_id)
        .order_by(PlayerFriendCode.friend_code)
    ).all()
    return {
        "player_id": player_id,
        "canonical_name": player.canonical_name if player else None,
        "friend_codes": list(friend_codes),
    }


def lounge_name_player_ids(session, lounge_name: str | None) -> set[int]:
    normalized_name = normalize_lounge_name(lounge_name)
    if not normalized_name:
        return set()

    candidates: set[int] = set()
    for player_id, value in session.execute(
        select(Player.player_id, Player.canonical_name).where(Player.canonical_name.is_not(None))
    ):
        if normalize_lounge_name(value) == normalized_name:
            candidates.add(player_id)
    for player_id, value in session.execute(
        select(PlayerAlias.player_id, PlayerAlias.alias_value).where(
            PlayerAlias.alias_type == "lounge_name"
        )
    ):
        if normalize_lounge_name(value) == normalized_name:
            candidates.add(player_id)
    for player_id, value in session.execute(
        select(PlayerSeasonEntry.player_id, PlayerSeasonEntry.primary_lounge_name).where(
            PlayerSeasonEntry.primary_lounge_name.is_not(None)
        )
    ):
        if normalize_lounge_name(value) == normalized_name:
            candidates.add(player_id)
    return candidates


def get_or_create_player(
    session,
    friend_code: str,
    player_data: dict[str, Any],
    identities: PlayerIdentities,
    player_identity_links: dict[str, int | str] | None = None,
    player_mkc_profiles: dict[str, dict[str, Any]] | None = None,
) -> Player:
    canonical_friend_code = identities.friend_code_to_canonical.get(friend_code, friend_code)
    identity_friend_codes = identities.canonical_to_friend_codes.get(
        canonical_friend_code,
        {canonical_friend_code, friend_code},
    )
    friend_code_row = session.scalar(
        select(PlayerFriendCode).where(PlayerFriendCode.friend_code == friend_code)
    )
    if friend_code_row:
        player = session.get(Player, friend_code_row.player_id)
        if player and not player.primary_friend_code:
            player.primary_friend_code = canonical_friend_code
        return player

    linked_player_id = (player_identity_links or {}).get(friend_code)
    force_create = linked_player_id == CREATE_PLAYER_IDENTITY
    if force_create:
        canonical_friend_code = friend_code
        identity_friend_codes = {friend_code}
    if linked_player_id is not None and not force_create:
        player = session.get(Player, linked_player_id)
        if player is None:
            raise ValueError(
                f"Approved player {linked_player_id} no longer exists for friend code {friend_code}."
            )
        session.add(PlayerFriendCode(player_id=player.player_id, friend_code=friend_code))
        if not player.primary_friend_code:
            player.primary_friend_code = friend_code
        session.flush()
        return player

    if not force_create:
        identity_friend_code_row = session.scalar(
            select(PlayerFriendCode).where(PlayerFriendCode.friend_code.in_(identity_friend_codes))
        )
        if identity_friend_code_row:
            player = session.get(Player, identity_friend_code_row.player_id)
            if player:
                session.add(PlayerFriendCode(player_id=player.player_id, friend_code=friend_code))
                if canonical_friend_code != player.primary_friend_code:
                    player.primary_friend_code = canonical_friend_code
                canonical_name = identities.canonical_names.get(canonical_friend_code)
                if canonical_name:
                    player.canonical_name = canonical_name
                session.flush()
            return player

    mkc_profile = (player_mkc_profiles or {}).get(friend_code) or {}
    mkc_name = mkc_profile.get("mkc_name") if mkc_profile.get("status") == "found" else None
    mkc_player_id = (
        mkc_profile.get("mkc_player_id") if mkc_profile.get("status") == "found" else None
    )
    player = Player(
        canonical_name=mkc_name
        or identities.canonical_names.get(canonical_friend_code)
        or display_player_name(player_data),
        primary_friend_code=canonical_friend_code,
    )
    session.add(player)
    session.flush()

    session.add(PlayerFriendCode(player_id=player.player_id, friend_code=friend_code))
    if mkc_name:
        add_player_alias(session, player.player_id, MKC_ALIAS_TYPE, mkc_name)
    if mkc_player_id is not None:
        add_player_alias(session, player.player_id, MKC_ID_ALIAS_TYPE, str(mkc_player_id))
    session.flush()
    return player


def add_player_aliases(session, player: Player, player_data: dict[str, Any], match_id: int):
    for alias_type in ("lounge_name", "mii_name", "table_name"):
        alias_value = player_data.get(alias_type)
        if not alias_value:
            continue
        add_player_alias(
            session,
            player.player_id,
            alias_type,
            alias_value,
            first_seen_match_id=match_id,
            last_seen_match_id=match_id,
        )


def get_or_create_player_entry(
    session,
    player: Player,
    team_entry: TeamSeasonEntry,
    season: Season,
    division: Division,
    player_data: dict[str, Any],
    match_id: int,
) -> PlayerSeasonEntry:
    entry = session.scalar(
        select(PlayerSeasonEntry).where(
            PlayerSeasonEntry.player_id == player.player_id,
            PlayerSeasonEntry.team_season_entry_id == team_entry.team_season_entry_id,
        )
    )
    if entry:
        entry.last_seen_match_id = match_id
        lounge_name = player_data.get("lounge_name") or player_data.get("table_name")
        if lounge_name:
            entry.primary_lounge_name = lounge_name
        if player_data.get("mii_name"):
            entry.primary_mii_name = player_data.get("mii_name")
        if player_data.get("flag"):
            entry.flag = player_data.get("flag")
        return entry

    entry = PlayerSeasonEntry(
        player_id=player.player_id,
        team_season_entry_id=team_entry.team_season_entry_id,
        season_id=season.season_id,
        division_id=division.division_id,
        primary_lounge_name=player_data.get("lounge_name") or player_data.get("table_name"),
        primary_mii_name=player_data.get("mii_name"),
        flag=player_data.get("flag"),
        first_seen_match_id=match_id,
        last_seen_match_id=match_id,
    )
    session.add(entry)
    session.flush()
    return entry


def find_track_by_name(session, track_name: str, league_code: str | None = None) -> Track | None:
    normalized_name = track_name.strip().casefold()
    statement = (
        select(Track)
        .outerjoin(TrackAlias, TrackAlias.track_id == Track.track_id)
        .where(
            (func.lower(Track.canonical_name) == normalized_name)
            | (func.lower(TrackAlias.alias_value) == normalized_name)
        )
        .order_by(Track.track_id)
        .limit(1)
    )
    if league_code is not None:
        statement = statement.where(func.lower(Track.league_code) == league_code.casefold())
    return session.scalar(statement)


def get_or_create_track(session, league_code: str, track_name: str) -> Track:
    track = find_track_by_name(session, track_name, league_code)
    if not track:
        conflicting_track = find_track_by_name(session, track_name)
        if conflicting_track is not None:
            raise ValueError(
                f"Track {track_name} is registered for {conflicting_track.league_code.upper()} "
                f"and cannot be used in a {league_code.upper()} match."
            )
        track = Track(league_code=league_code, canonical_name=track_name)
        session.add(track)
        session.flush()

    alias = session.scalar(
        select(TrackAlias).where(
            TrackAlias.track_id == track.track_id,
            func.lower(TrackAlias.alias_value) == track_name.casefold(),
        )
    )
    if not alias:
        session.add(TrackAlias(track_id=track.track_id, alias_value=track_name))
    return track


def infer_role(position: int | None) -> tuple[str, str]:
    if (
        isinstance(position, bool)
        or not isinstance(position, (int, float))
        or not math.isfinite(position)
        or position != int(position)
        or not 1 <= position <= 10
    ):
        return "unknown", "unknown"
    if position >= 9:
        return "bagger", "inferred"
    return "runner", "inferred"


def resolve_role(explicit_role: Any, position: int | None) -> tuple[str, str]:
    normalized_role = explicit_role.strip().lower() if isinstance(explicit_role, str) else None
    if normalized_role in {"runner", "bagger"}:
        return normalized_role, "manual"
    return infer_role(position)


def backfill_inferred_roles(session) -> int:
    non_manual_sources = ("inferred", "unknown")
    bagger_result = session.execute(
        update(RacePlayerResult)
        .where(
            RacePlayerResult.role_source.in_(non_manual_sources),
            RacePlayerResult.position.in_((9, 10)),
            or_(
                RacePlayerResult.role != "bagger",
                RacePlayerResult.role_source != "inferred",
            ),
        )
        .values(role="bagger", role_source="inferred")
    )
    runner_result = session.execute(
        update(RacePlayerResult)
        .where(
            RacePlayerResult.role_source.in_(non_manual_sources),
            RacePlayerResult.position.between(1, 8),
            or_(
                RacePlayerResult.role != "runner",
                RacePlayerResult.role_source != "inferred",
            ),
        )
        .values(role="runner", role_source="inferred")
    )
    return (bagger_result.rowcount or 0) + (runner_result.rowcount or 0)


def normalize_match_objects(data: Any) -> tuple[str, list[dict[str, Any]]]:
    if isinstance(data, dict) and "teams" in data and "tracks" in data:
        return "single_match", [data]
    if isinstance(data, list):
        matches = [
            item for item in data if isinstance(item, dict) and "teams" in item and "tracks" in item
        ]
        return "match_array", matches
    return "unknown", []


def import_match(
    session,
    source_file: SourceFile,
    season: Season,
    division: Division,
    match_data: dict[str, Any],
    path: Path,
    match_index: int,
    aliases: dict[tuple[str, str, str, str, str], dict[str, str]],
    identities: PlayerIdentities,
    league_code: str,
    season_code: str,
    division_code: str,
    match_label_override: str | None = None,
    match_number_override: int | None = None,
    player_identity_links: dict[str, int | str] | None = None,
    team_identity_links: dict[str, int] | None = None,
    player_mkc_profiles: dict[str, dict[str, Any]] | None = None,
):
    teams = match_data.get("teams") or {}
    tracks = match_data.get("tracks") or []
    match_label = (
        match_label_override
        or str(match_data.get("match_label") or "").strip()
        or (path.stem if match_index == 0 else f"{path.stem} #{match_index + 1}")
    )
    review_notes = []
    if match_data.get("races_played") != len(tracks):
        review_notes.append(
            f"races_played={match_data.get('races_played')} but tracks length={len(tracks)}."
        )

    resolved_team_keys = []
    resolved_teams = {}
    team_identity_links = team_identity_links or {}
    for raw_team_key, team_data in teams.items():
        alias = resolve_team_alias(
            aliases, league_code, season_code, division_code, match_label, raw_team_key
        )
        canonical_tag = alias["canonical_tag"]
        display_name = alias["display_name"] or canonical_tag
        resolved_team_keys.append(canonical_tag)
        team = get_or_create_team(
            session,
            league_code,
            canonical_tag,
            display_name,
            linked_team_id=alias.get("team_id")
            or team_identity_links.get(canonical_tag.casefold()),
        )
        team_entry = get_or_create_team_entry(
            session,
            team,
            season,
            division,
            canonical_tag,
            display_name,
            team_data.get("hex_color"),
        )
        resolved_teams[raw_team_key] = (alias, team, team_entry)
        if alias.get("note"):
            review_notes.append(f"Team alias applied: {raw_team_key} -> {alias['canonical_tag']}.")
    if len(set(resolved_team_keys)) != 2:
        review_notes.append(
            f"Expected 2 resolved teams, found {len(set(resolved_team_keys))} from {len(teams)} raw team objects."
        )

    kind = match_type(match_data)
    match_number = (
        match_number_override
        if match_number_override is not None
        else match_number_from_filename(path)
    )
    playoff_series = None
    series_match_number = None
    if kind == "playoff":
        playoff_series, playoff_metadata = resolve_playoff_series(
            session,
            season.season_id,
            division,
            match_data,
            [resolved_teams[key][1].team_id for key in teams],
        )
        match_number = None
        series_match_number = playoff_metadata["series_match_number"]
        match_label = f"{playoff_series.display_label} — Match {series_match_number}"
    elif match_number is None:
        raise ValueError("Regular-season matches require a match number.")

    match = Match(
        season_id=season.season_id,
        division_id=division.division_id,
        source_file_id=source_file.source_file_id,
        match_index_in_source=match_index,
        match_type=kind,
        result_type=result_type(match_data),
        match_number=match_number,
        playoff_series_id=(
            playoff_series.playoff_series_id if playoff_series is not None else None
        ),
        series_match_number=series_match_number,
        match_label=match_label,
        title_str=match_data.get("title_str"),
        format=match_data.get("format"),
        races_played=match_data.get("races_played") or len(tracks),
        raw_json=json.dumps(match_data, ensure_ascii=False, separators=(",", ":")),
        import_status="needs_review"
        if len(set(resolved_team_keys)) != 2 or match_data.get("races_played") != len(tracks)
        else "imported",
        review_notes=" ".join(review_notes) if review_notes else None,
    )
    session.add(match)
    session.flush()

    for ref_order, ref_value in enumerate(match_data.get("rxx") or [], start=1):
        session.add(
            MatchTableRef(match_id=match.match_id, ref_value=ref_value, ref_order=ref_order)
        )

    race_by_number = {}
    for race_number, track_name in enumerate(tracks, start=1):
        track = get_or_create_track(session, league_code, track_name)
        race = Race(
            match_id=match.match_id,
            race_number=race_number,
            track_id=track.track_id,
            track_name_raw=track_name,
        )
        session.add(race)
        session.flush()
        race_by_number[race_number] = race

    match_team_by_canonical_tag = {}
    for raw_team_key, team_data in teams.items():
        alias, team, team_entry = resolved_teams[raw_team_key]
        canonical_tag = alias["canonical_tag"]
        match_team = match_team_by_canonical_tag.get(canonical_tag)
        if match_team:
            if raw_team_key != canonical_tag:
                match_team.raw_team_key = f"{match_team.raw_team_key}|{raw_team_key}"
            match_team.raw_total_score += team_data.get("total_score") or 0
            match_team.team_penalty_points += team_data.get("penalties") or 0
            match_team.final_score = (match_team.final_score or 0) + (
                team_data.get("total_score") or 0
            )
        else:
            match_team = MatchTeam(
                match_id=match.match_id,
                team_season_entry_id=team_entry.team_season_entry_id,
                raw_team_key=raw_team_key,
                table_tag_str=team_data.get("table_tag_str"),
                hex_color=team_data.get("hex_color"),
                raw_total_score=team_data.get("total_score") or 0,
                team_penalty_points=team_data.get("penalties") or 0,
                table_penalty_str=team_data.get("table_penalty_str"),
                final_score=team_data.get("total_score"),
            )
            session.add(match_team)
            session.flush()
            match_team_by_canonical_tag[canonical_tag] = match_team

        if team_data.get("penalties") or team_data.get("table_penalty_str"):
            session.add(
                Penalty(
                    match_id=match.match_id,
                    match_team_id=match_team.match_team_id,
                    penalty_scope="team",
                    penalty_points=team_data.get("penalties") or 0,
                    raw_penalty_text=team_data.get("table_penalty_str"),
                    source_field="team.penalties",
                )
            )

        explicit_missing_results = team_data.get("missing_player_results") or []
        if explicit_missing_results:
            missing_results = explicit_missing_results
        else:
            missing_results = [
                {"race_number": index, "score": score, "reason": "unknown"}
                for index, score in enumerate(team_data.get("missing_player_scores") or [], start=1)
                if score is not None
            ]
        recorded_missing_races = set()
        for missing_result in missing_results:
            race = race_by_number.get(missing_result.get("race_number"))
            score = missing_result.get("score")
            if race is None or not isinstance(score, (int, float)):
                continue
            reason = missing_result.get("reason")
            if reason not in {"short_roster", "unreplaced_disconnect", "unknown"}:
                reason = "unknown"
            session.add(
                RaceTeamResult(
                    race_id=race.race_id,
                    match_team_id=match_team.match_team_id,
                    score=int(score),
                    result_type="missing_player",
                    reason=reason,
                )
            )
            recorded_missing_races.add(race.race_number)

        for friend_code, player_data in (team_data.get("players") or {}).items():
            placeholder = is_missing_player_placeholder(player_data)
            placeholder_score_total = sum(
                score
                for score, position in zip(
                    player_data.get("race_scores") or [],
                    player_data.get("race_positions") or [],
                )
                if placeholder and isinstance(score, (int, float)) and position is None
            )
            player = get_or_create_player(
                session,
                friend_code,
                player_data,
                identities,
                player_identity_links,
                player_mkc_profiles,
            )
            add_player_aliases(session, player, player_data, match.match_id)
            current_mkc_name = latest_mkc_name(session, player.player_id)
            if current_mkc_name:
                apply_shared_mkc_name_priorities(session, current_mkc_name)
            player_entry = get_or_create_player_entry(
                session, player, team_entry, season, division, player_data, match.match_id
            )
            match_player = MatchPlayer(
                match_team_id=match_team.match_team_id,
                player_id=player.player_id,
                player_season_entry_id=player_entry.player_season_entry_id,
                friend_code_raw=friend_code,
                lounge_name_raw=player_data.get("lounge_name"),
                mii_name_raw=player_data.get("mii_name"),
                table_name_raw=player_data.get("table_name"),
                tag_raw=player_data.get("tag"),
                flag=player_data.get("flag"),
                table_str=player_data.get("table_str"),
                raw_total_score=(player_data.get("total_score") or 0) - placeholder_score_total,
                player_penalty_points=player_data.get("penalties") or 0,
                had_penalties=bool(player_data.get("had_penalties")),
                subbed_out=bool(player_data.get("subbed_out")),
                gp_scores_json=json.dumps(player_data.get("gp_scores") or [], ensure_ascii=False),
            )
            session.add(match_player)
            session.flush()

            friend_code_row = session.scalar(
                select(PlayerFriendCode).where(PlayerFriendCode.friend_code == friend_code)
            )
            if friend_code_row:
                if not friend_code_row.first_seen_match_id:
                    friend_code_row.first_seen_match_id = match.match_id
                friend_code_row.last_seen_match_id = match.match_id

            if player_data.get("had_penalties") or player_data.get("penalties"):
                session.add(
                    Penalty(
                        match_id=match.match_id,
                        match_team_id=match_team.match_team_id,
                        match_player_id=match_player.match_player_id,
                        penalty_scope="player",
                        penalty_points=player_data.get("penalties") or 0,
                        raw_penalty_text=None,
                        source_field="player.penalties",
                    )
                )

            race_scores = player_data.get("race_scores") or []
            race_positions = player_data.get("race_positions") or []
            race_roles = player_data.get("race_roles") or []
            for race_number, race in race_by_number.items():
                idx = race_number - 1
                score = race_scores[idx] if idx < len(race_scores) else None
                position = race_positions[idx] if idx < len(race_positions) else None
                if placeholder and isinstance(score, (int, float)) and position is None:
                    if race_number not in recorded_missing_races:
                        session.add(
                            RaceTeamResult(
                                race_id=race.race_id,
                                match_team_id=match_team.match_team_id,
                                score=int(score),
                                result_type="missing_player",
                                reason="unknown",
                            )
                        )
                        recorded_missing_races.add(race_number)
                    score = None
                explicit_role = race_roles[idx] if idx < len(race_roles) else None
                role, role_source = resolve_role(explicit_role, position)
                session.add(
                    RacePlayerResult(
                        race_id=race.race_id,
                        match_player_id=match_player.match_player_id,
                        player_id=player.player_id,
                        match_team_id=match_team.match_team_id,
                        team_season_entry_id=team_entry.team_season_entry_id,
                        score=score,
                        position=position,
                        role=role,
                        role_source=role_source,
                        is_subbed_out_result=bool(player_data.get("subbed_out"))
                        and (score is None or position is None),
                    )
                )

    return match


def import_preview_match(
    session,
    match_data: dict[str, Any],
    player_identity_links: dict[str, int | str] | None = None,
    team_identity_links: dict[str, int] | None = None,
    player_mkc_profiles: dict[str, dict[str, Any]] | None = None,
) -> Match:
    token = uuid.uuid4().hex
    return import_editor_match(
        session,
        match_data,
        source_path=f"preview/{token}.json",
        source_filename=f"{token}.json",
        file_sha256=hashlib.sha256(f"preview:{token}".encode("utf-8")).hexdigest(),
        json_shape="preview",
        player_identity_links=player_identity_links,
        team_identity_links=team_identity_links,
        player_mkc_profiles=player_mkc_profiles,
    )


def import_editor_match(
    session,
    match_data: dict[str, Any],
    *,
    source_path: str,
    source_filename: str,
    file_sha256: str,
    json_shape: str = "single_match",
    player_identity_links: dict[str, int | str] | None = None,
    team_identity_links: dict[str, int] | None = None,
    player_mkc_profiles: dict[str, dict[str, Any]] | None = None,
    source_metadata: dict[str, Any] | None = None,
) -> Match:
    validate_competition_metadata(match_data)
    league_code = str(match_data.get("league") or "ctc").strip().lower()
    season_code = str(match_data.get("season") or "").strip().lower()
    division_code = str(match_data.get("division") or "").strip().lower()
    if not season_code or not division_code:
        raise ValueError("League, season, and division are required.")

    season = get_or_create_season(session, league_code, season_code)
    division = get_or_create_division(session, season, division_code)

    source_file = SourceFile(
        season_id=season.season_id,
        division_id=division.division_id,
        source_path=source_path,
        source_filename=source_filename,
        file_sha256=file_sha256,
        json_shape=json_shape,
        **(source_metadata or {}),
    )
    session.add(source_file)
    session.flush()

    label = ensure_match_label(match_data) or "Match preview"
    raw_match_number = match_data.get("match_number", match_data.get("week"))
    match_number = int(raw_match_number) if isinstance(raw_match_number, (int, float)) else None
    return import_match(
        session,
        source_file,
        season,
        division,
        match_data,
        Path(f"{label}.json"),
        0,
        load_database_team_aliases(session),
        load_player_identities(),
        league_code,
        season_code,
        division_code,
        match_label_override=label,
        match_number_override=match_number,
        player_identity_links=player_identity_links,
        team_identity_links=team_identity_links,
        player_mkc_profiles=player_mkc_profiles,
    )


def _new_entry(entry_type: str, value: str, *scope: str, **details: Any) -> dict[str, Any]:
    key_parts = [entry_type, *scope, value]
    return {
        "key": ":".join(str(part).strip().casefold() for part in key_parts),
        "type": entry_type,
        "value": value,
        **details,
    }


def _validated_player_identity_links(
    session,
    match_data: dict[str, Any],
    player_identity_links: dict[str, Any] | None,
) -> dict[str, int | str]:
    if not player_identity_links:
        return {}
    if not isinstance(player_identity_links, dict):
        raise ValueError("Player identity links must be an object keyed by friend code.")

    match_friend_codes = {
        friend_code
        for team_data in (match_data.get("teams") or {}).values()
        for friend_code in (team_data.get("players") or {})
    }
    validated = {}
    for friend_code, raw_player_id in player_identity_links.items():
        if friend_code not in match_friend_codes:
            raise ValueError(f"Player identity link {friend_code} is not present in this match.")
        existing = session.scalar(
            select(PlayerFriendCode).where(PlayerFriendCode.friend_code == friend_code)
        )
        if raw_player_id == CREATE_PLAYER_IDENTITY:
            if existing is not None:
                raise ValueError(
                    f"Friend code {friend_code} already belongs to player ID {existing.player_id}."
                )
            validated[friend_code] = CREATE_PLAYER_IDENTITY
            continue
        if isinstance(raw_player_id, bool):
            raise ValueError(f"Player identity link {friend_code} has an invalid player ID.")
        try:
            player_id = int(raw_player_id)
        except (TypeError, ValueError) as error:
            raise ValueError(
                f"Player identity link {friend_code} has an invalid player ID."
            ) from error
        if player_id < 1 or session.get(Player, player_id) is None:
            raise ValueError(f"Player ID {player_id} does not exist.")
        if existing is not None and existing.player_id != player_id:
            raise ValueError(
                f"Friend code {friend_code} already belongs to player ID {existing.player_id}."
            )
        validated[friend_code] = player_id
    return validated


def detect_new_entries(
    session,
    match_data: dict[str, Any],
    player_identity_links: dict[str, Any] | None = None,
    team_identity_resolutions: dict[str, Any] | None = None,
    lookup_mkc_profiles: bool = False,
) -> list[dict[str, Any]]:
    competition_metadata = (
        validate_competition_metadata(match_data)
        if match_type(match_data) == "playoff"
        else {"match_type": "regular"}
    )
    league_code = str(match_data.get("league") or "ctc").strip().lower()
    season_code = str(match_data.get("season") or "").strip().lower()
    division_code = str(match_data.get("division") or "").strip().lower()
    if not season_code or not division_code:
        raise ValueError("League, season, and division are required.")

    requested_identity_links = _validated_player_identity_links(
        session, match_data, player_identity_links
    )
    if team_identity_resolutions is None:
        team_identity_resolutions = {}
    if not isinstance(team_identity_resolutions, dict):
        raise ValueError("Team identity resolutions must be an object keyed by review entry.")
    entries: dict[str, dict[str, Any]] = {}
    league_exists = session.scalar(
        select(Season.season_id)
        .where(func.lower(Season.league_code) == league_code.casefold())
        .limit(1)
    )
    if league_exists is None:
        entry = _new_entry(
            "league",
            league_code,
            kind="new_league",
            league=league_code,
        )
        entries[entry["key"]] = entry
    season = session.scalar(
        select(Season).where(
            Season.league_code == league_code,
            Season.season_code == season_code,
        )
    )
    if season is None:
        entry = _new_entry(
            "season",
            season_code,
            league_code,
            kind="new_season",
            league=league_code,
        )
        entries[entry["key"]] = entry
        division = None
    else:
        division = session.scalar(
            select(Division).where(
                Division.season_id == season.season_id,
                Division.division_code == division_code,
            )
        )
    if division is None:
        existing_division_seasons = session.scalars(
            select(Season.season_code)
            .join(Division, Division.season_id == Season.season_id)
            .where(
                Season.league_code == league_code,
                Division.division_code == division_code,
                Season.season_code != season_code,
            )
            .order_by(Season.season_number, Season.season_code)
        ).all()
        entry = _new_entry(
            "division",
            division_code,
            league_code,
            season_code,
            kind="new_division",
            league=league_code,
            season=season_code,
            existing_seasons=list(existing_division_seasons),
        )
        entries[entry["key"]] = entry

    aliases = load_database_team_aliases(session)
    label = str(match_data.get("match_label") or "Match preview").strip() or "Match preview"
    existing_team_ids = []
    for raw_team_key in match_data.get("teams") or {}:
        alias = resolve_team_alias(
            aliases, league_code, season_code, division_code, label, raw_team_key
        )
        canonical_tag = alias["canonical_tag"]
        linked_team_id = alias.get("team_id")
        team = session.get(Team, linked_team_id) if linked_team_id is not None else None
        if team is None:
            team = session.scalar(
                select(Team)
                .join(TeamLeagueIdentity, TeamLeagueIdentity.team_id == Team.team_id)
                .where(
                    func.lower(TeamLeagueIdentity.league_code) == league_code.casefold(),
                    func.lower(TeamLeagueIdentity.tag) == canonical_tag.casefold(),
                )
            )
        if team is not None:
            existing_team_ids.append(team.team_id)
        cross_league_candidates = []
        if team is None:
            candidate_teams = (
                session.scalars(
                    select(Team)
                    .join(TeamLeagueIdentity, TeamLeagueIdentity.team_id == Team.team_id)
                    .where(
                        func.lower(TeamLeagueIdentity.tag) == canonical_tag.casefold(),
                        func.lower(TeamLeagueIdentity.league_code) != league_code.casefold(),
                    )
                    .order_by(Team.team_id)
                )
                .unique()
                .all()
            )
            for candidate in candidate_teams:
                identities = session.scalars(
                    select(TeamLeagueIdentity)
                    .where(TeamLeagueIdentity.team_id == candidate.team_id)
                    .order_by(
                        TeamLeagueIdentity.league_code,
                        TeamLeagueIdentity.team_league_identity_id,
                    )
                ).all()
                cross_league_candidates.append(
                    {
                        "team_id": candidate.team_id,
                        "canonical_tag": candidate.canonical_tag,
                        "canonical_name": candidate.canonical_name,
                        "league_identities": [
                            {"league": identity.league_code, "tag": identity.tag}
                            for identity in identities
                        ],
                    }
                )
        team_entry = None
        if team is not None and season is not None and division is not None:
            team_entry = session.scalar(
                select(TeamSeasonEntry).where(
                    TeamSeasonEntry.team_id == team.team_id,
                    TeamSeasonEntry.season_id == season.season_id,
                    TeamSeasonEntry.division_id == division.division_id,
                )
            )
        if team_entry is None:
            entry = _new_entry(
                "team",
                canonical_tag,
                league_code,
                season_code,
                division_code,
                kind=(
                    "existing_team_new_scope"
                    if team is not None
                    else "cross_league_team_match"
                    if cross_league_candidates
                    else "new_team"
                ),
                league=league_code,
                season=season_code,
                division=division_code,
                input_tag=raw_team_key,
                team_id=team.team_id if team is not None else None,
                canonical_name=team.canonical_name if team is not None else None,
                team_candidates=cross_league_candidates or None,
            )
            if cross_league_candidates:
                resolution = team_identity_resolutions.get(entry["key"])
                if resolution is not None:
                    if not isinstance(resolution, dict) or resolution.get("action") not in {
                        "link",
                        "create",
                    }:
                        raise ValueError(
                            f"Team identity resolution for {canonical_tag} must choose link or create."
                        )
                    entry["resolution"] = {"action": resolution["action"]}
                    if resolution["action"] == "link":
                        try:
                            selected_team_id = int(resolution.get("team_id"))
                        except (TypeError, ValueError) as error:
                            raise ValueError(
                                f"Team identity resolution for {canonical_tag} needs a valid team ID."
                            ) from error
                        candidate_ids = {
                            candidate["team_id"] for candidate in cross_league_candidates
                        }
                        if selected_team_id not in candidate_ids:
                            raise ValueError(
                                f"Team ID {selected_team_id} is not a valid cross-league match for {canonical_tag}."
                            )
                        entry["resolution"]["team_id"] = selected_team_id
            entries[entry["key"]] = entry

    if competition_metadata["match_type"] == "playoff":
        config = (
            session.get(DivisionPlayoffConfig, division.division_id)
            if division is not None
            else None
        )
        if config is None:
            details = playoff_format_new_entry(match_data)
            if details is not None:
                entry = _new_entry(
                    "playoff_format",
                    details["format_label"],
                    league_code,
                    season_code,
                    division_code,
                    kind="new_playoff_format",
                    league=league_code,
                    season=season_code,
                    division=division_code,
                    **details,
                )
                entries[entry["key"]] = entry
        validate_playoff_against_existing(session, division, match_data, existing_team_ids)

    identities = load_player_identities()
    for team_data in (match_data.get("teams") or {}).values():
        for friend_code, player_data in (team_data.get("players") or {}).items():
            existing = session.scalar(
                select(PlayerFriendCode).where(PlayerFriendCode.friend_code == friend_code)
            )
            if existing is None:
                candidate_ids: set[int] = set()
                match_reasons: list[str] = []
                requested_player_id = requested_identity_links.get(friend_code)
                force_create = requested_player_id == CREATE_PLAYER_IDENTITY
                if requested_player_id is not None and not force_create:
                    candidate_ids.add(requested_player_id)
                    match_reasons.append("administrator selection")
                elif not force_create:
                    canonical_friend_code = identities.friend_code_to_canonical.get(friend_code)
                    if canonical_friend_code:
                        identity_codes = identities.canonical_to_friend_codes.get(
                            canonical_friend_code,
                            {canonical_friend_code},
                        )
                        mapped_rows = session.scalars(
                            select(PlayerFriendCode.player_id).where(
                                PlayerFriendCode.friend_code.in_(identity_codes)
                            )
                        ).all()
                        if mapped_rows:
                            candidate_ids.update(mapped_rows)
                            match_reasons.append("identity mapping")

                    lounge_name = player_data.get("lounge_name")
                    lounge_candidates = lounge_name_player_ids(session, lounge_name)
                    if lounge_candidates:
                        candidate_ids.update(lounge_candidates)
                        match_reasons.append("exact lounge name")

                lounge_name = player_data.get("lounge_name")
                display_name = str(
                    lounge_name
                    or player_data.get("table_name")
                    or player_data.get("mii_name")
                    or friend_code
                ).strip()
                if len(candidate_ids) == 1:
                    player_id = next(iter(candidate_ids))
                    summary = player_identity_summary(session, player_id)
                    entry = _new_entry(
                        "player",
                        f"{display_name} ({friend_code})",
                        str(player_id),
                        kind="existing_player_new_friend_code",
                        friend_code=friend_code,
                        lounge_name=lounge_name,
                        proposed_player_id=player_id,
                        proposed_player=summary,
                        match_reason=" and ".join(match_reasons),
                    )
                    entries[entry["key"]] = entry
                    continue
                if len(candidate_ids) > 1:
                    entry = _new_entry(
                        "player",
                        f"{display_name} ({friend_code})",
                        kind="player_identity_conflict",
                        friend_code=friend_code,
                        lounge_name=lounge_name,
                        candidates=[
                            player_identity_summary(session, player_id)
                            for player_id in sorted(candidate_ids)
                        ],
                    )
                    entries[entry["key"]] = entry
                    continue
                entry = _new_entry(
                    "player",
                    f"{display_name} ({friend_code})",
                    kind="new_player_identity",
                    friend_code=friend_code,
                    lounge_name=lounge_name,
                )
                if lookup_mkc_profiles:
                    mkc_lookup = lookup_mkc_player(friend_code)
                    entry["mkc_lookup_status"] = mkc_lookup["status"]
                    if mkc_lookup["status"] == "found":
                        entry["mkc_name"] = mkc_lookup["mkc_name"]
                        entry["mkc_player_id"] = mkc_lookup["mkc_player_id"]
                    elif mkc_lookup.get("error"):
                        entry["mkc_error"] = mkc_lookup["error"]
                entries[entry["key"]] = entry

    for track_name in match_data.get("tracks") or []:
        if not isinstance(track_name, str) or not track_name.strip():
            continue
        existing = find_track_by_name(session, track_name, league_code)
        if existing is None:
            conflicting_track = find_track_by_name(session, track_name)
            if conflicting_track is not None:
                raise ValueError(
                    f"Track {track_name.strip()} is registered for "
                    f"{conflicting_track.league_code.upper()} and cannot be used in a "
                    f"{league_code.upper()} match."
                )
            entry = _new_entry(
                "track",
                track_name.strip(),
                league_code,
                kind="new_track",
                league=league_code,
            )
            entries[entry["key"]] = entry

    return sorted(entries.values(), key=lambda entry: (entry["type"], entry["value"].casefold()))


def import_file(
    session,
    path: Path,
    aliases: dict[tuple[str, str, str, str, str], dict[str, str]],
    identities: PlayerIdentities,
    json_root: Path = JSON_ROOT,
) -> tuple[int, int]:
    relative_parts = path.relative_to(json_root).parts
    if len(relative_parts) < 4:
        return 0, 0

    league_code, season_code, division_code = relative_parts[:3]
    season = get_or_create_season(session, league_code, season_code)
    division = get_or_create_division(session, season, division_code)
    file_hash = sha256_file(path)
    source_path = (Path("JSON") / Path(*relative_parts)).as_posix()

    existing_source = session.scalar(
        select(SourceFile).where(SourceFile.source_path == source_path)
    )
    existing_hash = session.scalar(select(SourceFile).where(SourceFile.file_sha256 == file_hash))
    if existing_source or existing_hash:
        return 0, 1

    data = json.loads(path.read_text(encoding="utf-8"))
    json_shape, matches = normalize_match_objects(data)
    if not matches:
        return 0, 0

    source_file = SourceFile(
        season_id=season.season_id,
        division_id=division.division_id,
        source_path=source_path,
        source_filename=path.name,
        file_sha256=file_hash,
        json_shape=json_shape,
        storage_provider="local",
        storage_object_key=source_path,
        archive_status="complete",
    )
    session.add(source_file)
    session.flush()

    for match_index, match_data in enumerate(matches):
        import_match(
            session,
            source_file,
            season,
            division,
            match_data,
            path,
            match_index,
            aliases,
            identities,
            league_code,
            season_code,
            division_code,
        )
    return len(matches), 0


def table_count(session, model) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def print_summary(session, imported_matches: int, skipped_files: int):
    print(f"Imported matches: {imported_matches}")
    print(f"Skipped duplicate files: {skipped_files}")
    for model in (
        Season,
        Division,
        SourceFile,
        Team,
        TeamSeasonEntry,
        Player,
        Match,
        MatchTeam,
        MatchPlayer,
        Track,
        Race,
        RacePlayerResult,
        RaceTeamResult,
        Penalty,
    ):
        print(f"{model.__tablename__}: {table_count(session, model)}")


def import_json_tree(database_target: str | None, json_root: Path):
    SessionLocal = get_session_factory(database_target)
    imported_matches = 0
    skipped_files = 0
    identities = load_player_identities()
    with SessionLocal() as session:
        aliases = load_archive_team_aliases(session)
        for path in preferred_json_files(json_root):
            with session.begin_nested():
                imported, skipped = import_file(
                    session, path, aliases, identities, json_root=json_root
                )
                imported_matches += imported
                skipped_files += skipped
        session.commit()
        print_summary(session, imported_matches, skipped_files)
    return imported_matches


def main():
    parser = argparse.ArgumentParser(
        description="Import archived match JSON files into the configured analytics database."
    )
    parser.add_argument(
        "--database-url",
        help="PostgreSQL URL. Defaults to DATABASE_URL; the schema must already be migrated.",
    )
    parser.add_argument(
        "--json-root", type=Path, default=JSON_ROOT, help="Root JSON archive directory."
    )
    args = parser.parse_args()
    import_json_tree(args.database_url, args.json_root)


if __name__ == "__main__":
    main()
