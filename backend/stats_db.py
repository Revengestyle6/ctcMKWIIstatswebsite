from dataclasses import dataclass

from sqlalchemy import and_, desc, func, select

from database import get_session_factory
from models import (
    Division,
    Match,
    Player,
    PlayerAlias,
    PlayerSeasonEntry,
    Race,
    RacePlayerResult,
    Season,
    Team,
    TeamSeasonEntry,
    Track,
)


SessionLocal = get_session_factory()


class AnalyticsError(ValueError):
    pass


class AmbiguousPlayerError(AnalyticsError):
    def __init__(self, query, season_code, division_code, candidates):
        self.query = query
        self.season_code = season_code
        self.division_code = division_code
        self.candidates = candidates
        super().__init__(f"Ambiguous player alias: {query}")


@dataclass(frozen=True)
class Scope:
    season_id: int
    division_id: int
    season_code: str
    division_code: str


@dataclass(frozen=True)
class PlayerLookupRow:
    player_id: int
    canonical_lounge_name: str | None
    primary_friend_code: str | None
    primary_lounge_name: str | None
    primary_mii_name: str | None
    clan_tag: str
    display_name: str


def normalize_season_code(value):
    if value is None or str(value).strip() == "":
        return None
    code = str(value).strip().lower()
    return code if code.startswith("s") else f"s{code}"


def normalize_division_code(value):
    if value is None or str(value).strip() == "":
        return None
    code = str(value).strip().lower()
    return code if code.startswith("d") else f"d{code}"


def _display_player(row):
    return (
        getattr(row, "display_name", None)
        or row.primary_lounge_name
        or row.canonical_lounge_name
        or row.primary_mii_name
        or ""
    )


def _ranked_alias_values(session, player_ids, alias_type, rank_by):
    if not player_ids:
        return {}

    rows = session.execute(
        select(
            PlayerAlias.player_id,
            PlayerAlias.alias_value,
            func.count(PlayerAlias.player_alias_id).label("uses"),
            func.max(PlayerAlias.last_seen_match_id).label("last_seen"),
            func.max(PlayerAlias.player_alias_id).label("alias_id"),
        )
        .where(
            PlayerAlias.player_id.in_(player_ids),
            PlayerAlias.alias_type == alias_type,
            PlayerAlias.alias_value.is_not(None),
            func.trim(PlayerAlias.alias_value) != "",
        )
        .group_by(PlayerAlias.player_id, PlayerAlias.alias_value)
    ).all()

    ranked = {}
    for row in rows:
        last_seen = row.last_seen or 0
        uses = row.uses or 0
        alias_id = row.alias_id or 0
        if rank_by == "recent":
            key = (last_seen, uses, alias_id)
        else:
            key = (uses, last_seen, alias_id)
        current = ranked.get(row.player_id)
        if current is None or key > current[0]:
            ranked[row.player_id] = (key, row.alias_value)

    return {player_id: value for player_id, (_, value) in ranked.items()}


def _display_names_for_players(session, player_ids, canonical_names=None):
    player_ids = list(dict.fromkeys(player_ids))
    canonical_names = canonical_names or {}
    recent_lounge_names = _ranked_alias_values(session, player_ids, "lounge_name", "recent")
    common_table_names = _ranked_alias_values(session, player_ids, "table_name", "common")
    common_mii_names = _ranked_alias_values(session, player_ids, "mii_name", "common")

    return {
        player_id: (
            recent_lounge_names.get(player_id)
            or canonical_names.get(player_id)
            or common_table_names.get(player_id)
            or common_mii_names.get(player_id)
            or ""
        )
        for player_id in player_ids
    }


def _score_filter():
    return and_(RacePlayerResult.score.is_not(None), RacePlayerResult.score <= 15)


