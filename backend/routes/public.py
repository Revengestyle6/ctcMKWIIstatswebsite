import logging
from io import BytesIO

import dashboard_stats as dashboards
import stats_db as stats
from dashboard_stats import DashboardError
from flask import Blueprint, jsonify, request, send_file
from match_editor_catalog import list_player_team_memberships, list_team_roster_pool
from media_storage import get_media_storage
from mkc_registry import lookup_mkc_player
from models import TeamLogo
from standings_service import get_division_standings

from routes.common import (
    division_arg,
    error_response,
    league_arg,
    match_set_arg,
    minimum_races_arg,
    optional_int_arg,
    role_arg,
    season_arg,
)

logger = logging.getLogger(__name__)
public_api = Blueprint("public_api", __name__)


@public_api.get("/api/team-logos/<int:logo_id>/content")
def api_team_logo_content(logo_id):
    try:
        with stats.SessionLocal() as session:
            logo = session.get(TeamLogo, logo_id)
            if logo is None or not logo.asset_path.startswith("team-logos/"):
                return jsonify({"error": "Team logo not found."}), 404
            media = get_media_storage().read(logo.asset_path)
        response = send_file(
            BytesIO(media.content),
            mimetype=media.content_type,
            download_name=f"team-logo-{logo_id}.webp",
            conditional=True,
            etag=True,
            max_age=31536000,
        )
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response
    except FileNotFoundError:
        return jsonify({"error": "Team logo content not found."}), 404


@public_api.get("/api/player")
def player_stats():
    player_name = request.args.get("name")
    if not player_name:
        return jsonify({"error": "Player name is required"}), 400
    try:
        role = role_arg()
        results = stats.findtopplayertracks(
            player_name,
            min_races=2,
            division=division_arg(),
            season=season_arg(),
            role=role,
            match_set=match_set_arg(),
            league=league_arg(),
        )
        return jsonify({"player": player_name, "role": role, "results": results})
    except Exception as error:
        return error_response(error)


@public_api.get("/api/player-avg")
def player_avg():
    player_name = request.args.get("name")
    if not player_name:
        return jsonify({"error": "Player name is required"}), 400
    try:
        result = stats.findplayeravg(
            player_name,
            division=division_arg(),
            season=season_arg(),
            role=role_arg(),
            match_set=match_set_arg(),
            league=league_arg(),
        )
        return jsonify(result)
    except Exception as error:
        return error_response(error)


@public_api.get("/api/players")
def api_players():
    try:
        return jsonify(
            stats.list_players(
                season=season_arg(), division=division_arg(), league_code=league_arg()
            )
        )
    except Exception as error:
        logger.exception("Failed to list players")
        return error_response(error)


@public_api.get("/api/player-directory")
def api_player_directory():
    try:
        return jsonify(
            stats.list_player_directory(
                season=season_arg(), division=division_arg(), league_code=league_arg()
            )
        )
    except Exception as error:
        return error_response(error)


@public_api.get("/api/player-identities")
def api_player_identities():
    try:
        friend_code = request.args.get("friend_code")
        result = stats.find_player_identities(
            friend_code=friend_code,
            query=request.args.get("query"),
        )
        if friend_code and not result["results"]:
            result["mkc_lookup"] = lookup_mkc_player(friend_code)
        return jsonify(result)
    except Exception as error:
        return error_response(error)


@public_api.get("/api/team-roster-pool")
def api_team_roster_pool():
    try:
        with stats.SessionLocal() as session:
            return jsonify(
                list_team_roster_pool(
                    session,
                    request.args.get("league"),
                    request.args.get("season"),
                    request.args.get("division"),
                    request.args.get("team_id", type=int),
                )
            )
    except Exception as error:
        return error_response(error)


@public_api.get("/api/player-team-memberships")
def api_player_team_memberships():
    try:
        raw_player_ids = request.args.get("player_ids", "")
        player_ids = [int(value.strip()) for value in raw_player_ids.split(",") if value.strip()]
        if len(player_ids) > 100:
            raise ValueError("No more than 100 player IDs may be checked at once.")
        with stats.SessionLocal() as session:
            return jsonify(
                list_player_team_memberships(
                    session,
                    request.args.get("league"),
                    request.args.get("season"),
                    request.args.get("division"),
                    player_ids,
                )
            )
    except Exception as error:
        return error_response(error)


