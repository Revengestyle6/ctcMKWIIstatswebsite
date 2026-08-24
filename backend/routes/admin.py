import logging
import uuid

import alias_management
import database_health as database_health_service
import mkc_name_sync
import stats_db as stats
import team_identity_management
import team_logo_management
from acceptance_service import accept_match
from admin_auth import record_audit, require_admin
from archive_storage import get_archive_storage
from database_health_reviews import set_issue_review
from extensions import cache
from flask import Blueprint, g, jsonify, request
from import_json_to_db import detect_new_entries, import_preview_match
from match_upload import (
    prepare_upload_document,
    serialize_addition_log,
    validate_committable_match,
)
from models import DatabaseAdditionLog
from sqlalchemy import select

from routes.common import (
    error_response,
    match_request_payload,
    mkc_profiles_from_entries,
    player_identity_links_from_payload,
    team_identity_resolutions_from_payload,
    unapproved_entries,
)

logger = logging.getLogger(__name__)
admin_api = Blueprint("admin_api", __name__)


def _alias_error(error):
    if isinstance(error, LookupError):
        return jsonify({"error": str(error)}), 404
    if isinstance(error, ValueError):
        return jsonify({"error": str(error)}), 400
    logger.exception("Alias management failed")
    return jsonify({"error": "Alias management failed."}), 500


def _team_logo_error(error):
    if isinstance(error, LookupError):
        return jsonify({"error": str(error)}), 404
    if isinstance(error, ValueError):
        return jsonify({"error": str(error)}), 400
    logger.exception("Team logo management failed")
    return jsonify({"error": "Team logo management failed."}), 500


def _team_identity_error(error):
    if isinstance(error, LookupError):
        return jsonify({"error": str(error)}), 404
    if isinstance(error, ValueError):
        return jsonify({"error": str(error)}), 400
    logger.exception("Team identity management failed")
    return jsonify({"error": "Team identity management failed."}), 500


@admin_api.get("/api/admin/aliases/<entity_type>")
@require_admin
def api_alias_entities(entity_type):
    try:
        limit = min(max(request.args.get("limit", type=int) or 200, 1), 500)
        with stats.SessionLocal() as session:
            return jsonify(
                alias_management.list_entities(
                    session,
                    entity_type,
                    query=request.args.get("query", ""),
                    limit=limit,
                    league_code=request.args.get("league"),
                )
            )
    except Exception as error:
        return _alias_error(error)


@admin_api.get("/api/admin/aliases/<entity_type>/<int:entity_id>")
@require_admin
def api_alias_detail(entity_type, entity_id):
    try:
        with stats.SessionLocal() as session:
            return jsonify(alias_management.get_entity(session, entity_type, entity_id))
    except Exception as error:
        return _alias_error(error)


@admin_api.post("/api/admin/aliases/<entity_type>/<int:entity_id>")
@require_admin
def api_alias_add(entity_type, entity_id):
    try:
        with stats.SessionLocal.begin() as session:
            detail, alias = alias_management.add_alias(
                session, entity_type, entity_id, request.get_json(silent=True) or {}
            )
            record_audit(
                session,
                g.admin_actor,
                "alias.created",
                target_type=f"{entity_type[:-1]}_alias",
                target_id=alias.player_alias_id
                if entity_type == "players"
                else alias.team_alias_id
                if entity_type == "teams"
                else alias.track_alias_id,
                details={
                    "entity_id": entity_id,
                    "alias_type": getattr(alias, "alias_type", "alias"),
                    "value": alias.alias_value,
                },
            )
        cache.clear()
        return jsonify(detail), 201
    except Exception as error:
        return _alias_error(error)


@admin_api.patch("/api/admin/aliases/players/<int:player_id>/canonical-name")
@require_admin
def api_player_canonical_name_update(player_id):
    try:
        with stats.SessionLocal.begin() as session:
            detail, previous_name = alias_management.update_player_canonical_name(
                session, player_id, request.get_json(silent=True) or {}
            )
            record_audit(
                session,
                g.admin_actor,
                "player.canonical_name_updated",
                target_type="player",
                target_id=player_id,
                details={
                    "previous_name": previous_name,
                    "canonical_name": detail["canonical_name"],
                },
            )
        cache.clear()
        return jsonify(detail)
    except Exception as error:
        return _alias_error(error)


