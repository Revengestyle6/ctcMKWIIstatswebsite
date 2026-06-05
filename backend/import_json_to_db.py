import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

from sqlalchemy import func, select

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
    Season,
    SourceFile,
    Team,
    TeamSeasonEntry,
    Track,
    TrackAlias,
)

JSON_ROOT = BASE_DIR / "JSON"
WEEK_RE = re.compile(r"\bW(\d+)\b", re.IGNORECASE)


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


def get_or_create_team(session, raw_team_key: str) -> Team:
    team = session.scalar(select(Team).where(Team.canonical_tag == raw_team_key))
    if team:
        return team

    team = Team(canonical_name=raw_team_key, canonical_tag=raw_team_key)
    session.add(team)
    session.flush()
    return team


def get_or_create_team_entry(
    session,
    team: Team,
    season: Season,
    division: Division,
    raw_team_key: str,
    hex_color: str | None,
) -> TeamSeasonEntry:
    entry = session.scalar(
        select(TeamSeasonEntry).where(
            TeamSeasonEntry.season_id == season.season_id,
            TeamSeasonEntry.division_id == division.division_id,
            TeamSeasonEntry.clan_tag == raw_team_key,
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
        display_name=raw_team_key,
        clan_tag=raw_team_key,
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


def get_or_create_player(session, friend_code: str, player_data: dict[str, Any]) -> Player:
    friend_code_row = session.scalar(select(PlayerFriendCode).where(PlayerFriendCode.friend_code == friend_code))
    if friend_code_row:
        return session.get(Player, friend_code_row.player_id)

    player = Player(canonical_lounge_name=display_player_name(player_data), primary_friend_code=friend_code)
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


def infer_role(score: int | None, position: int | None) -> tuple[str, str]:
    if score is None or position is None:
        return "unknown", "unknown"
    if score == 1:
        return "bagger", "inferred"
    return "runner", "inferred"


def normalize_match_objects(data: Any) -> tuple[str, list[dict[str, Any]]]:
    if isinstance(data, dict) and "teams" in data and "tracks" in data:
        return "single_match", [data]
    if isinstance(data, list):
        matches = [item for item in data if isinstance(item, dict) and "teams" in item and "tracks" in item]
        return "match_array", matches
    return "unknown", []


def import_match(session, source_file: SourceFile, season: Season, division: Division, match_data: dict[str, Any], path: Path, match_index: int):
    teams = match_data.get("teams") or {}
    tracks = match_data.get("tracks") or []
    review_notes = []
    if len(teams) != 2:
        review_notes.append(f"Expected 2 teams, found {len(teams)} raw team objects.")
    if match_data.get("races_played") != len(tracks):
        review_notes.append(
            f"races_played={match_data.get('races_played')} but tracks length={len(tracks)}."
        )

    match = Match(
        season_id=season.season_id,
        division_id=division.division_id,
        source_file_id=source_file.source_file_id,
        match_index_in_source=match_index,
        week_number=week_number_from_filename(path),
        match_label=path.stem if match_index == 0 else f"{path.stem} #{match_index + 1}",
        title_str=match_data.get("title_str"),
        format=match_data.get("format"),
        races_played=match_data.get("races_played") or len(tracks),
        raw_json=json.dumps(match_data, ensure_ascii=False, separators=(",", ":")),
        import_status="needs_review" if review_notes else "imported",
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

    for raw_team_key, team_data in teams.items():
        team = get_or_create_team(session, raw_team_key)
        team_entry = get_or_create_team_entry(
            session, team, season, division, raw_team_key, team_data.get("hex_color")
        )
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

        for friend_code, player_data in (team_data.get("players") or {}).items():
            player = get_or_create_player(session, friend_code, player_data)
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
                raw_total_score=player_data.get("total_score") or 0,
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
            for race_number, race in race_by_number.items():
                idx = race_number - 1
                score = race_scores[idx] if idx < len(race_scores) else None
                position = race_positions[idx] if idx < len(race_positions) else None
                role, role_source = infer_role(score, position)
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


def import_file(session, path: Path) -> tuple[int, int]:
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
        import_match(session, source_file, season, division, match_data, path, match_index)
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
    with SessionLocal() as session:
        for path in preferred_json_files(json_root):
            with session.begin_nested():
                imported, skipped = import_file(session, path)
                imported_matches += imported
                skipped_files += skipped
        session.commit()
        print_summary(session, imported_matches, skipped_files)
    return imported_matches


def main():
    parser = argparse.ArgumentParser(description="Import archived match JSON files into the analytics SQLite database.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="SQLite database path.")
    parser.add_argument("--json-root", type=Path, default=JSON_ROOT, help="Root JSON archive directory.")
    parser.add_argument("--rebuild", action="store_true", help="Delete and rebuild the SQLite database first.")
    args = parser.parse_args()

    args.db.parent.mkdir(parents=True, exist_ok=True)
    if args.rebuild:
        rebuild_database(args.db, args.json_root)
    else:
        import_json_tree(args.db, args.json_root)


if __name__ == "__main__":
    main()

