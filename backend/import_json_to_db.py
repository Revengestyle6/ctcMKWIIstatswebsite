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

from sqlalchemy import func, or_, select, update

from database import DEFAULT_DB_PATH, BASE_DIR, get_session_factory, init_database
from models import (
    Division,
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
    TeamSeasonEntry,
    Track,
    TrackAlias,
)

JSON_ROOT = BASE_DIR / "JSON"
TEAM_ALIAS_PATH = BASE_DIR / "data" / "team_aliases.csv"
PLAYER_IDENTITY_PATH = BASE_DIR / "data" / "player_identities.csv"
WEEK_RE = re.compile(r"\bW(\d+)\b", re.IGNORECASE)


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


def week_number_from_filename(path: Path) -> int | None:
    match = WEEK_RE.search(path.stem)
    return int(match.group(1)) if match else None


def preferred_json_files(root: Path) -> list[Path]:
    candidates = sorted(
        p for p in root.rglob("*") if p.suffix.lower() in {".json", ".txt"} and p.stat().st_size > 0
    )
    stems_with_json = {p.with_suffix("").as_posix() for p in candidates if p.suffix.lower() == ".json"}
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


def load_team_aliases(path: Path = TEAM_ALIAS_PATH) -> dict[tuple[str, str, str, str, str], dict[str, str]]:
    if not path.exists():
        return {}

    aliases = {}
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
                "display_name": (row.get("display_name") or row.get("canonical_tag") or "").strip(),
                "note": (row.get("note") or "").strip(),
            }
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
            canonical_lounge_name = (row.get("canonical_lounge_name") or "").strip()
            if not canonical_friend_code or not friend_code:
                continue

            identities.friend_code_to_canonical[friend_code] = canonical_friend_code
            identities.canonical_to_friend_codes.setdefault(canonical_friend_code, set()).update(
                {canonical_friend_code, friend_code}
            )
            if canonical_lounge_name:
                identities.canonical_names[canonical_friend_code] = canonical_lounge_name
    return identities


def resolve_team_alias(
    aliases: dict[tuple[str, str, str, str, str], dict[str, str]],
    league_code: str,
    season_code: str,
    division_code: str,
    match_label: str,
    raw_team_key: str,
) -> dict[str, str]:
    exact_key = (league_code, season_code, division_code, match_label, raw_team_key)
    division_key = (league_code, season_code, division_code, "", raw_team_key)
    return aliases.get(exact_key) or aliases.get(division_key) or {
        "canonical_tag": raw_team_key,
        "display_name": raw_team_key,
        "note": "",
    }


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
        select(Division).where(Division.season_id == season.season_id, Division.division_code == division_code)
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


def get_or_create_team(session, canonical_tag: str, display_name: str | None = None) -> Team:
    team = session.scalar(select(Team).where(Team.canonical_tag == canonical_tag))
    if team:
        if display_name and team.canonical_name == team.canonical_tag:
            team.canonical_name = display_name
        return team

    team = Team(canonical_name=display_name or canonical_tag, canonical_tag=canonical_tag)
    session.add(team)
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
        "canonical_lounge_name": player.canonical_lounge_name if player else None,
        "friend_codes": list(friend_codes),
    }


def lounge_name_player_ids(session, lounge_name: str | None) -> set[int]:
    normalized_name = normalize_lounge_name(lounge_name)
    if not normalized_name:
        return set()

    candidates: set[int] = set()
    for player_id, value in session.execute(
        select(Player.player_id, Player.canonical_lounge_name)
        .where(Player.canonical_lounge_name.is_not(None))
    ):
        if normalize_lounge_name(value) == normalized_name:
            candidates.add(player_id)
    for player_id, value in session.execute(
        select(PlayerAlias.player_id, PlayerAlias.alias_value)
        .where(PlayerAlias.alias_type == "lounge_name")
    ):
        if normalize_lounge_name(value) == normalized_name:
            candidates.add(player_id)
    for player_id, value in session.execute(
        select(PlayerSeasonEntry.player_id, PlayerSeasonEntry.primary_lounge_name)
        .where(PlayerSeasonEntry.primary_lounge_name.is_not(None))
    ):
        if normalize_lounge_name(value) == normalized_name:
            candidates.add(player_id)
    return candidates


