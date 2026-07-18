import json
import hmac
import ipaddress
import os
import time

from flask import Flask, Response, jsonify, request, stream_with_context
from flask_caching import Cache
from flask_compress import Compress
import stats_db as stats
import dashboard_stats as dashboards
from database import init_database
from import_json_to_db import detect_new_entries, import_editor_match, import_preview_match
from match_upload import (
    AdditionCapture,
    ArchiveConflictError,
    find_match_conflict,
    find_duplicate_source,
    prepare_upload_document,
    publish_staged_document,
    record_addition_logs,
    serialize_addition_log,
    source_archive_path,
    stage_upload_document,
    validate_committable_match,
)
from models import DatabaseAdditionLog, Match
from stats_db import AmbiguousPlayerError
from dashboard_stats import DashboardError
from player_role_analytics import normalize_role
from flask_cors import CORS
from sqlalchemy import select

init_database()
app = Flask(__name__)
CORS(app)
Compress(app)
cache = Cache(app, config={'CACHE_TYPE': 'simple', 'CACHE_DEFAULT_TIMEOUT': 3600})


def _season_arg():
    return request.args.get("season")


def _division_arg():
    return request.args.get("division")


def _role_arg():
    return normalize_role(request.args.get("role"))


def _error_response(error):
    if isinstance(error, DashboardError):
        return jsonify({"error": str(error)}), error.status_code
    if isinstance(error, AmbiguousPlayerError):
        return jsonify({
            "error": "Ambiguous player alias",
            "query": error.query,
            "season": error.season_code,
            "division": error.division_code,
            "candidates": error.candidates,
        }), 400
    return jsonify({"error": str(error)}), 400


def _optional_int_arg(name):
    value = request.args.get(name)
    if value is None or value.strip() == "":
        return None
    try:
        return int(value)
    except ValueError as error:
        raise DashboardError(f"{name} must be an integer.") from error


def _minimum_races_arg():
    value = _optional_int_arg("min_races")
    value = 12 if value is None else value
    if value < 1 or value > 500:
        raise DashboardError("min_races must be between 1 and 500.")
    return value


def _match_request_payload():
    payload = request.get_json(silent=True)
    match_data = payload.get("match") if isinstance(payload, dict) and isinstance(payload.get("match"), dict) else payload
    if not isinstance(match_data, dict):
        return None, set(), payload
    approved_keys = set(payload.get("approved_new_entries") or []) if isinstance(payload, dict) else set()
    return match_data, approved_keys, payload


def _unapproved_entries(session, match_data, approved_keys):
    new_entries = detect_new_entries(session, match_data)
    unapproved = [
        entry
        for entry in new_entries
        if entry["key"] not in approved_keys or entry.get("kind") == "player_identity_conflict"
    ]
    player_identity_links = {
        entry["friend_code"]: entry["proposed_player_id"]
        for entry in new_entries
        if entry["key"] in approved_keys
        and entry.get("kind") == "existing_player_new_friend_code"
    }
    return new_entries, unapproved, player_identity_links


def _duplicate_commit_response(session, source_file, fingerprint):
    match = session.scalar(select(Match).where(Match.source_file_id == source_file.source_file_id))
    if not match:
        raise ValueError("The matching source file has no imported match. Run archive reconciliation.")
    return {
        "status": "duplicate",
        "match_id": match.match_id,
        "archive_path": f"backend/{source_file.source_path}",
        "fingerprint": fingerprint,
        "additions": [],
        "message": "This exact match has already been uploaded.",
    }


def _database_write_authorized():
    configured_token = os.environ.get("MATCH_UPLOAD_TOKEN")
    authorization = request.headers.get("Authorization", "")
    supplied_token = authorization.removeprefix("Bearer ").strip() if authorization.startswith("Bearer ") else ""
    if configured_token:
        return bool(supplied_token and hmac.compare_digest(configured_token, supplied_token))
    try:
        return ipaddress.ip_address(request.remote_addr or "").is_loopback
    except ValueError:
        return False


def _require_database_write_access():
    if _database_write_authorized():
        return None
    return jsonify({"error": "Database uploads and addition logs require local or authenticated access."}), 403