@public_api.get("/api/players/<int:player_id>/overview")
def api_player_dashboard_overview(player_id):
    try:
        return jsonify(
            dashboards.get_player_overview(
                player_id,
                league=league_arg(),
                season=season_arg(),
                division=division_arg(),
                team_id=optional_int_arg("team_id"),
                min_races=minimum_races_arg(),
                role=role_arg(),
                match_set=match_set_arg(),
            )
        )
    except Exception as error:
        return error_response(error)


@public_api.get("/api/players/<int:player_id>/performance")
def api_player_dashboard_performance(player_id):
    try:
        return jsonify(
            dashboards.get_player_performance(
                player_id,
                league=league_arg(),
                season=season_arg(),
                division=division_arg(),
                team_id=optional_int_arg("team_id"),
                role=role_arg(),
                match_set=match_set_arg(),
            )
        )
    except Exception as error:
        return error_response(error)


@public_api.get("/api/players/<int:player_id>/tracks")
def api_player_dashboard_tracks(player_id):
    try:
        return jsonify(
            dashboards.get_player_tracks(
                player_id,
                league=league_arg(),
                season=season_arg(),
                division=division_arg(),
                team_id=optional_int_arg("team_id"),
                min_races=minimum_races_arg(),
                role=role_arg(),
                match_set=match_set_arg(),
            )
        )
    except Exception as error:
        return error_response(error)


@public_api.get("/api/teams/<int:team_id>/overview")
def api_team_dashboard_overview(team_id):
    try:
        return jsonify(
            dashboards.get_team_overview(
                team_id,
                league=league_arg(),
                season=season_arg(),
                division=division_arg(),
                opponent_team_id=optional_int_arg("opponent_team_id"),
                min_races=minimum_races_arg(),
                match_set=match_set_arg(),
            )
        )
    except Exception as error:
        return error_response(error)


@public_api.get("/api/teams/<int:team_id>/roster")
def api_team_dashboard_roster(team_id):
    try:
        return jsonify(
            dashboards.get_team_roster(
                team_id,
                league=league_arg(),
                season=season_arg(),
                division=division_arg(),
                opponent_team_id=optional_int_arg("opponent_team_id"),
                min_races=minimum_races_arg(),
                role=role_arg(),
                match_set=match_set_arg(),
            )
        )
    except Exception as error:
        return error_response(error)


@public_api.get("/api/teams/<int:team_id>/tracks")
def api_team_dashboard_tracks(team_id):
    try:
        return jsonify(
            dashboards.get_team_tracks(
                team_id,
                league=league_arg(),
                season=season_arg(),
                division=division_arg(),
                opponent_team_id=optional_int_arg("opponent_team_id"),
                min_races=minimum_races_arg(),
                match_set=match_set_arg(),
            )
        )
    except Exception as error:
        return error_response(error)


@public_api.get("/api/track-search")
def api_track_search():
    try:
        include_other_leagues = str(request.args.get("include_other_leagues") or "").lower() in {
            "1",
            "true",
            "yes",
        }
        return jsonify(
            stats.search_tracks(
                query=request.args.get("query"),
                league_code=league_arg(),
                include_other_leagues=include_other_leagues,
            )
        )
    except Exception as error:
        return error_response(error)


@public_api.get("/api/seasons")
def api_seasons():
    try:
        return jsonify(stats.list_seasons(league_code=league_arg()))
    except Exception as error:
        logger.exception("Failed to list seasons")
        return error_response(error)


@public_api.get("/api/match-scopes")
def api_match_scopes():
    try:
        return jsonify(stats.list_match_scopes())
    except Exception as error:
        return error_response(error)


@public_api.get("/api/team-scopes")
def api_team_scopes():
    try:
        return jsonify(stats.list_team_scopes())
    except Exception as error:
        return error_response(error)


@public_api.get("/api/divisions")
def api_divisions():
    try:
        return jsonify(stats.list_divisions(season=season_arg(), league_code=league_arg()))
    except Exception as error:
        logger.exception("Failed to list divisions")
        return error_response(error)