def _get_scope(session, season=None, division=None, league_code="ctc"):
    season_code = normalize_season_code(season)
    division_code = normalize_division_code(division)

    if season_code is None:
        stmt = select(Season).where(Season.league_code == league_code)
        if division_code is not None:
            stmt = stmt.join(Division, Division.season_id == Season.season_id).where(
                Division.division_code == division_code
            )
        stmt = stmt.order_by(desc(Season.season_number), desc(Season.season_id)).limit(1)
        season_obj = session.execute(stmt).scalar_one_or_none()
    else:
        season_obj = session.execute(
            select(Season).where(
                Season.league_code == league_code,
                Season.season_code == season_code,
            )
        ).scalar_one_or_none()

    if season_obj is None:
        raise AnalyticsError("Invalid season")

    division_stmt = select(Division).where(Division.season_id == season_obj.season_id)
    if division_code is not None:
        division_stmt = division_stmt.where(Division.division_code == division_code)
    division_stmt = division_stmt.order_by(Division.division_code).limit(1)
    division_obj = session.execute(division_stmt).scalar_one_or_none()

    if division_obj is None:
        raise AnalyticsError(
            f"Invalid division for {season_obj.season_code}: {division_code or '(default)'}"
        )

    return Scope(
        season_id=season_obj.season_id,
        division_id=division_obj.division_id,
        season_code=season_obj.season_code,
        division_code=division_obj.division_code,
    )


def _valid_players(session, scope):
    rows = session.execute(
        select(
            Player.player_id,
            Player.canonical_lounge_name,
            Player.primary_friend_code,
            PlayerSeasonEntry.primary_lounge_name,
            PlayerSeasonEntry.primary_mii_name,
            TeamSeasonEntry.clan_tag,
        )
        .join(PlayerSeasonEntry, PlayerSeasonEntry.player_id == Player.player_id)
        .join(
            TeamSeasonEntry,
            TeamSeasonEntry.team_season_entry_id == PlayerSeasonEntry.team_season_entry_id,
        )
        .where(
            PlayerSeasonEntry.season_id == scope.season_id,
            PlayerSeasonEntry.division_id == scope.division_id,
        )
    ).all()
    canonical_names = {row.player_id: row.canonical_lounge_name for row in rows}
    display_names = _display_names_for_players(session, canonical_names.keys(), canonical_names)
    return [
        PlayerLookupRow(
            player_id=row.player_id,
            canonical_lounge_name=row.canonical_lounge_name,
            primary_friend_code=row.primary_friend_code,
            primary_lounge_name=row.primary_lounge_name,
            primary_mii_name=row.primary_mii_name,
            clan_tag=row.clan_tag,
            display_name=display_names.get(row.player_id, ""),
        )
        for row in rows
    ]


def _player_candidate_dict(row):
    return {
        "player_id": row.player_id,
        "name": _display_player(row),
        "team": row.clan_tag,
        "friend_code": row.primary_friend_code,
    }


def _resolve_player(session, player, scope):
    query_text = player.strip()
    query = query_text.lower()
    if not query_text:
        raise AnalyticsError("Player name is required")

    direct_rows = _valid_players(session, scope)
    direct_matches = []
    for row in direct_rows:
        names = [
            row.display_name,
            row.primary_lounge_name,
            row.primary_mii_name,
            row.canonical_lounge_name,
        ]
        if any(name and name.lower() == query for name in names):
            direct_matches.append(row)

    alias_player_ids = {
        row[0]
        for row in session.execute(
            select(PlayerAlias.player_id).where(func.lower(PlayerAlias.alias_value) == query)
        ).all()
    }
    alias_matches = [row for row in direct_rows if row.player_id in alias_player_ids]

    matches_by_id = {row.player_id: row for row in direct_matches + alias_matches}
    matches = list(matches_by_id.values())

    if not matches:
        valid_names = sorted({_display_player(row) for row in direct_rows if _display_player(row)})
        raise AnalyticsError(f"Invalid Player Name, Valid Players: {valid_names}")
    if len(matches) > 1:
        raise AmbiguousPlayerError(
            player,
            scope.season_code,
            scope.division_code,
            [_player_candidate_dict(row) for row in matches],
        )
    return matches[0]


def _resolve_team(session, team, scope):
    if not team or not team.strip():
        raise AnalyticsError("Team is required")
    query = team.strip().lower()
    row = session.execute(
        select(
            TeamSeasonEntry.team_season_entry_id,
            TeamSeasonEntry.clan_tag,
            TeamSeasonEntry.display_name,
            Team.canonical_name,
        )
        .join(Team, Team.team_id == TeamSeasonEntry.team_id)
        .where(
            TeamSeasonEntry.season_id == scope.season_id,
            TeamSeasonEntry.division_id == scope.division_id,
            func.lower(TeamSeasonEntry.clan_tag) == query,
        )
    ).first()
    if row is None:
        valid_teams = list_teams(season=scope.season_code, division=scope.division_code)
        raise AnalyticsError(f"Invalid Team Name, Valid Teams: {valid_teams}")
    return row