def get_or_create_player(
    session,
    friend_code: str,
    player_data: dict[str, Any],
    identities: PlayerIdentities,
    player_identity_links: dict[str, int] | None = None,
) -> Player:
    canonical_friend_code = identities.friend_code_to_canonical.get(friend_code, friend_code)
    identity_friend_codes = identities.canonical_to_friend_codes.get(
        canonical_friend_code,
        {canonical_friend_code, friend_code},
    )
    friend_code_row = session.scalar(select(PlayerFriendCode).where(PlayerFriendCode.friend_code == friend_code))
    if friend_code_row:
        player = session.get(Player, friend_code_row.player_id)
        if player and not player.primary_friend_code:
            player.primary_friend_code = canonical_friend_code
        return player

    linked_player_id = (player_identity_links or {}).get(friend_code)
    if linked_player_id is not None:
        player = session.get(Player, linked_player_id)
        if player is None:
            raise ValueError(f"Approved player {linked_player_id} no longer exists for friend code {friend_code}.")
        session.add(PlayerFriendCode(player_id=player.player_id, friend_code=friend_code))
        if not player.primary_friend_code:
            player.primary_friend_code = friend_code
        session.flush()
        return player

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
                player.canonical_lounge_name = canonical_name
            session.flush()
        return player

    player = Player(
        canonical_lounge_name=identities.canonical_names.get(canonical_friend_code) or display_player_name(player_data),
        primary_friend_code=canonical_friend_code,
    )
    session.add(player)
    session.flush()

    session.add(PlayerFriendCode(player_id=player.player_id, friend_code=friend_code))
    session.flush()
    return player


def add_player_aliases(session, player: Player, player_data: dict[str, Any], match_id: int):
    for alias_type in ("lounge_name", "mii_name", "table_name"):
        alias_value = player_data.get(alias_type)
        if not alias_value:
            continue
        alias = session.scalar(
            select(PlayerAlias).where(
                PlayerAlias.player_id == player.player_id,
                PlayerAlias.alias_type == alias_type,
                PlayerAlias.alias_value == alias_value,
            )
        )
        if alias:
            alias.last_seen_match_id = match_id
            continue
        session.add(
            PlayerAlias(
                player_id=player.player_id,
                alias_type=alias_type,
                alias_value=alias_value,
                first_seen_match_id=match_id,
                last_seen_match_id=match_id,
            )
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


def get_or_create_track(session, track_name: str) -> Track:
    track = session.scalar(select(Track).where(Track.canonical_name == track_name))
    if not track:
        track = Track(canonical_name=track_name)
        session.add(track)
        session.flush()

    alias = session.scalar(
        select(TrackAlias).where(TrackAlias.track_id == track.track_id, TrackAlias.alias_value == track_name)
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
    normalized_role = (
        explicit_role.strip().lower() if isinstance(explicit_role, str) else None
    )
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


def repair_inferred_roles(db_path: Path) -> int:
    init_database(db_path)
    SessionLocal = get_session_factory(db_path)
    with SessionLocal.begin() as session:
        updated_rows = backfill_inferred_roles(session)
    print(f"Database: {db_path.resolve()}")
    print(f"Repaired inferred roles: {updated_rows}")
    return updated_rows


def normalize_match_objects(data: Any) -> tuple[str, list[dict[str, Any]]]:
    if isinstance(data, dict) and "teams" in data and "tracks" in data:
        return "single_match", [data]
    if isinstance(data, list):
        matches = [item for item in data if isinstance(item, dict) and "teams" in item and "tracks" in item]
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
    week_number_override: int | None = None,
    player_identity_links: dict[str, int] | None = None,
):
    teams = match_data.get("teams") or {}
    tracks = match_data.get("tracks") or []
    match_label = match_label_override or (path.stem if match_index == 0 else f"{path.stem} #{match_index + 1}")
    review_notes = []
    if match_data.get("races_played") != len(tracks):
        review_notes.append(
            f"races_played={match_data.get('races_played')} but tracks length={len(tracks)}."
        )

    resolved_team_keys = []
    for raw_team_key in teams:
        alias = resolve_team_alias(aliases, league_code, season_code, division_code, match_label, raw_team_key)
        resolved_team_keys.append(alias["canonical_tag"])
        if alias.get("note"):
            review_notes.append(f"Team alias applied: {raw_team_key} -> {alias['canonical_tag']}.")
    if len(set(resolved_team_keys)) != 2:
        review_notes.append(
            f"Expected 2 resolved teams, found {len(set(resolved_team_keys))} from {len(teams)} raw team objects."
        )

    match = Match(
        season_id=season.season_id,
        division_id=division.division_id,
        source_file_id=source_file.source_file_id,
        match_index_in_source=match_index,
        week_number=week_number_override if week_number_override is not None else week_number_from_filename(path),
        match_label=match_label,
        title_str=match_data.get("title_str"),
        format=match_data.get("format"),
        races_played=match_data.get("races_played") or len(tracks),
        raw_json=json.dumps(match_data, ensure_ascii=False, separators=(",", ":")),
        import_status="needs_review" if len(set(resolved_team_keys)) != 2 or match_data.get("races_played") != len(tracks) else "imported",
        review_notes=" ".join(review_notes) if review_notes else None,
    )
    session.add(match)
    session.flush()

    for ref_order, ref_value in enumerate(match_data.get("rxx") or [], start=1):
        session.add(MatchTableRef(match_id=match.match_id, ref_value=ref_value, ref_order=ref_order))

    race_by_number = {}
    for race_number, track_name in enumerate(tracks, start=1):
        track = get_or_create_track(session, track_name)
        race = Race(match_id=match.match_id, race_number=race_number, track_id=track.track_id, track_name_raw=track_name)
        session.add(race)
        session.flush()
        race_by_number[race_number] = race

    match_team_by_canonical_tag = {}
    for raw_team_key, team_data in teams.items():
        alias = resolve_team_alias(aliases, league_code, season_code, division_code, match_label, raw_team_key)
        canonical_tag = alias["canonical_tag"]
        display_name = alias["display_name"] or canonical_tag
        team = get_or_create_team(session, canonical_tag, display_name)
        team_entry = get_or_create_team_entry(
            session, team, season, division, canonical_tag, display_name, team_data.get("hex_color")
        )
        match_team = match_team_by_canonical_tag.get(canonical_tag)
        if match_team:
            if raw_team_key != canonical_tag:
                match_team.raw_team_key = f"{match_team.raw_team_key}|{raw_team_key}"
            match_team.raw_total_score += team_data.get("total_score") or 0
            match_team.team_penalty_points += team_data.get("penalties") or 0
            match_team.final_score = (match_team.final_score or 0) + (team_data.get("total_score") or 0)
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
            )
            add_player_aliases(session, player, player_data, match.match_id)
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
                        is_subbed_out_result=bool(player_data.get("subbed_out")) and (score is None or position is None),
                    )
                )

    return match