@public_api.get("/api/top-team-players")
def api_top_team_players():
    try:
        role = role_arg()
        min_races = minimum_races_arg()
    except (DashboardError, ValueError) as error:
        return error_response(error)
    try:
        return jsonify(
            stats.findtopteamplayers(
                request.args.get("team"),
                min_races,
                division=division_arg(),
                season=season_arg(),
                role=role,
                match_set=match_set_arg(),
                league=league_arg(),
            )
        )
    except Exception as error:
        logger.exception("Failed to rank team players")
        return error_response(error)


@public_api.get("/api/teams")
def api_teams():
    try:
        return jsonify(
            stats.list_teams(season=season_arg(), division=division_arg(), league_code=league_arg())
        )
    except Exception as error:
        logger.exception("Failed to list teams")
        return error_response(error)


@public_api.get("/api/matches")
def api_matches():
    try:
        return jsonify(
            stats.list_matches(
                league_code=league_arg(),
                season=season_arg(),
                division=division_arg(),
                team=request.args.get("team"),
                match_set=match_set_arg(),
            )
        )
    except Exception as error:
        logger.exception("Failed to list matches")
        return error_response(error)


@public_api.get("/api/standings")
def api_standings():
    try:
        with stats.SessionLocal() as session:
            return jsonify(
                get_division_standings(
                    session,
                    league=league_arg(),
                    season=season_arg(),
                    division=division_arg(),
                )
            )
    except Exception as error:
        logger.exception("Failed to build divisional standings")
        return error_response(error)


@public_api.get("/api/playoff-series")
def api_playoff_series():
    try:
        return jsonify(
            stats.list_playoff_series(
                league_code=league_arg(),
                season=season_arg(),
                division=division_arg(),
                team=request.args.get("team"),
            )
        )
    except Exception as error:
        logger.exception("Failed to list playoff series")
        return error_response(error)


@public_api.get("/api/matches/<int:match_id>")
def api_match_detail(match_id):
    try:
        return jsonify(stats.get_match_detail(match_id))
    except Exception as error:
        logger.exception("Failed to load match %s", match_id)
        return error_response(error)


@public_api.get("/api/top-team-tracks")
def api_top_team_tracks():
    try:
        min_races = minimum_races_arg(default=2)
    except DashboardError as error:
        return error_response(error)
    try:
        return jsonify(
            stats.findtopteamtracks(
                request.args.get("team"),
                min_races=min_races,
                division=division_arg(),
                season=season_arg(),
                match_set=match_set_arg(),
                league=league_arg(),
            )
        )
    except Exception as error:
        logger.exception("Failed to rank team tracks")
        return error_response(error)


@public_api.get("/api/tracks")
def api_tracks():
    try:
        return jsonify(
            stats.list_tracks(
                league_code=league_arg(),
                season=season_arg(),
                division=division_arg(),
                match_set=match_set_arg(),
            )
        )
    except Exception as error:
        logger.exception("Failed to list tracks")
        return error_response(error)


@public_api.get("/api/top-tracks")
def api_top_tracks():
    track = request.args.get("track")
    if not track:
        return jsonify({"error": "Track name is required"}), 400
    try:
        role = role_arg()
        min_races = minimum_races_arg(default=2)
    except (DashboardError, ValueError) as error:
        return error_response(error)
    try:
        return jsonify(
            stats.findtoptracks(
                track,
                min_races=min_races,
                division=division_arg(),
                season=season_arg(),
                role=role,
                match_set=match_set_arg(),
                league=league_arg(),
            )
        )
    except Exception as error:
        logger.exception("Failed to rank track players")
        return error_response(error)


@public_api.get("/api/top-teams-on-track")
def api_top_teams_on_track():
    track = request.args.get("track")
    if not track:
        return jsonify({"error": "Track name is required"}), 400
    try:
        min_races = minimum_races_arg(default=2)
        return jsonify(
            stats.findtopteamsontrack(
                track,
                min_races=min_races,
                division=division_arg(),
                season=season_arg(),
                match_set=match_set_arg(),
                league=league_arg(),
            )
        )
    except Exception as error:
        logger.exception("Failed to rank teams on track")
        return error_response(error)
