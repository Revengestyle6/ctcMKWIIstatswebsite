import json
import logging
import time

import database_health as database_health_service
import stats_db as stats
from database_health_reviews import set_issue_review
from extensions import cache
from flask import Blueprint, Response, jsonify, request, stream_with_context
from import_json_to_db import detect_new_entries, import_editor_match, import_preview_match
from match_upload import (
    AdditionCapture,
    ArchiveConflictError,
    find_duplicate_source,
    find_match_conflict,
    prepare_upload_document,
    publish_staged_document,
    record_addition_logs,
    serialize_addition_log,
    source_archive_path,
    stage_upload_document,
    validate_committable_match,
)
from models import DatabaseAdditionLog
from sqlalchemy import select

from routes.common import (
    duplicate_commit_response,
    error_response,
    match_request_payload,
    require_database_write_access,
    unapproved_entries,
)

logger = logging.getLogger(__name__)
admin_api = Blueprint("admin_api", __name__)


@admin_api.post("/api/matches/preview")
def api_match_preview():
    access_error = require_database_write_access()
    if access_error:
        return access_error
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
def api_match_commit():
    access_error = require_database_write_access()
    if access_error:
        return access_error
    match_data, approved_keys, payload = match_request_payload()
    if not isinstance(match_data, dict):
        return jsonify({"error": "A match JSON object is required."}), 400
    expected_fingerprint = (
        payload.get("expected_preview_fingerprint") if isinstance(payload, dict) else None
    )
    try:
        document = prepare_upload_document(match_data)
        validate_committable_match(match_data)
    except ValueError as error:
        return error_response(error)
    if not expected_fingerprint:
        return jsonify({"error": "Preview this exact match before confirming upload."}), 409
    if expected_fingerprint != document.fingerprint:
        return jsonify(
            {"error": "The match changed after preview. Generate a new preview before uploading."}
        ), 409

    staged_path = None
    published = False
    committed = False
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
                    "error": "Every new database entry must be approved before upload.",
                    "new_entries": new_entries,
                }
            ), 409

        existing_source = find_duplicate_source(session, document)
        if existing_source:
            if existing_source.file_sha256 != document.fingerprint:
                transaction.rollback()
                return jsonify(
                    {
                        "error": f"Archive path already belongs to different content: {document.display_path}"
                    }
                ), 409
            existing_archive = source_archive_path(existing_source)
            if not existing_archive.exists():
                transaction.rollback()
                return jsonify(
                    {
                        "error": "This match exists in the database, but its archive file is missing. Run archive reconciliation."
                    }
                ), 409
            if existing_archive.read_bytes() != document.content:
                transaction.rollback()
                return jsonify(
                    {
                        "error": "This match exists in the database, but its archive file content does not match. Run archive reconciliation."
                    }
                ), 409
            result = duplicate_commit_response(session, existing_source, document.fingerprint)
            transaction.rollback()
            return jsonify(result)

        conflicting_match = find_match_conflict(session, match_data)
        if conflicting_match:
            transaction.rollback()
            return jsonify(
                {
                    "error": f"Possible duplicate of match {conflicting_match.match_id}: {conflicting_match.match_label}",
                    "match_id": conflicting_match.match_id,
                }
            ), 409

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
        except Exception:
            logger.exception("Match committed, but cache clearing failed")
        return jsonify(
            {
                "status": "committed",
                "match_id": match.match_id,
                "archive_path": document.display_path,
                "fingerprint": document.fingerprint,
                "match": detail,
                "additions": serialized_logs,
                "message": "Match uploaded and archived successfully.",
            }
        )
    except ArchiveConflictError as error:
        if transaction.is_active:
            transaction.rollback()
        return jsonify({"error": str(error)}), 409
    except Exception as error:
        if transaction.is_active:
            transaction.rollback()
        logger.exception("Failed to commit match")
        if isinstance(error, ValueError):
            return error_response(error)
        return jsonify(
            {"error": "Upload failed; database and archive changes were rolled back."}
        ), 400
    finally:
        if staged_path:
            staged_path.unlink(missing_ok=True)
        if published and not committed:
            document.final_path.unlink(missing_ok=True)
        session.close()


@admin_api.get("/api/database-additions")
def api_database_additions():
    access_error = require_database_write_access()
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


@admin_api.get("/api/database-health")
@cache.cached(timeout=30, query_string=True)
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
def api_database_health_review():
    access_error = require_database_write_access()
    if access_error:
        return access_error
    payload = request.get_json(silent=True) or {}
    issue_key = payload.get("issue_key")
    try:
        with stats.SessionLocal() as session:
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
        )
        cache.clear()
        return jsonify({"issue_key": issue_key, "review": review})
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except Exception:
        logger.exception("Failed to save database health review")
        return jsonify({"error": "Failed to save the database health review."}), 500


@admin_api.get("/api/database-additions/stream")
def api_database_additions_stream():
    access_error = require_database_write_access()
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
                    payload = json.dumps(
                        serialize_addition_log(row),
                        ensure_ascii=False,
                        separators=(",", ":"),
                    )
                    yield f"id: {last_id}\nevent: addition\ndata: {payload}\n\n"
            else:
                yield ": keep-alive\n\n"
            time.sleep(1)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