@app.route("/api/player", methods=["GET"])
def player_stats():
    player_name = request.args.get("name")
    division = _division_arg()
    season = _season_arg()
    if not player_name:
        return jsonify({"error": "Player name is required"}), 400
    try:
        role = _role_arg()
        results = stats.findtopplayertracks(
            player_name, min_races=2, division=division, season=season, role=role
        )
        return jsonify({"player": player_name, "role": role, "results": results})
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
        result = stats.findplayeravg(
            player_name,
            division=division,
            season=season,
            role=_role_arg(),
        )
        return jsonify(result)
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


@app.route("/api/player-directory", methods=["GET"])
@cache.cached(timeout=3600, query_string=True)
def api_player_directory():
    try:
        return jsonify(stats.list_player_directory(
            season=_season_arg(),
            division=_division_arg(),
        ))
    except Exception as error:
        return _error_response(error)


@app.route("/api/player-identities", methods=["GET"])
def api_player_identities():
    try:
        return jsonify(stats.find_player_identities(
            friend_code=request.args.get("friend_code"),
            query=request.args.get("query"),
        ))
    except Exception as e:
        return _error_response(e)


@app.route("/api/players/<int:player_id>/overview", methods=["GET"])
def api_player_dashboard_overview(player_id):
    try:
        role = _role_arg()
        return jsonify(dashboards.get_player_overview(
            player_id,
            season=_season_arg(),
            division=_division_arg(),
            team_id=_optional_int_arg("team_id"),
            min_races=_minimum_races_arg(),
            role=role,
        ))
    except Exception as error:
        return _error_response(error)


@app.route("/api/players/<int:player_id>/performance", methods=["GET"])
def api_player_dashboard_performance(player_id):
    try:
        role = _role_arg()
        return jsonify(dashboards.get_player_performance(
            player_id,
            season=_season_arg(),
            division=_division_arg(),
            team_id=_optional_int_arg("team_id"),
            role=role,
        ))
    except Exception as error:
        return _error_response(error)


@app.route("/api/players/<int:player_id>/tracks", methods=["GET"])
def api_player_dashboard_tracks(player_id):
    try:
        role = _role_arg()
        return jsonify(dashboards.get_player_tracks(
            player_id,
            season=_season_arg(),
            division=_division_arg(),
            team_id=_optional_int_arg("team_id"),
            min_races=_minimum_races_arg(),
            role=role,
        ))
    except Exception as error:
        return _error_response(error)


@app.route("/api/teams/<int:team_id>/overview", methods=["GET"])
def api_team_dashboard_overview(team_id):
    try:
        return jsonify(dashboards.get_team_overview(
            team_id,
            season=_season_arg(),
            division=_division_arg(),
            opponent_team_id=_optional_int_arg("opponent_team_id"),
            min_races=_minimum_races_arg(),
        ))
    except Exception as error:
        return _error_response(error)


@app.route("/api/teams/<int:team_id>/roster", methods=["GET"])
def api_team_dashboard_roster(team_id):
    try:
        role = _role_arg()
        return jsonify(dashboards.get_team_roster(
            team_id,
            season=_season_arg(),
            division=_division_arg(),
            opponent_team_id=_optional_int_arg("opponent_team_id"),
            min_races=_minimum_races_arg(),
            role=role,
        ))
    except Exception as error:
        return _error_response(error)


@app.route("/api/teams/<int:team_id>/tracks", methods=["GET"])
def api_team_dashboard_tracks(team_id):
    try:
        return jsonify(dashboards.get_team_tracks(
            team_id,
            season=_season_arg(),
            division=_division_arg(),
            opponent_team_id=_optional_int_arg("opponent_team_id"),
            min_races=_minimum_races_arg(),
        ))
    except Exception as error:
        return _error_response(error)


@app.route("/api/track-search", methods=["GET"])
def api_track_search():
    try:
        return jsonify(stats.search_tracks(query=request.args.get("query")))
    except Exception as e:
        return _error_response(e)


@app.route("/api/seasons", methods=["GET"])
@cache.cached(timeout=3600, query_string=True)
def api_seasons():
    try:
        return jsonify(stats.list_seasons())
    except Exception as e:
        print(f"Error in api_seasons: {e}")
        return _error_response(e)


@app.route("/api/match-scopes", methods=["GET"])
@cache.cached(timeout=3600)
def api_match_scopes():
    try:
        return jsonify(stats.list_match_scopes())
    except Exception as e:
        return _error_response(e)


