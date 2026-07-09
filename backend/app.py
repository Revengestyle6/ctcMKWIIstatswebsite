from flask import Flask, request, jsonify
from flask_caching import Cache
from flask_compress import Compress
import stats_db as stats
from stats_db import AmbiguousPlayerError
from flask_cors import CORS

app = Flask(__name__)
CORS(app)
Compress(app)
cache = Cache(app, config={'CACHE_TYPE': 'simple', 'CACHE_DEFAULT_TIMEOUT': 3600})


def _season_arg():
    return request.args.get("season")


def _division_arg():
    return request.args.get("division")


def _error_response(error):
    if isinstance(error, AmbiguousPlayerError):
        return jsonify({
            "error": "Ambiguous player alias",
            "query": error.query,
            "season": error.season_code,
            "division": error.division_code,
            "candidates": error.candidates,
        }), 400
    return jsonify({"error": str(error)}), 400

@app.route("/api/player", methods=["GET"])
def player_stats():
    player_name = request.args.get("name")
    division = _division_arg()
    season = _season_arg()
    if not player_name:
        return jsonify({"error": "Player name is required"}), 400
    try:
        results = stats.findtopplayertracks(player_name, min_races=2, division=division, season=season)
        return jsonify({"player": player_name, "results": results})
    except Exception as e:
        return _error_response(e)

@app.route("/api/player-avg", methods=["GET"])
def player_avg():
    player_name = request.args.get("name")
    division = _division_arg()
    season = _season_arg()
    if not player_name:
        return jsonify({"error": "Player name is required"}), 400
    try:
        avg, player_name_formatted, team_name, races = stats.findplayeravg(
            player_name,
            division=division,
            season=season,
        )
        return jsonify({
            "avg": avg,
            "player_name": player_name_formatted,
            "team_name": team_name,
            "races": races
        })
    except Exception as e:
        return _error_response(e)
    
@app.route("/api/players", methods=["GET"])
@cache.cached(timeout=3600, query_string=True)
def api_players():
    division = _division_arg()
    season = _season_arg()
    try:
        return jsonify(stats.list_players(season=season, division=division))
    except Exception as e:
        print(f"Error in api_players: {e}")
        return _error_response(e)


@app.route("/api/seasons", methods=["GET"])
@cache.cached(timeout=3600, query_string=True)
def api_seasons():
    try:
        return jsonify(stats.list_seasons())
    except Exception as e:
        print(f"Error in api_seasons: {e}")
        return _error_response(e)


@app.route("/api/divisions", methods=["GET"])
@cache.cached(timeout=3600, query_string=True)
def api_divisions():
    season = _season_arg()
    try:
        return jsonify(stats.list_divisions(season=season))
    except Exception as e:
        print(f"Error in api_divisions: {e}")
        return _error_response(e)

@app.route("/api/top-team-players", methods=["GET"])
def api_top_team_players():
    team = request.args.get("team")
    min_races = int(request.args.get("min_races", 12))
    division = _division_arg()
    season = _season_arg()
    try:
        players = stats.findtopteamplayers(team, min_races, division=division, season=season)
        return jsonify(players)
    except Exception as e:
        print(f"Error in api_top_team_players: {e}")
        return _error_response(e)

@app.route("/api/teams", methods=["GET"])
@cache.cached(timeout=3600, query_string=True)
def api_teams():
    division = _division_arg()
    season = _season_arg()
    try:
        return jsonify(stats.list_teams(season=season, division=division))
    except Exception as e:
        print(f"Error in api_teams: {e}")
        return _error_response(e)


@app.route("/api/matches", methods=["GET"])
@cache.cached(timeout=3600, query_string=True)
def api_matches():
    division = _division_arg()
    season = _season_arg()
    team = request.args.get("team")
    try:
        return jsonify(stats.list_matches(season=season, division=division, team=team))
    except Exception as e:
        print(f"Error in api_matches: {e}")
        return _error_response(e)


@app.route("/api/matches/<int:match_id>", methods=["GET"])
@cache.cached(timeout=3600, query_string=True)
def api_match_detail(match_id):
    try:
        return jsonify(stats.get_match_detail(match_id))
    except Exception as e:
        print(f"Error in api_match_detail: {e}")
        return _error_response(e)
    
@app.route("/api/top-team-tracks", methods=["GET"])
@cache.cached(timeout=3600, query_string=True)
def api_top_team_tracks():
    team = request.args.get("team")
    division = _division_arg()
    season = _season_arg()
    try:
        tracks = stats.findtopteamtracks(team, division=division, season=season)
        return jsonify(tracks)
    except Exception as e:
        print(f"Error in api_top_team_tracks: {e}")
        return _error_response(e)
    
@app.route("/api/tracks", methods=["GET"])
@cache.cached(timeout=3600, query_string=True)
def api_tracks():
    division = _division_arg()
    season = _season_arg()
    try:
        return jsonify(stats.list_tracks(season=season, division=division))
    except Exception as e:
        print(f"Error in api_tracks: {e}")
        return _error_response(e)

@app.route("/api/top-tracks", methods=["GET"])
@cache.cached(timeout=3600, query_string=True)
def api_top_tracks():
    track = request.args.get("track")
    min_races = int(request.args.get("min_races", 2))
    division = _division_arg()
    season = _season_arg()
    if not track:
        return jsonify({"error": "Track name is required"}), 400
    try:
        results = stats.findtoptracks(track, min_races=min_races, division=division, season=season)
        return jsonify(results)
    except Exception as e:
        print(f"Error in api_top_tracks: {e}")
        return _error_response(e)

@app.route("/api/top-teams-on-track", methods=["GET"])
@cache.cached(timeout=3600, query_string=True)
def api_top_teams_on_track():
    track = request.args.get("track")
    min_races = int(request.args.get("min_races", 2))
    division = _division_arg()
    season = _season_arg()
    if not track:
        return jsonify({"error": "Track name is required"}), 400
    try:
        results = stats.findtopteamsontrack(track, min_races=min_races, division=division, season=season)
        return jsonify(results)
    except Exception as e:
        print(f"Error in api_top_teams_on_track: {e}")
        return _error_response(e)

if __name__ == "__main__":
    app.run(debug=True)