def import_preview_match(
    session,
    match_data: dict[str, Any],
    player_identity_links: dict[str, int] | None = None,
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
    )


def import_editor_match(
    session,
    match_data: dict[str, Any],
    *,
    source_path: str,
    source_filename: str,
    file_sha256: str,
    json_shape: str = "single_match",
    player_identity_links: dict[str, int] | None = None,
) -> Match:
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
    )
    session.add(source_file)
    session.flush()

    label = str(match_data.get("match_label") or "Match preview").strip() or "Match preview"
    week = match_data.get("week")
    week_number = int(week) if isinstance(week, (int, float)) else None
    return import_match(
        session,
        source_file,
        season,
        division,
        match_data,
        Path(f"{label}.json"),
        0,
        load_team_aliases(),
        load_player_identities(),
        league_code,
        season_code,
        division_code,
        match_label_override=label,
        week_number_override=week_number,
        player_identity_links=player_identity_links,
    )


def _new_entry(entry_type: str, value: str, *scope: str, **details: Any) -> dict[str, Any]:
    key_parts = [entry_type, *scope, value]
    return {
        "key": ":".join(str(part).strip().casefold() for part in key_parts),
        "type": entry_type,
        "value": value,
        **details,
    }


def detect_new_entries(session, match_data: dict[str, Any]) -> list[dict[str, Any]]:
    league_code = str(match_data.get("league") or "ctc").strip().lower()
    season_code = str(match_data.get("season") or "").strip().lower()
    division_code = str(match_data.get("division") or "").strip().lower()
    if not season_code or not division_code:
        raise ValueError("League, season, and division are required.")

    entries: dict[str, dict[str, Any]] = {}
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

    aliases = load_team_aliases()
    label = str(match_data.get("match_label") or "Match preview").strip() or "Match preview"
    for raw_team_key in (match_data.get("teams") or {}):
        alias = resolve_team_alias(aliases, league_code, season_code, division_code, label, raw_team_key)
        canonical_tag = alias["canonical_tag"]
        team = session.scalar(select(Team).where(Team.canonical_tag == canonical_tag))
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
                kind="existing_team_new_scope" if team is not None else "new_team",
                league=league_code,
                season=season_code,
                division=division_code,
                input_tag=raw_team_key,
                team_id=team.team_id if team is not None else None,
                canonical_name=team.canonical_name if team is not None else None,
            )
            entries[entry["key"]] = entry

    identities = load_player_identities()
    for team_data in (match_data.get("teams") or {}).values():
        for friend_code, player_data in (team_data.get("players") or {}).items():
            existing = session.scalar(
                select(PlayerFriendCode).where(PlayerFriendCode.friend_code == friend_code)
            )
            if existing is None:
                candidate_ids: set[int] = set()
                match_reasons: list[str] = []
                canonical_friend_code = identities.friend_code_to_canonical.get(friend_code)
                if canonical_friend_code:
                    identity_codes = identities.canonical_to_friend_codes.get(
                        canonical_friend_code,
                        {canonical_friend_code},
                    )
                    mapped_rows = session.scalars(
                        select(PlayerFriendCode.player_id)
                        .where(PlayerFriendCode.friend_code.in_(identity_codes))
                    ).all()
                    if mapped_rows:
                        candidate_ids.update(mapped_rows)
                        match_reasons.append("identity mapping")

                lounge_name = player_data.get("lounge_name")
                lounge_candidates = lounge_name_player_ids(session, lounge_name)
                if lounge_candidates:
                    candidate_ids.update(lounge_candidates)
                    match_reasons.append("exact lounge name")

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
                        candidates=[player_identity_summary(session, player_id) for player_id in sorted(candidate_ids)],
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
                entries[entry["key"]] = entry

    for track_name in match_data.get("tracks") or []:
        if not isinstance(track_name, str) or not track_name.strip():
            continue
        normalized_track = track_name.strip().casefold()
        existing = session.scalar(
            select(Track.track_id)
            .outerjoin(TrackAlias, TrackAlias.track_id == Track.track_id)
            .where(
                (func.lower(Track.canonical_name) == normalized_track)
                | (func.lower(TrackAlias.alias_value) == normalized_track)
            )
            .limit(1)
        )
        if existing is None:
            entry = _new_entry("track", track_name.strip(), kind="new_track")
            entries[entry["key"]] = entry

    return sorted(entries.values(), key=lambda entry: (entry["type"], entry["value"].casefold()))