@admin_api.patch("/api/admin/aliases/players/<int:player_id>/canonical-name-override")
@require_admin
def api_player_canonical_name_override_update(player_id):
    try:
        with stats.SessionLocal.begin() as session:
            detail, previous = alias_management.update_player_canonical_override(
                session, player_id, request.get_json(silent=True) or {}
            )
            record_audit(
                session,
                g.admin_actor,
                "player.canonical_name_override_updated",
                target_type="player",
                target_id=player_id,
                details={
                    "previous": previous,
                    "enabled": detail["canonical_name_override"],
                    "canonical_name": detail["canonical_name"],
                },
            )
        cache.clear()
        return jsonify(detail)
    except Exception as error:
        return _alias_error(error)


@admin_api.post("/api/admin/aliases/players/<int:player_id>/friend-codes")
@require_admin
def api_player_friend_code_add(player_id):
    try:
        with stats.SessionLocal.begin() as session:
            detail, friend_code = alias_management.add_player_friend_code(
                session, player_id, request.get_json(silent=True) or {}
            )
            record_audit(
                session,
                g.admin_actor,
                "player.friend_code_added",
                target_type="player_friend_code",
                target_id=friend_code.player_friend_code_id,
                details={"player_id": player_id, "friend_code": friend_code.friend_code},
            )
        cache.clear()
        return jsonify(detail), 201
    except Exception as error:
        return _alias_error(error)


@admin_api.delete("/api/admin/aliases/players/<int:player_id>/friend-codes/<int:friend_code_id>")
@require_admin
def api_player_friend_code_delete(player_id, friend_code_id):
    try:
        with stats.SessionLocal.begin() as session:
            detail, deleted = alias_management.delete_player_friend_code(
                session, player_id, friend_code_id
            )
            record_audit(
                session,
                g.admin_actor,
                "player.friend_code_deleted",
                target_type="player_friend_code",
                target_id=friend_code_id,
                details={"player_id": player_id, **deleted},
            )
        cache.clear()
        return jsonify(detail)
    except Exception as error:
        return _alias_error(error)


@admin_api.get("/api/admin/aliases/players/<int:player_id>/merge-comparison")
@require_admin
def api_player_merge_comparison(player_id):
    try:
        target_player_id = int(request.args.get("target_player_id", ""))
        with stats.SessionLocal() as session:
            comparison = alias_management.player_merge_comparison(
                session, player_id, target_player_id
            )
        return jsonify(comparison)
    except Exception as error:
        return _alias_error(error)


@admin_api.post("/api/admin/aliases/players/<int:player_id>/merge")
@require_admin
def api_player_merge(player_id):
    try:
        with stats.SessionLocal.begin() as session:
            result = alias_management.merge_player(
                session, player_id, request.get_json(silent=True) or {}
            )
            record_audit(
                session,
                g.admin_actor,
                "player.merged",
                target_type="player",
                target_id=result["target"]["id"],
                details={
                    "source_player": result["merged"],
                    "target_player_id": result["target"]["id"],
                    "friend_codes_moved": result["friend_codes_moved"],
                    "aliases_moved": result["aliases_moved"],
                    "aliases_consolidated": result["aliases_consolidated"],
                    "season_entries_moved": result["season_entries_moved"],
                    "season_entries_consolidated": result["season_entries_consolidated"],
                    "match_players_updated": result["match_players_updated"],
                    "race_results_updated": result["race_results_updated"],
                },
            )
        cache.clear()
        return jsonify(result)
    except Exception as error:
        return _alias_error(error)


@admin_api.post("/api/admin/mkc-refresh-previews")
@require_admin
def api_mkc_refresh_preview_create():
    try:
        payload = request.get_json(silent=True) or {}
        player_id = payload.get("player_id")
        if player_id is not None:
            player_id = int(player_id)
        with stats.SessionLocal.begin() as session:
            preview = mkc_name_sync.create_refresh_preview(session, g.admin_actor, player_id)
            record_audit(
                session,
                g.admin_actor,
                "mkc.refresh_preview_created",
                target_type="mkc_refresh_preview",
                target_id=preview["preview_id"],
                details={
                    "scope": preview["scope"],
                    "player_id": player_id,
                    "summary": preview["summary"],
                },
            )
        return jsonify(preview), 201
    except Exception as error:
        return _alias_error(error)


