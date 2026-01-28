from flask import Flask, request, jsonify
from flask_caching import Cache
from flask_compress import Compress
import stats
import find
import pandas as pd
from pathlib import Path
from flask_cors import CORS

app = Flask(__name__)
CORS(app)
Compress(app)
cache = Cache(app, config={'CACHE_TYPE': 'simple', 'CACHE_DEFAULT_TIMEOUT': 3600})

BASE_DIR = Path(__file__).resolve().parent
csv_directory = BASE_DIR / "CSV"
json_directory = BASE_DIR / "JSON"

@app.route("/api/player", methods=["GET"])
def player_stats():
    player_name = request.args.get("name")
    division = request.args.get("division", "1_2")
    if not player_name:
        return jsonify({"error": "Player name is required"}), 400
    try:
        results = stats.findtopplayertracks(player_name, min_races=2, division=division)
        return jsonify({"player": player_name, "results": results})
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/player-avg", methods=["GET"])
def player_avg():
    player_name = request.args.get("name")
    division = request.args.get("division", "1_2")
    if not player_name:
        return jsonify({"error": "Player name is required"}), 400
    try:
        avg, player_name_formatted, team_name, races = stats.findplayeravg(player_name, division=division)
        return jsonify({
            "avg": avg,
            "player_name": player_name_formatted,
            "team_name": team_name,
            "races": races
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    
@app.route("/api/players", methods=["GET"])
@cache.cached(timeout=3600, query_string=True)
def api_players():
    division = request.args.get("division", "1_2")
    try:
        csv_file = csv_directory / f"ctc_d{division}.csv"
        print(f"Loading players from: {csv_file}")
        data = pd.read_csv(csv_file)
        print(f"CSV columns: {data.columns.tolist()}")
        
        players = set()
        for value in data['player']:
            # Skip NaN and non-string values
            if pd.notna(value) and isinstance(value, str):
                players.add(value)
        
        result = sorted(list(players))
        print(f"Players found: {result}")
        return jsonify(result)
    except Exception as e:
        print(f"Error in api_players: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 400

@app.route("/api/top-team-players", methods=["GET"])
def api_top_team_players():
    team = request.args.get("team")
    min_races = int(request.args.get("min_races", 12))
    division = request.args.get("division", "1_2")
    try:
        players = stats.findtopteamplayers(team, min_races, division)
        return jsonify(players)
    except Exception as e:
        print(f"Error in api_top_team_players: {e}")
        return jsonify({"error": str(e)}), 400

@app.route("/api/teams", methods=["GET"])
@cache.cached(timeout=3600, query_string=True)
def api_teams():
    division = request.args.get("division", "1_2")
    try:
        csv_file = csv_directory / f"ctc_d{division}.csv"
        data = pd.read_csv(csv_file)
        teams = set()
        for value in data['team']:
            if isinstance(value, str):
                teams.add(value)
        return jsonify(sorted(list(teams)))
    except Exception as e:
        print(f"Error in api_teams: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 400
    
@cache.cached(timeout=3600, query_string=True)
@app.route("/api/top-team-tracks", methods=["GET"])
def api_top_team_tracks():
    team = request.args.get("team")
    division = request.args.get("division", "1_2")
    try:
        tracks = stats.findtopteamtracks(team, division=division)
        return jsonify(tracks)
    except Exception as e:
        print(f"Error in api_top_team_tracks: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 400

if __name__ == "__main__":
    app.run(debug=True)