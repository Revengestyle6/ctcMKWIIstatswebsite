from dashboard_stats import DashboardError
from flask import jsonify, request
from import_json_to_db import detect_new_entries
from models import Match
from player_role_analytics import normalize_role
from sqlalchemy import select
from stats_db import AmbiguousPlayerError


def season_arg():
    return request.args.get("season")


def division_arg():
    return request.args.get("division")


def role_arg():
    return normalize_role(request.args.get("role"))


def error_response(error):
    if isinstance(error, DashboardError):
        return jsonify({"error": str(error)}), error.status_code
    if isinstance(error, AmbiguousPlayerError):
        return jsonify(
            {
                "error": "Ambiguous player alias",
                "query": error.query,
                "season": error.season_code,
                "division": error.division_code,
                "candidates": error.candidates,
            }
        ), 400
    return jsonify({"error": str(error)}), 400


def optional_int_arg(name):
    value = request.args.get(name)
    if value is None or value.strip() == "":
        return None
    try:
        return int(value)
    except ValueError as error:
        raise DashboardError(f"{name} must be an integer.") from error


def minimum_races_arg(default=12):
    value = optional_int_arg("min_races")
    value = default if value is None else value
    if value < 1 or value > 500:
        raise DashboardError("min_races must be between 1 and 500.")
    return value


def match_request_payload():
    payload = request.get_json(silent=True)
    match_data = (
        payload.get("match")
        if isinstance(payload, dict) and isinstance(payload.get("match"), dict)
        else payload
    )
    if not isinstance(match_data, dict):
        return None, set(), payload
    approved_keys = (
        set(payload.get("approved_new_entries") or []) if isinstance(payload, dict) else set()
    )
    return match_data, approved_keys, payload


def unapproved_entries(session, match_data, approved_keys):
    new_entries = detect_new_entries(session, match_data)
    unapproved = [
        entry
        for entry in new_entries
        if entry["key"] not in approved_keys or entry.get("kind") == "player_identity_conflict"
    ]
    player_identity_links = {
        entry["friend_code"]: entry["proposed_player_id"]
        for entry in new_entries
        if entry["key"] in approved_keys and entry.get("kind") == "existing_player_new_friend_code"
    }
    return new_entries, unapproved, player_identity_links


def duplicate_commit_response(session, source_file, fingerprint):
    match = session.scalar(select(Match).where(Match.source_file_id == source_file.source_file_id))
    if not match:
        raise ValueError(
            "The matching source file has no imported match. Run archive reconciliation."
        )
    return {
        "status": "duplicate",
        "match_id": match.match_id,
        "archive_path": source_file.storage_object_key or source_file.source_path,
        "fingerprint": fingerprint,
        "additions": [],
        "message": "This exact match has already been uploaded.",
    }
