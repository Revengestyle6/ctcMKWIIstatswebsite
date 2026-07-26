import logging
import uuid

import alias_management
import database_health as database_health_service
import stats_db as stats
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
    player_identity_links_from_payload,
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


@admin_api.get("/api/admin/aliases/<entity_type>")
@require_admin
def api_alias_entities(entity_type):
    try:
        limit = min(max(request.args.get("limit", type=int) or 200, 1), 500)
        with stats.SessionLocal() as session:
            return jsonify(
                alias_management.list_entities(
                    session, entity_type, query=request.args.get("query", ""), limit=limit
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
        new_entries, unapproved, player_identity_links = unapproved_entries(
            session,
            match_data,
            approved_keys,
            player_identity_links_from_payload(payload),
        )
        if unapproved:
            transaction.rollback()
            return jsonify(
                {
                    "error": "Every new database entry must be approved before preview.",
                    "new_entries": new_entries,
                }
            ), 409
        match = import_preview_match(session, match_data, player_identity_links)
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