@admin_api.post("/api/admin/mkc-refresh-previews/<preview_id>/apply")
@require_admin
def api_mkc_refresh_preview_apply(preview_id):
    try:
        payload = request.get_json(silent=True) or {}
        with stats.SessionLocal.begin() as session:
            preview = mkc_name_sync.apply_refresh_preview(
                session,
                preview_id,
                g.admin_actor,
                payload.get("canonical_name_selections"),
            )
            record_audit(
                session,
                g.admin_actor,
                "mkc.refresh_applied",
                target_type="mkc_refresh_preview",
                target_id=preview_id,
                details={"summary": preview["summary"], "applied": preview["applied"]},
            )
        cache.clear()
        return jsonify(preview)
    except Exception as error:
        return _alias_error(error)


@admin_api.post("/api/admin/mkc-refresh-previews/<preview_id>/reject")
@require_admin
def api_mkc_refresh_preview_reject(preview_id):
    try:
        with stats.SessionLocal.begin() as session:
            preview = mkc_name_sync.reject_refresh_preview(session, preview_id)
            record_audit(
                session,
                g.admin_actor,
                "mkc.refresh_rejected",
                target_type="mkc_refresh_preview",
                target_id=preview_id,
                details={"summary": preview["summary"]},
            )
        return jsonify(preview)
    except Exception as error:
        return _alias_error(error)


@admin_api.patch("/api/admin/aliases/tracks/<int:track_id>/canonical-name")
@require_admin
def api_track_canonical_name_update(track_id):
    try:
        with stats.SessionLocal.begin() as session:
            detail, result = alias_management.update_track_canonical_name(
                session, track_id, request.get_json(silent=True) or {}
            )
            record_audit(
                session,
                g.admin_actor,
                "track.canonical_name_updated",
                target_type="track",
                target_id=track_id,
                details={
                    **result,
                    "canonical_name": detail["canonical_name"],
                },
            )
        cache.clear()
        return jsonify({"track": detail, **result})
    except Exception as error:
        return _alias_error(error)


@admin_api.post("/api/admin/aliases/tracks/<int:track_id>/merge")
@require_admin
def api_track_merge(track_id):
    try:
        with stats.SessionLocal.begin() as session:
            result = alias_management.merge_track(
                session, track_id, request.get_json(silent=True) or {}
            )
            record_audit(
                session,
                g.admin_actor,
                "track.merged",
                target_type="track",
                target_id=track_id,
                details={
                    "source": result["merged"],
                    "target_track_id": result["target"]["id"],
                    "target_canonical_name": result["target"]["canonical_name"],
                    "races_updated": result["races_updated"],
                    "aliases_moved": result["aliases_moved"],
                },
            )
        cache.clear()
        return jsonify(result)
    except Exception as error:
        return _alias_error(error)


@admin_api.delete("/api/admin/aliases/<entity_type>/<int:entity_id>/<int:alias_id>")
@require_admin
def api_alias_delete(entity_type, entity_id, alias_id):
    try:
        with stats.SessionLocal.begin() as session:
            detail, deleted = alias_management.delete_alias(
                session, entity_type, entity_id, alias_id
            )
            record_audit(
                session,
                g.admin_actor,
                "alias.deleted",
                target_type=f"{entity_type[:-1]}_alias",
                target_id=alias_id,
                details={"entity_id": entity_id, **deleted},
            )
        cache.clear()
        return jsonify(detail)
    except Exception as error:
        return _alias_error(error)


@admin_api.get("/api/admin/teams/<int:team_id>/identity")
@require_admin
def api_team_identity(team_id):
    try:
        with stats.SessionLocal() as session:
            return jsonify(team_identity_management.get_team_identity(session, team_id))
    except Exception as error:
        return _team_identity_error(error)


@admin_api.patch("/api/admin/teams/<int:team_id>/identity")
@require_admin
def api_team_identity_update(team_id):
    try:
        with stats.SessionLocal.begin() as session:
            detail, previous = team_identity_management.update_canonical_identity(
                session, team_id, request.get_json(silent=True) or {}
            )
            record_audit(
                session,
                g.admin_actor,
                "team.identity_updated",
                target_type="team",
                target_id=team_id,
                details={"previous": previous, "current": detail["team"]},
            )
        cache.clear()
        return jsonify(detail)
    except Exception as error:
        return _team_identity_error(error)