def _resolve_track(session, track, scope):
    if not track or not track.strip():
        raise AnalyticsError("Track name is required")
    query = track.strip().lower()
    row = session.execute(
        select(Track.track_id, Track.canonical_name)
        .join(Race, Race.track_id == Track.track_id)
        .join(Match, Match.match_id == Race.match_id)
        .where(
            Match.season_id == scope.season_id,
            Match.division_id == scope.division_id,
            func.lower(Track.canonical_name) == query,
        )
        .group_by(Track.track_id)
    ).first()
    if row is None:
        valid_tracks = list_tracks(season=scope.season_code, division=scope.division_code)
        raise AnalyticsError(f"Invalid Track Name, Valid Tracks: {valid_tracks}")
    return row


def _format_avg_rows(rows):
    return [f"{row['name']} - {row['average']} pts ({row['races']} races)" for row in rows]


def _format_track_rows(rows):
    return [f"{row['track']} - {row['average']} pts ({row['races']} races)" for row in rows]


def list_players(season=None, division=None):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division)
        players = {}
        for row in _valid_players(session, scope):
            display_name = _display_player(row)
            if display_name:
                players[display_name.lower()] = display_name
        return sorted(players.values(), key=lambda name: name.lower())


def list_seasons(league_code="ctc"):
    with SessionLocal() as session:
        rows = session.execute(
            select(
                Season.season_code,
                Season.season_number,
                Season.name,
                Season.status,
            )
            .where(Season.league_code == league_code)
            .order_by(desc(Season.season_number), desc(Season.season_id))
        ).all()
        return [
            {
                "season": row.season_code,
                "season_number": row.season_number,
                "name": row.name,
                "status": row.status,
            }
            for row in rows
        ]


def list_divisions(season=None, league_code="ctc"):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=None, league_code=league_code)
        rows = session.execute(
            select(Division.division_code, Division.division_name)
            .where(Division.season_id == scope.season_id)
            .order_by(Division.division_code)
        ).all()
        return [
            {"division": row.division_code, "name": row.division_name}
            for row in rows
        ]


def list_teams(season=None, division=None):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division)
        rows = session.execute(
            select(TeamSeasonEntry.clan_tag)
            .where(
                TeamSeasonEntry.season_id == scope.season_id,
                TeamSeasonEntry.division_id == scope.division_id,
            )
            .order_by(TeamSeasonEntry.clan_tag)
        ).scalars()
        return list(rows)


def list_tracks(season=None, division=None):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division)
        rows = session.execute(
            select(Track.canonical_name)
            .join(Race, Race.track_id == Track.track_id)
            .join(Match, Match.match_id == Race.match_id)
            .where(
                Match.season_id == scope.season_id,
                Match.division_id == scope.division_id,
            )
            .group_by(Track.track_id)
            .order_by(Track.canonical_name)
        ).scalars()
        return list(rows)


def findplayeravg(player, track="", division=None, team="", season=None):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division)
        player_row = _resolve_player(session, player, scope)
        team_filter = None
        if team:
            team_filter = _resolve_team(session, team, scope).team_season_entry_id

        if track:
            track_row = _resolve_track(session, track, scope)
            stmt = (
                select(
                    func.avg(RacePlayerResult.score).label("average"),
                    func.count(RacePlayerResult.race_player_result_id).label("races"),
                )
                .join(Race, Race.race_id == RacePlayerResult.race_id)
                .join(Match, Match.match_id == Race.match_id)
                .where(
                    Match.season_id == scope.season_id,
                    Match.division_id == scope.division_id,
                    RacePlayerResult.player_id == player_row.player_id,
                    Race.track_id == track_row.track_id,
                    _score_filter(),
                )
            )
            row = session.execute(stmt).one()
            return (
                round(float(row.average or 0), 1),
                _display_player(player_row),
                track_row.canonical_name,
                int(row.races or 0),
            )

        filters = [
            Match.season_id == scope.season_id,
            Match.division_id == scope.division_id,
            RacePlayerResult.player_id == player_row.player_id,
            _score_filter(),
        ]
        if team_filter is not None:
            filters.append(RacePlayerResult.team_season_entry_id == team_filter)

        row = session.execute(
            select(
                (func.avg(RacePlayerResult.score) * 12).label("average"),
                func.count(RacePlayerResult.race_player_result_id).label("races"),
            )
            .join(Race, Race.race_id == RacePlayerResult.race_id)
            .join(Match, Match.match_id == Race.match_id)
            .where(*filters)
        ).one()
        return (
            round(float(row.average or 0), 1),
            _display_player(player_row),
            player_row.clan_tag,
            int(row.races or 0),
        )


