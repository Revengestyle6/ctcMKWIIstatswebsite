import dashboard_stats as dashboards
from analytics_eligibility import apply_analytics_race_filter
from database import get_session_factory
from models import (
    Match,
    Race,
    RacePlayerResult,
    TeamSeasonEntry,
    Track,
)
from player_role_analytics import normalize_role, summarize_role_rows
from sqlalchemy import desc, func, select
from stats_queries import (
    AmbiguousPlayerError,
    AnalyticsError,
    PlayerLookupRow,
    Scope,
    _display_player,
    _get_scope,
    _resolve_player,
    _resolve_team,
    _resolve_track,
    _score_filter,
    find_player_identities,
    get_match_detail,
    list_divisions,
    list_match_scopes,
    list_matches,
    list_player_directory,
    list_players,
    list_seasons,
    list_team_scopes,
    list_teams,
    list_tracks,
    normalize_division_code,
    normalize_season_code,
    search_tracks,
)

__all__ = [
    "AmbiguousPlayerError",
    "AnalyticsError",
    "PlayerLookupRow",
    "Scope",
    "find_player_identities",
    "get_match_detail",
    "list_divisions",
    "list_match_scopes",
    "list_matches",
    "list_player_directory",
    "list_players",
    "list_seasons",
    "list_team_scopes",
    "list_teams",
    "list_tracks",
    "normalize_division_code",
    "normalize_season_code",
    "search_tracks",
]

SessionLocal = get_session_factory()


def findplayeravg(player, track="", division=None, team="", season=None, role="runner"):
    role = normalize_role(role)
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division)
        player_row = _resolve_player(session, player, scope)
        team_row = None
        if team:
            team_row = _resolve_team(session, team, scope)

        if track:
            track_row = _resolve_track(session, track, scope)
            tracks = dashboards.get_player_tracks(
                player_row.player_id,
                season=scope.season_code,
                division=scope.division_code,
                team_id=team_row.team_id if team_row else None,
                min_races=0,
                role=role,
                session=session,
            )
            metrics = next(
                (row for row in tracks["tracks"] if row["track_id"] == track_row.track_id),
                None,
            )
            if metrics is None:
                metrics = summarize_role_rows([], role)
            else:
                metrics = {
                    key: value for key, value in metrics.items() if key not in {"track_id", "name"}
                }
        else:
            overview = dashboards.get_player_overview(
                player_row.player_id,
                season=scope.season_code,
                division=scope.division_code,
                team_id=team_row.team_id if team_row else None,
                role=role,
                session=session,
            )
            metrics = overview["metrics"]

        return {
            "role": role,
            "player_id": player_row.player_id,
            "player_name": _display_player(player_row),
            "team_name": team_row.clan_tag if team_row else player_row.clan_tag,
            "metrics": metrics,
        }


def findteamavg(team, track, division=None, season=None):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division)
        team_row = _resolve_team(session, team, scope)
        track_row = _resolve_track(session, track, scope)
        statement = (
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
        )
        statement = apply_analytics_race_filter(statement, session)
        row = session.execute(statement).one()
        races = int(row.races or 0)
        average = (float(row.points or 0) / races) if races else 0.0
        return round(average, 1), team_row.clan_tag, track_row.canonical_name, races


def top_player_tracks(player, min_races=2, division=None, season=None, role="runner"):
    role = normalize_role(role)
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division)
        player_row = _resolve_player(session, player, scope)
        return dashboards.get_player_tracks(
            player_row.player_id,
            season=scope.season_code,
            division=scope.division_code,
            min_races=min_races,
            role=role,
            session=session,
        )["tracks"]


def top_team_tracks(team, min_races=2, division=None, season=None):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division)
        team_row = _resolve_team(session, team, scope)
        statement = (
            select(
                Track.canonical_name.label("track"),
                (func.sum(RacePlayerResult.score) / func.count(func.distinct(Race.race_id))).label(
                    "average"
                ),
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
        )
        statement = apply_analytics_race_filter(statement, session)
        rows = session.execute(statement).all()
        return [
            {
                "track": row.track,
                "average": round(float(row.average or 0), 1),
                "races": int(row.races),
            }
            for row in rows
        ]


def top_team_players(team, min_races=12, division=None, season=None, role="runner"):
    role = normalize_role(role)
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division)
        team_row = _resolve_team(session, team, scope)
        players = dashboards.get_team_roster(
            team_row.team_id,
            season=scope.season_code,
            division=scope.division_code,
            min_races=min_races,
            role=role,
            session=session,
        )["players"]
        return [{**player, "role": role} for player in players]


def top_track_players(track, min_races=2, division=None, season=None, role="runner"):
    role = normalize_role(role)
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division)
        track_row = _resolve_track(session, track, scope)
        players = dashboards.get_track_player_rankings(
            track_row.track_id,
            season=scope.season_code,
            division=scope.division_code,
            min_races=min_races,
            role=role,
            session=session,
        )["players"]
        rows = []
        for player in players:
            metrics = player.get("metrics", {})
            row = {
                "player_id": player.get("player_id"),
                "name": player.get("name"),
                "role": role,
                "races": metrics.get("races"),
                "scored_races": metrics.get("scored_races"),
                "points_per_race": metrics.get("points_per_race"),
                "twelve_race_pace": metrics.get("twelve_race_pace"),
                "bag_point_rate": metrics.get("bag_point_rate"),
                "zero_point_rate": metrics.get("zero_point_rate"),
                "average_placement": metrics.get("average_placement"),
                "total_points": metrics.get("total_points"),
                "excluded_score_rows": metrics.get("excluded_score_rows"),
            }
            if "role_coverage" in player:
                row["role_coverage"] = player["role_coverage"]
            rows.append(row)
        return rows


def top_track_teams(track, min_races=2, division=None, season=None):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division)
        track_row = _resolve_track(session, track, scope)
        statement = (
            select(
                TeamSeasonEntry.clan_tag.label("name"),
                (func.sum(RacePlayerResult.score) / func.count(func.distinct(Race.race_id))).label(
                    "average"
                ),
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
        )
        statement = apply_analytics_race_filter(statement, session)
        rows = session.execute(statement).all()
        return [
            {
                "name": row.name,
                "average": round(float(row.average or 0), 1),
                "races": int(row.races),
            }
            for row in rows
        ]


def findtopplayertracks(player, min_races=2, division=None, season=None, role="runner"):
    return top_player_tracks(player, min_races, division, season, role)


def findtopteamtracks(team, min_races=2, division=None, season=None):
    return top_team_tracks(team, min_races, division, season)


def findtopteamplayers(team, min_races=12, division=None, season=None, role="runner"):
    return top_team_players(team, min_races, division, season, role)


def findtoptracks(track, min_races=2, division=None, season=None, role="runner"):
    return top_track_players(track, min_races, division, season, role)


def findtopteamsontrack(track, min_races=2, division=None, season=None):
    return top_track_teams(track, min_races, division, season)