@app.route("/api/team-scopes", methods=["GET"])
@cache.cached(timeout=3600)
def api_team_scopes():
    try:
        return jsonify(stats.list_team_scopes())
    except Exception as e:
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
    division = _division_arg()
    season = _season_arg()
    try:
        role = _role_arg()
        min_races = _minimum_races_arg()
    except (DashboardError, ValueError) as error:
        return _error_response(error)
    try:
        players = stats.findtopteamplayers(
            team, min_races, division=division, season=season, role=role
        )
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


@app.route("/api/matches/preview", methods=["POST"])
def api_match_preview():
    access_error = _require_database_write_access()
    if access_error:
        return access_error
    match_data, approved_keys, _payload = _match_request_payload()
    if not isinstance(match_data, dict):
        return jsonify({"error": "A match JSON object is required."}), 400
    try:
        document = prepare_upload_document(match_data)
        validate_committable_match(match_data)
    except ValueError as error:
        return _error_response(error)

    session = stats.SessionLocal()
    transaction = session.begin()
    try:
        new_entries, unapproved, player_identity_links = _unapproved_entries(
            session, match_data, approved_keys
        )
        if unapproved:
            transaction.rollback()
            return jsonify({
                "error": "Every new database entry must be approved before preview.",
                "new_entries": new_entries,
            }), 409
        match = import_preview_match(session, match_data, player_identity_links)
        session.flush()
        detail = stats.get_match_detail(match.match_id, session=session)
        transaction.rollback()
        return jsonify({
            "match": detail,
            "preview": {
                "fingerprint": document.fingerprint,
                "archive_path": document.display_path,
                "new_entries": new_entries,
            },
        })
    except Exception as error:
        if transaction.is_active:
            transaction.rollback()
        print(f"Error previewing match: {error}")
        if isinstance(error, ValueError):
            return _error_response(error)
        return jsonify({"error": "Preview import failed database validation."}), 400
    finally:
        session.close()


@app.route("/api/matches/new-entries", methods=["POST"])
def api_match_new_entries():
    match_data, _approved_keys, _payload = _match_request_payload()
    if not isinstance(match_data, dict):
        return jsonify({"error": "A match JSON object is required."}), 400
    try:
        with stats.SessionLocal() as session:
            return jsonify({"new_entries": detect_new_entries(session, match_data)})
    except Exception as error:
        print(f"Error detecting new match entries: {error}")
        return _error_response(error)