def findteamavg(team, track, division=None, season=None):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division)
        team_row = _resolve_team(session, team, scope)
        track_row = _resolve_track(session, track, scope)
        row = session.execute(
            select(
                func.sum(RacePlayerResult.score).label("points"),
                func.count(func.distinct(Race.race_id)).label("races"),
            )
            .join(Race, Race.race_id == RacePlayerResult.race_id)
            .join(Match, Match.match_id == Race.match_id)
            .where(
                Match.season_id == scope.season_id,
                Match.division_id == scope.division_id,
                RacePlayerResult.team_season_entry_id == team_row.team_season_entry_id,
                Race.track_id == track_row.track_id,
                _score_filter(),
            )
        ).one()
        races = int(row.races or 0)
        average = (float(row.points or 0) / races) if races else 0.0
        return round(average, 1), team_row.clan_tag, track_row.canonical_name, races


def top_player_tracks(player, min_races=2, division=None, season=None):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division)
        player_row = _resolve_player(session, player, scope)
        rows = session.execute(
            select(
                Track.canonical_name.label("track"),
                func.avg(RacePlayerResult.score).label("average"),
                func.count(RacePlayerResult.race_player_result_id).label("races"),
            )
            .join(Race, Race.race_id == RacePlayerResult.race_id)
            .join(Match, Match.match_id == Race.match_id)
            .join(Track, Track.track_id == Race.track_id)
            .where(
                Match.season_id == scope.season_id,
                Match.division_id == scope.division_id,
                RacePlayerResult.player_id == player_row.player_id,
                _score_filter(),
            )
            .group_by(Track.track_id, Track.canonical_name)
            .having(func.count(RacePlayerResult.race_player_result_id) >= min_races)
            .order_by(desc("average"), desc("races"), Track.canonical_name)
        ).all()
        return [
            {"track": row.track, "average": round(float(row.average or 0), 1), "races": int(row.races)}
            for row in rows
        ]


def top_team_tracks(team, min_races=2, division=None, season=None):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division)
        team_row = _resolve_team(session, team, scope)
        rows = session.execute(
            select(
                Track.canonical_name.label("track"),
                (func.sum(RacePlayerResult.score) / func.count(func.distinct(Race.race_id))).label("average"),
                func.count(func.distinct(Race.race_id)).label("races"),
            )
            .join(Race, Race.race_id == RacePlayerResult.race_id)
            .join(Match, Match.match_id == Race.match_id)
            .join(Track, Track.track_id == Race.track_id)
            .where(
                Match.season_id == scope.season_id,
                Match.division_id == scope.division_id,
                RacePlayerResult.team_season_entry_id == team_row.team_season_entry_id,
                _score_filter(),
            )
            .group_by(Track.track_id, Track.canonical_name)
            .having(func.count(func.distinct(Race.race_id)) >= min_races)
            .order_by(desc("average"), desc("races"), Track.canonical_name)
        ).all()
        return [
            {"track": row.track, "average": round(float(row.average or 0), 1), "races": int(row.races)}
            for row in rows
        ]


def top_team_players(team, min_races=12, division=None, season=None):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division)
        team_row = _resolve_team(session, team, scope)
        rows = session.execute(
            select(
                Player.player_id,
                Player.canonical_lounge_name,
                Player.primary_friend_code,
                (func.avg(RacePlayerResult.score) * 12).label("average"),
                func.count(RacePlayerResult.race_player_result_id).label("races"),
            )
            .join(Player, Player.player_id == RacePlayerResult.player_id)
            .join(
                PlayerSeasonEntry,
                and_(
                    PlayerSeasonEntry.player_id == RacePlayerResult.player_id,
                    PlayerSeasonEntry.season_id == scope.season_id,
                    PlayerSeasonEntry.division_id == scope.division_id,
                    PlayerSeasonEntry.team_season_entry_id == team_row.team_season_entry_id,
                ),
            )
            .join(Race, Race.race_id == RacePlayerResult.race_id)
            .join(Match, Match.match_id == Race.match_id)
            .where(
                Match.season_id == scope.season_id,
                Match.division_id == scope.division_id,
                RacePlayerResult.team_season_entry_id == team_row.team_season_entry_id,
                _score_filter(),
            )
            .group_by(Player.player_id, Player.canonical_lounge_name, Player.primary_friend_code)
            .having(func.count(RacePlayerResult.race_player_result_id) >= min_races)
            .order_by(desc("average"), desc("races"), Player.player_id)
        ).all()
        display_names = _display_names_for_players(
            session,
            [row.player_id for row in rows],
            {row.player_id: row.canonical_lounge_name for row in rows},
        )
        return [
            {
                "name": display_names.get(row.player_id, ""),
                "average": round(float(row.average or 0), 1),
                "races": int(row.races),
            }
            for row in rows
        ]