def import_file(
    session,
    path: Path,
    aliases: dict[tuple[str, str, str, str, str], dict[str, str]],
    identities: PlayerIdentities,
) -> tuple[int, int]:
    relative_parts = path.relative_to(JSON_ROOT).parts
    if len(relative_parts) < 4:
        return 0, 0

    league_code, season_code, division_code = relative_parts[:3]
    season = get_or_create_season(session, league_code, season_code)
    division = get_or_create_division(session, season, division_code)
    file_hash = sha256_file(path)
    source_path = path.relative_to(BASE_DIR).as_posix()

    existing_source = session.scalar(select(SourceFile).where(SourceFile.source_path == source_path))
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


def rebuild_database(db_path: Path, json_root: Path):
    if db_path.exists():
        db_path.unlink()
    for wal_sidecar in (db_path.with_suffix(db_path.suffix + "-wal"), db_path.with_suffix(db_path.suffix + "-shm")):
        if wal_sidecar.exists():
            wal_sidecar.unlink()
    init_database(db_path)
    return import_json_tree(db_path, json_root)


def import_json_tree(db_path: Path, json_root: Path):
    init_database(db_path)
    SessionLocal = get_session_factory(db_path)
    imported_matches = 0
    skipped_files = 0
    aliases = load_team_aliases()
    identities = load_player_identities()
    with SessionLocal() as session:
        for path in preferred_json_files(json_root):
            with session.begin_nested():
                imported, skipped = import_file(session, path, aliases, identities)
                imported_matches += imported
                skipped_files += skipped
        session.commit()
        print_summary(session, imported_matches, skipped_files)
    return imported_matches


def main():
    parser = argparse.ArgumentParser(description="Import archived match JSON files into the analytics SQLite database.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="SQLite database path.")
    parser.add_argument("--json-root", type=Path, default=JSON_ROOT, help="Root JSON archive directory.")
    operation = parser.add_mutually_exclusive_group()
    operation.add_argument("--rebuild", action="store_true", help="Delete and rebuild the SQLite database first.")
    operation.add_argument(
        "--repair-inferred-roles",
        action="store_true",
        help="Repair all existing non-manual roles from their recorded placements.",
    )
    args = parser.parse_args()

    args.db.parent.mkdir(parents=True, exist_ok=True)
    if args.repair_inferred_roles:
        repair_inferred_roles(args.db)
    elif args.rebuild:
        rebuild_database(args.db, args.json_root)
    else:
        import_json_tree(args.db, args.json_root)


if __name__ == "__main__":
    main()