@app.route("/api/matches/commit", methods=["POST"])
def api_match_commit():
    access_error = _require_database_write_access()
    if access_error:
        return access_error
    match_data, approved_keys, payload = _match_request_payload()
    if not isinstance(match_data, dict):
        return jsonify({"error": "A match JSON object is required."}), 400
    expected_fingerprint = payload.get("expected_preview_fingerprint") if isinstance(payload, dict) else None
    try:
        document = prepare_upload_document(match_data)
        validate_committable_match(match_data)
    except ValueError as error:
        return _error_response(error)
    if not expected_fingerprint:
        return jsonify({"error": "Preview this exact match before confirming upload."}), 409
    if expected_fingerprint != document.fingerprint:
        return jsonify({"error": "The match changed after preview. Generate a new preview before uploading."}), 409

    staged_path = None
    published = False
    committed = False
    session = stats.SessionLocal()
    transaction = session.begin()
    try:
        new_entries, unapproved, player_identity_links = _unapproved_entries(
            session, match_data, approved_keys
        )
        if unapproved:
            transaction.rollback()
            return jsonify({
                "error": "Every new database entry must be approved before upload.",
                "new_entries": new_entries,
            }), 409

        existing_source = find_duplicate_source(session, document)
        if existing_source:
            if existing_source.file_sha256 != document.fingerprint:
                transaction.rollback()
                return jsonify({
                    "error": f"Archive path already belongs to different content: {document.display_path}",
                }), 409
            existing_archive = source_archive_path(existing_source)
            if not existing_archive.exists():
                transaction.rollback()
                return jsonify({"error": "This match exists in the database, but its archive file is missing. Run archive reconciliation."}), 409
            if existing_archive.read_bytes() != document.content:
                transaction.rollback()
                return jsonify({"error": "This match exists in the database, but its archive file content does not match. Run archive reconciliation."}), 409
            result = _duplicate_commit_response(session, existing_source, document.fingerprint)
            transaction.rollback()
            return jsonify(result)

        conflicting_match = find_match_conflict(session, match_data)
        if conflicting_match:
            transaction.rollback()
            return jsonify({
                "error": f"Possible duplicate of match {conflicting_match.match_id}: {conflicting_match.match_label}",
                "match_id": conflicting_match.match_id,
            }), 409

        staged_path = stage_upload_document(document)
        capture = AdditionCapture(session)
        match = import_editor_match(
            session,
            match_data,
            source_path=document.source_path,
            source_filename=document.filename,
            file_sha256=document.fingerprint,
            player_identity_links=player_identity_links,
        )
        session.flush()
        detail = stats.get_match_detail(match.match_id, session=session)
        additions = capture.stop()
        log_rows = record_addition_logs(session, additions, match.match_id)
        serialized_logs = [serialize_addition_log(log) for log in log_rows]
        publish_staged_document(staged_path, document)
        staged_path = None
        published = True
        transaction.commit()
        committed = True
        try:
            cache.clear()
        except Exception as cache_error:
            print(f"Match committed, but cache clearing failed: {cache_error}")
        return jsonify({
            "status": "committed",
            "match_id": match.match_id,
            "archive_path": document.display_path,
            "fingerprint": document.fingerprint,
            "match": detail,
            "additions": serialized_logs,
            "message": "Match uploaded and archived successfully.",
        })
    except ArchiveConflictError as error:
        if transaction.is_active:
            transaction.rollback()
        return jsonify({"error": str(error)}), 409
    except Exception as error:
        if transaction.is_active:
            transaction.rollback()
        print(f"Error committing match: {error}")
        if isinstance(error, ValueError):
            return _error_response(error)
        return jsonify({"error": "Upload failed; database and archive changes were rolled back."}), 400
    finally:
        if staged_path:
            staged_path.unlink(missing_ok=True)
        if published and not committed:
            document.final_path.unlink(missing_ok=True)
        session.close()


@app.route("/api/database-additions", methods=["GET"])
def api_database_additions():
    access_error = _require_database_write_access()
    if access_error:
        return access_error
    after_id = request.args.get("after_id", type=int) or 0
    limit = min(max(request.args.get("limit", type=int) or 100, 1), 500)
    with stats.SessionLocal() as session:
        rows = session.scalars(
            select(DatabaseAdditionLog)
            .where(DatabaseAdditionLog.addition_log_id > after_id)
            .order_by(DatabaseAdditionLog.addition_log_id.desc())
            .limit(limit)
        ).all()
        return jsonify([serialize_addition_log(row) for row in reversed(rows)])


@app.route("/api/database-additions/stream", methods=["GET"])
def api_database_additions_stream():
    access_error = _require_database_write_access()
    if access_error:
        return access_error
    requested_id = request.headers.get("Last-Event-ID") or request.args.get("after_id") or "0"
    try:
        initial_id = max(int(requested_id), 0)
    except ValueError:
        initial_id = 0

    @stream_with_context
    def generate():
        last_id = initial_id
        while True:
            with stats.SessionLocal() as session:
                rows = session.scalars(
                    select(DatabaseAdditionLog)
                    .where(DatabaseAdditionLog.addition_log_id > last_id)
                    .order_by(DatabaseAdditionLog.addition_log_id)
                    .limit(100)
                ).all()
            if rows:
                for row in rows:
                    last_id = row.addition_log_id
                    payload = json.dumps(serialize_addition_log(row), ensure_ascii=False, separators=(",", ":"))
                    yield f"id: {last_id}\nevent: addition\ndata: {payload}\n\n"
            else:
                yield ": keep-alive\n\n"
            time.sleep(1)

    return Response(generate(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    })
    
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
    division = _division_arg()
    season = _season_arg()
    if not track:
        return jsonify({"error": "Track name is required"}), 400
    try:
        role = _role_arg()
        min_races = _minimum_races_arg()
    except (DashboardError, ValueError) as error:
        return _error_response(error)
    try:
        results = stats.findtoptracks(
            track,
            min_races=min_races,
            division=division,
            season=season,
            role=role,
        )
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