def top_track_players(track, min_races=2, division=None, season=None):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division)
        track_row = _resolve_track(session, track, scope)
        rows = session.execute(
            select(
                Player.player_id,
                Player.canonical_lounge_name,
                Player.primary_friend_code,
                (func.avg(RacePlayerResult.score) * 12).label("average"),
                func.count(RacePlayerResult.race_player_result_id).label("races"),
            )
            .join(Player, Player.player_id == RacePlayerResult.player_id)
            .join(
                PlayerSeasonEntry,
                and_(
                    PlayerSeasonEntry.player_id == RacePlayerResult.player_id,
                    PlayerSeasonEntry.season_id == scope.season_id,
                    PlayerSeasonEntry.division_id == scope.division_id,
                    PlayerSeasonEntry.team_season_entry_id == RacePlayerResult.team_season_entry_id,
                ),
            )
            .join(Race, Race.race_id == RacePlayerResult.race_id)
            .join(Match, Match.match_id == Race.match_id)
            .where(
                Match.season_id == scope.season_id,
                Match.division_id == scope.division_id,
                Race.track_id == track_row.track_id,
                _score_filter(),
            )
            .group_by(Player.player_id, Player.canonical_lounge_name, Player.primary_friend_code)
            .having(func.count(RacePlayerResult.race_player_result_id) >= min_races)
            .order_by(desc("average"), desc("races"), Player.player_id)
        ).all()
        display_names = _display_names_for_players(
            session,
            [row.player_id for row in rows],
            {row.player_id: row.canonical_lounge_name for row in rows},
        )
        return [
            {
                "name": display_names.get(row.player_id, ""),
                "average": round(float(row.average or 0), 1),
                "races": int(row.races),
            }
            for row in rows
        ]


def top_track_teams(track, min_races=2, division=None, season=None):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division)
        track_row = _resolve_track(session, track, scope)
        rows = session.execute(
            select(
                TeamSeasonEntry.clan_tag.label("name"),
                (func.sum(RacePlayerResult.score) / func.count(func.distinct(Race.race_id))).label("average"),
                func.count(func.distinct(Race.race_id)).label("races"),
            )
            .join(Race, Race.race_id == RacePlayerResult.race_id)
            .join(Match, Match.match_id == Race.match_id)
            .join(
                TeamSeasonEntry,
                TeamSeasonEntry.team_season_entry_id == RacePlayerResult.team_season_entry_id,
            )
            .where(
                Match.season_id == scope.season_id,
                Match.division_id == scope.division_id,
                Race.track_id == track_row.track_id,
                _score_filter(),
            )
            .group_by(TeamSeasonEntry.team_season_entry_id, TeamSeasonEntry.clan_tag)
            .having(func.count(func.distinct(Race.race_id)) >= min_races)
            .order_by(desc("average"), desc("races"), TeamSeasonEntry.clan_tag)
        ).all()
        return [
            {"name": row.name, "average": round(float(row.average or 0), 1), "races": int(row.races)}
            for row in rows
        ]


def findtopplayertracks(player, min_races=2, division=None, season=None):
    return _format_track_rows(top_player_tracks(player, min_races, division, season))


def findtopteamtracks(team, min_races=2, division=None, season=None):
    return _format_track_rows(top_team_tracks(team, min_races, division, season))


def findtopteamplayers(team, min_races=12, division=None, season=None):
    return _format_avg_rows(top_team_players(team, min_races, division, season))


def findtoptracks(track, min_races=2, division=None, season=None):
    return _format_avg_rows(top_track_players(track, min_races, division, season))


def findtopteamsontrack(track, min_races=2, division=None, season=None):
    return _format_avg_rows(top_track_teams(track, min_races, division, season))