@admin_api.patch("/api/admin/teams/<int:team_id>/canonical-league-preference")
@require_admin
def api_team_canonical_league_preference_update(team_id):
    try:
        with stats.SessionLocal.begin() as session:
            detail, previous = team_identity_management.update_canonical_preference(
                session, team_id, request.get_json(silent=True) or {}
            )
            record_audit(
                session,
                g.admin_actor,
                "team.canonical_league_preference_updated",
                target_type="team",
                target_id=team_id,
                details={"previous": previous, "current": detail["team"]},
            )
        cache.clear()
        return jsonify(detail)
    except Exception as error:
        return _team_identity_error(error)


@admin_api.patch("/api/admin/teams/<int:team_id>/canonical-identity-override")
@require_admin
def api_team_canonical_identity_override_update(team_id):
    try:
        with stats.SessionLocal.begin() as session:
            detail, previous = team_identity_management.update_canonical_override(
                session, team_id, request.get_json(silent=True) or {}
            )
            record_audit(
                session,
                g.admin_actor,
                "team.canonical_identity_override_updated",
                target_type="team",
                target_id=team_id,
                details={"previous": previous, "current": detail["team"]},
            )
        cache.clear()
        return jsonify(detail)
    except Exception as error:
        return _team_identity_error(error)


@admin_api.get("/api/admin/aliases/teams/<int:team_id>/merge-comparison")
@require_admin
def api_team_merge_comparison(team_id):
    try:
        target_team_id = int(request.args.get("target_team_id", ""))
        with stats.SessionLocal() as session:
            comparison = team_identity_management.team_merge_comparison(
                session, team_id, target_team_id
            )
        return jsonify(comparison)
    except Exception as error:
        return _team_identity_error(error)


@admin_api.post("/api/admin/aliases/teams/<int:team_id>/merge")
@require_admin
def api_team_merge(team_id):
    try:
        with stats.SessionLocal.begin() as session:
            result = team_identity_management.merge_team(
                session, team_id, request.get_json(silent=True) or {}
            )
            record_audit(
                session,
                g.admin_actor,
                "team.merged",
                target_type="team",
                target_id=result["target"]["team"]["id"],
                details={
                    "source_team": result["merged"],
                    "target_team_id": result["target"]["team"]["id"],
                    "aliases_moved": result["aliases_moved"],
                    "aliases_consolidated": result["aliases_consolidated"],
                    "league_identities_moved": result["league_identities_moved"],
                    "season_entries_moved": result["season_entries_moved"],
                    "season_entries_consolidated": result["season_entries_consolidated"],
                    "match_appearances_updated": result["match_appearances_updated"],
                    "player_memberships_moved": result["player_memberships_moved"],
                    "player_memberships_consolidated": result["player_memberships_consolidated"],
                    "logos_moved": result["logos_moved"],
                    "playoff_participants_updated": result["playoff_participants_updated"],
                },
            )
        cache.clear()
        return jsonify(result)
    except Exception as error:
        return _team_identity_error(error)


@admin_api.post("/api/admin/teams/<int:team_id>/league-identities")
@require_admin
def api_team_league_identity_add(team_id):
    try:
        with stats.SessionLocal.begin() as session:
            detail, identity = team_identity_management.add_league_identity(
                session, team_id, request.get_json(silent=True) or {}
            )
            record_audit(
                session,
                g.admin_actor,
                "team.league_identity_created",
                target_type="team_league_identity",
                target_id=identity.team_league_identity_id,
                details={
                    "team_id": team_id,
                    "league": identity.league_code,
                    "tag": identity.tag,
                },
            )
        cache.clear()
        return jsonify(detail), 201
    except Exception as error:
        return _team_identity_error(error)


@admin_api.delete("/api/admin/teams/<int:team_id>/league-identities/<int:team_league_identity_id>")
@require_admin
def api_team_league_identity_delete(team_id, team_league_identity_id):
    try:
        with stats.SessionLocal.begin() as session:
            detail, deleted = team_identity_management.delete_league_identity(
                session, team_id, team_league_identity_id
            )
            record_audit(
                session,
                g.admin_actor,
                "team.league_identity_deleted",
                target_type="team_league_identity",
                target_id=team_league_identity_id,
                details={"team_id": team_id, **deleted},
            )
        cache.clear()
        return jsonify(detail)
    except Exception as error:
        return _team_identity_error(error)


