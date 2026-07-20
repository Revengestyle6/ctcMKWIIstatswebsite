import logging
import uuid

import database_health as database_health_service
import stats_db as stats
from acceptance_service import accept_match
from admin_auth import record_audit, require_admin
from archive_storage import get_archive_storage
from database_health_reviews import set_issue_review
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
    unapproved_entries,
)

logger = logging.getLogger(__name__)
admin_api = Blueprint("admin_api", __name__)


@admin_api.post("/api/matches/preview")
def api_match_preview():
    match_data, approved_keys, _payload = match_request_payload()
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
            session, match_data, approved_keys
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
    match_data, _approved_keys, _payload = match_request_payload()
    if not isinstance(match_data, dict):
        return jsonify({"error": "A match JSON object is required."}), 400
    try:
        with stats.SessionLocal() as session:
            return jsonify({"new_entries": detect_new_entries(session, match_data)})
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
