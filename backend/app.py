from flask import Flask, request, jsonify
import stats  # your stats.py file with findtopplayertracks, etc.
from flask_cors import CORS
app = Flask(__name__)
CORS(app)  # Allow requests from frontend

@app.route("/api/player", methods=["GET"])
def player_stats():
    player_name = request.args.get("name")
    if not player_name:
        return jsonify({"error": "Player name is required"}), 400
    try:
        # Call your function
        results = stats.findtopplayertracks(player_name, min_races=2)
        return jsonify({"player": player_name, "results": results})
    except Exception as e:
        return jsonify({"error": str(e)}), 400

if __name__ == "__main__":
    app.run(debug=True)