@admin_api.patch("/api/admin/teams/<int:team_id>/season-entries/<int:team_season_entry_id>")
@require_admin
def api_team_season_identity_update(team_id, team_season_entry_id):
    try:
        with stats.SessionLocal.begin() as session:
            detail, previous = team_identity_management.update_season_identity(
                session,
                team_id,
                team_season_entry_id,
                request.get_json(silent=True) or {},
            )
            updated = next(
                entry for entry in detail["season_entries"] if entry["id"] == team_season_entry_id
            )
            record_audit(
                session,
                g.admin_actor,
                "team.season_identity_updated",
                target_type="team_season_entry",
                target_id=team_season_entry_id,
                details={"team_id": team_id, "previous": previous, "current": updated},
            )
        cache.clear()
        return jsonify(detail)
    except Exception as error:
        return _team_identity_error(error)


@admin_api.get("/api/admin/teams/<int:team_id>/logos")
@require_admin
def api_team_logos(team_id):
    try:
        with stats.SessionLocal() as session:
            return jsonify(team_logo_management.get_team_logo_detail(session, team_id))
    except Exception as error:
        return _team_logo_error(error)


@admin_api.post("/api/admin/teams/<int:team_id>/logos")
@require_admin
def api_team_logo_upload(team_id):
    try:
        image = request.files.get("image")
        if image is None:
            raise ValueError("Choose an image to upload.")
        raw_season_id = str(request.form.get("season_id") or "").strip()
        try:
            season_id = int(raw_season_id) if raw_season_id else None
        except ValueError as error:
            raise ValueError("The selected season is invalid.") from error
        with stats.SessionLocal.begin() as session:
            detail, logo = team_logo_management.create_team_logo(
                session,
                team_id,
                image.read(team_logo_management.MAX_UPLOAD_BYTES + 1),
                season_id=season_id,
                alt_text=request.form.get("alt_text", ""),
            )
            record_audit(
                session,
                g.admin_actor,
                "team_logo.created",
                target_type="team_logo",
                target_id=logo.team_logo_id,
                details={
                    "team_id": team_id,
                    "season_id": season_id,
                    "asset_path": logo.asset_path,
                },
            )
        cache.clear()
        return jsonify(detail), 201
    except Exception as error:
        return _team_logo_error(error)


@admin_api.patch("/api/admin/teams/<int:team_id>/logos/<int:logo_id>")
@require_admin
def api_team_logo_update(team_id, logo_id):
    try:
        payload = request.get_json(silent=True) or {}
        with stats.SessionLocal.begin() as session:
            detail, logo = team_logo_management.update_team_logo(session, team_id, logo_id, payload)
            record_audit(
                session,
                g.admin_actor,
                "team_logo.updated",
                target_type="team_logo",
                target_id=logo_id,
                details={
                    "team_id": team_id,
                    "is_active": logo.is_active,
                    "alt_text": logo.alt_text,
                },
            )
        cache.clear()
        return jsonify(detail)
    except Exception as error:
        return _team_logo_error(error)


@admin_api.post("/api/matches/preview")
def api_match_preview():
    match_data, approved_keys, payload = match_request_payload()
    if not isinstance(match_data, dict):
        return jsonify({"error": "A match JSON object is required."}), 400
    try:
        document = prepare_upload_document(match_data)
        validate_committable_match(match_data)
    except ValueError as error:
        return error_response(error)

    session = stats.SessionLocal()
    transaction = session.begin()
    try:
        new_entries, unapproved, player_identity_links, team_identity_links = unapproved_entries(
            session,
            match_data,
            approved_keys,
            player_identity_links_from_payload(payload),
            team_identity_resolutions_from_payload(payload),
            lookup_mkc_profiles=True,
        )
        if unapproved:
            transaction.rollback()
            return jsonify(
                {
                    "error": "Every new database entry must be approved before preview.",
                    "new_entries": new_entries,
                }
            ), 409
        match = import_preview_match(
            session,
            match_data,
            player_identity_links,
            team_identity_links,
            mkc_profiles_from_entries(new_entries),
        )
        session.flush()
        detail = stats.get_match_detail(match.match_id, session=session)
        transaction.rollback()
        return jsonify(
            {
                "match": detail,
                "preview": {
                    "fingerprint": document.fingerprint,
                    "archive_path": document.display_path,
                    "new_entries": new_entries,
                },
            }
        )
    except Exception as error:
        if transaction.is_active:
            transaction.rollback()
        logger.exception("Failed to preview match")
        if isinstance(error, ValueError):
            return error_response(error)
        return jsonify({"error": "Preview import failed database validation."}), 400
    finally:
        session.close()


