from dashboard_stats import DashboardError
from flask import jsonify, request

# Keep these imports available for existing tools; workflow code imports match_review.
from match_review import (
    duplicate_commit_response as duplicate_commit_response,
)
from match_review import (
    mkc_profiles_from_entries as mkc_profiles_from_entries,
)
from match_review import (
    unapproved_entries as unapproved_entries,
)
from match_sets import normalize_match_set
from player_role_analytics import normalize_role
from stats_db import AmbiguousPlayerError


def season_arg():
    return request.args.get("season")


def division_arg():
    return request.args.get("division")


def league_arg():
    return str(request.args.get("league") or "ctc").strip().lower()


def match_set_arg():
    return normalize_match_set(request.args.get("match_set"))


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


def player_identity_links_from_payload(payload):
    if not isinstance(payload, dict):
        return {}
    links = payload.get("player_identity_links") or {}
    if not isinstance(links, dict):
        raise ValueError("Player identity links must be an object keyed by friend code.")
    return links


def team_identity_resolutions_from_payload(payload):
    if not isinstance(payload, dict):
        return {}
    resolutions = payload.get("team_identity_resolutions") or {}
    if not isinstance(resolutions, dict):
        raise ValueError("Team identity resolutions must be an object keyed by review entry.")
    return resolutions
