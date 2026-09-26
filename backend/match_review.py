"""Shared database-entry review policy for match preview, acceptance, and replacement.

Callers provide an existing session and retain control of its transaction. Review
returns detected entries, unresolved approvals, and the identity links safe to pass
to ingestion; it never commits. HTTP request parsing belongs in ``routes.common``.
"""

from import_json_to_db import CREATE_PLAYER_IDENTITY, detect_new_entries
from models import Match, PlayerFriendCode
from sqlalchemy import select


def unapproved_entries(
    session,
    match_data,
    approved_keys,
    requested_player_identity_links=None,
    requested_team_identity_resolutions=None,
    lookup_mkc_profiles=False,
):
    new_entries = detect_new_entries(
        session,
        match_data,
        player_identity_links=requested_player_identity_links,
        team_identity_resolutions=requested_team_identity_resolutions,
        lookup_mkc_profiles=lookup_mkc_profiles,
    )
    unapproved = [
        entry
        for entry in new_entries
        if entry["key"] not in approved_keys
        or entry.get("kind") == "player_identity_conflict"
        or (entry.get("kind") == "cross_league_team_match" and not entry.get("resolution"))
    ]
    player_identity_links = {
        entry["friend_code"]: entry["proposed_player_id"]
        for entry in new_entries
        if entry["key"] in approved_keys and entry.get("kind") == "existing_player_new_friend_code"
    }
    player_identity_links.update(
        {
            entry["friend_code"]: CREATE_PLAYER_IDENTITY
            for entry in new_entries
            if entry["key"] in approved_keys
            and entry.get("kind") == "new_player_identity"
            and (requested_player_identity_links or {}).get(entry.get("friend_code"))
            == CREATE_PLAYER_IDENTITY
        }
    )
    team_identity_links = {
        entry["value"].lower(): entry["resolution"]["team_id"]
        for entry in new_entries
        if entry["key"] in approved_keys
        and entry.get("kind") == "cross_league_team_match"
        and entry.get("resolution", {}).get("action") == "link"
    }
    friend_codes = [
        friend_code
        for team_data in (match_data.get("teams") or {}).values()
        for friend_code in (team_data.get("players") or {})
    ]
    existing_links = {
        row.friend_code: row.player_id
        for row in session.scalars(
            select(PlayerFriendCode).where(PlayerFriendCode.friend_code.in_(friend_codes))
        )
    }
    configured_players = {}
    for friend_code in friend_codes:
        player_id = existing_links.get(friend_code) or player_identity_links.get(friend_code)
        if not isinstance(player_id, int):
            continue
        prior_code = configured_players.get(player_id)
        if prior_code and prior_code != friend_code:
            raise ValueError(
                f"Player ID {player_id} is configured more than once "
                f"({prior_code} and {friend_code})."
            )
        configured_players[player_id] = friend_code
    return new_entries, unapproved, player_identity_links, team_identity_links


def mkc_profiles_from_entries(new_entries):
    return {
        entry["friend_code"]: {
            "status": "found",
            "mkc_name": entry["mkc_name"],
            "mkc_player_id": entry.get("mkc_player_id"),
        }
        for entry in new_entries
        if entry.get("type") == "player"
        and entry.get("kind") == "new_player_identity"
        and entry.get("mkc_lookup_status") == "found"
        and entry.get("friend_code")
        and entry.get("mkc_name")
    }


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