@admin_api.post("/api/matches/new-entries")
def api_match_new_entries():
    match_data, _approved_keys, payload = match_request_payload()
    if not isinstance(match_data, dict):
        return jsonify({"error": "A match JSON object is required."}), 400
    try:
        with stats.SessionLocal() as session:
            return jsonify(
                {
                    "new_entries": detect_new_entries(
                        session,
                        match_data,
                        player_identity_links=player_identity_links_from_payload(payload),
                        team_identity_resolutions=team_identity_resolutions_from_payload(payload),
                        lookup_mkc_profiles=True,
                    )
                }
            )
    except Exception as error:
        logger.exception("Failed to detect new match entries")
        return error_response(error)


@admin_api.post("/api/matches/commit")
@require_admin
def api_match_commit():
    match_data, approved_keys, payload = match_request_payload()
    if not isinstance(match_data, dict):
        return jsonify({"error": "A match JSON object is required."}), 400
    expected_fingerprint = (
        payload.get("expected_preview_fingerprint") if isinstance(payload, dict) else None
    )
    storage = get_archive_storage()
    temporary_key = f"queue/admin/{uuid.uuid4()}.json"
    try:
        document = prepare_upload_document(match_data)
        validate_committable_match(match_data)
        storage.put_temporary(temporary_key, document.content)
        result = accept_match(
            storage,
            g.admin_actor,
            match_data,
            approved_keys=approved_keys,
            expected_fingerprint=expected_fingerprint,
            temporary_key=temporary_key,
            requested_player_identity_links=player_identity_links_from_payload(payload),
            requested_team_identity_resolutions=team_identity_resolutions_from_payload(payload),
        )
        return jsonify(result.payload), result.status_code
    except Exception as error:
        storage.delete(temporary_key)
        logger.exception("Failed to commit match")
        if isinstance(error, ValueError):
            return error_response(error)
        return jsonify({"error": "Upload failed before the database commit completed."}), 400


@admin_api.get("/api/database-additions")
@require_admin
def api_database_additions():
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


@admin_api.get("/api/database-health")
@require_admin
def api_database_health():
    include_archive = request.args.get("include_archive", "1").strip().lower() not in {
        "0",
        "false",
        "no",
    }
    try:
        with stats.SessionLocal() as session:
            return jsonify(
                database_health_service.build_database_health(
                    session, include_archive=include_archive
                )
            )
    except Exception:
        logger.exception("Failed to build database health report")
        return jsonify({"error": "Failed to build database health report."}), 500


@admin_api.post("/api/database-health/reviews")
@require_admin
def api_database_health_review():
    payload = request.get_json(silent=True) or {}
    issue_key = payload.get("issue_key")
    try:
        with stats.SessionLocal.begin() as session:
            report = database_health_service.build_database_health(session, include_archive=False)
            issue = next((item for item in report["issues"] if item["key"] == issue_key), None)
            if not issue:
                return jsonify({"error": "That health finding is no longer present."}), 404
            if not issue["dismissible"]:
                return jsonify(
                    {
                        "error": "Hard data-integrity findings cannot be dismissed; fix the source record instead."
                    }
                ), 409
            review = set_issue_review(
                issue_key,
                payload.get("status"),
                payload.get("note", ""),
                reviewed_by=g.admin_actor.email,
                session=session,
                reviewed_by_admin_user_id=g.admin_actor.admin_user_id,
            )
            record_audit(
                session,
                g.admin_actor,
                "health.review",
                target_type="health_issue",
                target_id=issue_key,
                details={"status": payload.get("status")},
            )
        return jsonify({"issue_key": issue_key, "review": review})
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except Exception:
        logger.exception("Failed to save database health review")
        return jsonify({"error": "Failed to save the database health review."}), 500


@admin_api.get("/api/database-additions/stream")
@require_admin
def api_database_additions_stream():
    return jsonify({"error": "Use bounded polling on /api/database-additions."}), 410
