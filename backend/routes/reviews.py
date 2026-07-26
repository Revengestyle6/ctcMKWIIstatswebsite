import json
import logging
import os
import uuid
from datetime import datetime, timezone

from acceptance_service import accept_match
from admin_auth import SessionLocal, record_audit, require_admin
from archive_storage import get_archive_storage
from flask import Blueprint, g, jsonify, request
from match_upload import prepare_upload_document
from models import ReviewSubmission
from review_queue import admin_submission, create_submission, public_receipt
from sqlalchemy import select

from routes.common import player_identity_links_from_payload

logger = logging.getLogger(__name__)
reviews_api = Blueprint("reviews_api", __name__)


@reviews_api.post("/api/review-submissions")
def submit_for_review():
    maximum = int(os.environ.get("MAX_REVIEW_SUBMISSION_BYTES", str(1024 * 1024)))
    if request.content_length and request.content_length > maximum * 2:
        return jsonify({"error": "Submission request is too large."}), 413
    payload = request.get_json(silent=True) or {}
    match_data = payload.get("match")
    if not isinstance(match_data, dict):
        return jsonify({"error": "A match JSON object is required."}), 400
    storage = get_archive_storage()
    try:
        with SessionLocal.begin() as session:
            submission = create_submission(
                session,
                storage,
                match_data,
                original_filename=str(payload.get("original_filename") or "match.json"),
                warnings_acknowledged=payload.get("warnings_acknowledged") is True,
                network_identifier=request.remote_addr or "unknown",
            )
            response = public_receipt(submission)
        return jsonify(response), 202
    except PermissionError as error:
        return jsonify({"error": str(error)}), 429
    except RuntimeError as error:
        try:
            warning_payload = json.loads(str(error))
        except json.JSONDecodeError:
            raise
        return jsonify({"error": "Warnings must be acknowledged.", **warning_payload}), 409
    except ValueError as error:
        return jsonify({"error": str(error)}), 400


@reviews_api.get("/api/review-submissions/<submission_id>")
def review_receipt(submission_id):
    with SessionLocal() as session:
        submission = session.get(ReviewSubmission, submission_id)
        if submission is None:
            return jsonify({"error": "Review receipt was not found."}), 404
        return jsonify(public_receipt(submission))


@reviews_api.get("/api/admin/review-submissions")
@require_admin
def list_review_submissions():
    status = request.args.get("status", "active").strip()
    limit = min(max(request.args.get("limit", type=int) or 100, 1), 250)
    query = select(ReviewSubmission).order_by(ReviewSubmission.submitted_at.desc()).limit(limit)
    if status == "active":
        query = query.where(ReviewSubmission.status.in_(("pending", "in_review")))
    elif status and status != "all":
        query = query.where(ReviewSubmission.status == status)
    with SessionLocal() as session:
        return jsonify([admin_submission(row) for row in session.scalars(query).all()])


@reviews_api.get("/api/admin/review-submissions/<submission_id>")
@require_admin
def get_review_submission(submission_id):
    storage = get_archive_storage()
    with SessionLocal() as session:
        submission = session.get(ReviewSubmission, submission_id)
        if submission is None:
            return jsonify({"error": "Review submission was not found."}), 404
        document = json.loads(storage.read(submission.queue_object_key))
        return jsonify(admin_submission(submission, include_document=document))


@reviews_api.post("/api/admin/review-submissions/<submission_id>/claim")
@require_admin
def claim_review_submission(submission_id):
    with SessionLocal.begin() as session:
        submission = session.scalar(
            select(ReviewSubmission)
            .where(ReviewSubmission.submission_id == submission_id)
            .with_for_update()
        )
        if submission is None:
            return jsonify({"error": "Review submission was not found."}), 404
        if submission.status not in {"pending", "in_review"}:
            return jsonify({"error": f"Submission is already {submission.status}."}), 409
        if submission.claimed_by_admin_user_id not in {None, g.admin_actor.admin_user_id}:
            return jsonify({"error": "Submission is claimed by another administrator."}), 409
        submission.status = "in_review"
        submission.claimed_by_admin_user_id = g.admin_actor.admin_user_id
        submission.claimed_at = submission.claimed_at or datetime.now(timezone.utc)
        submission.updated_at = datetime.now(timezone.utc)
        record_audit(
            session,
            g.admin_actor,
            "review.claim",
            target_type="review_submission",
            target_id=submission_id,
        )
        result = admin_submission(submission)
    return jsonify(result)


@reviews_api.post("/api/admin/review-submissions/<submission_id>/reject")
@require_admin
def reject_review_submission(submission_id):
    note = str((request.get_json(silent=True) or {}).get("note") or "").strip()
    if not note:
        return jsonify({"error": "A rejection reason is required."}), 400
    storage = get_archive_storage()
    with SessionLocal.begin() as session:
        submission = session.scalar(
            select(ReviewSubmission)
            .where(ReviewSubmission.submission_id == submission_id)
            .with_for_update()
        )
        if submission is None:
            return jsonify({"error": "Review submission was not found."}), 404
        if submission.status not in {"pending", "in_review"}:
            return jsonify({"error": f"Submission is already {submission.status}."}), 409
        if submission.claimed_by_admin_user_id not in {None, g.admin_actor.admin_user_id}:
            return jsonify({"error": "Submission is claimed by another administrator."}), 409
        submission.status = "rejected"
        submission.reviewed_by_admin_user_id = g.admin_actor.admin_user_id
        submission.reviewed_at = datetime.now(timezone.utc)
        submission.updated_at = submission.reviewed_at
        submission.decision_note = note
        queue_key = submission.queue_object_key
        record_audit(
            session,
            g.admin_actor,
            "review.reject",
            target_type="review_submission",
            target_id=submission_id,
            details={"reason": note},
        )
        result = admin_submission(submission)
    try:
        storage.delete(queue_key)
    except Exception:
        logger.exception("Rejected review object deletion will be retried by maintenance")
    return jsonify(result)


@reviews_api.post("/api/admin/review-submissions/<submission_id>/accept")
@require_admin
def accept_review_submission(submission_id):
    payload = request.get_json(silent=True) or {}
    match_data = payload.get("match")
    if not isinstance(match_data, dict):
        return jsonify({"error": "A reviewed match JSON object is required."}), 400
    approved_keys = set(payload.get("approved_new_entries") or [])
    expected_fingerprint = str(payload.get("expected_preview_fingerprint") or "")
    storage = get_archive_storage()
    with SessionLocal() as session:
        submission = session.get(ReviewSubmission, submission_id)
        if submission is None:
            return jsonify({"error": "Review submission was not found."}), 404
        original_queue_key = submission.queue_object_key
    document = prepare_upload_document(match_data)
    temporary_key = original_queue_key
    if storage.read(original_queue_key) != document.content:
        temporary_key = f"queue/admin/{uuid.uuid4()}.json"
        storage.put_temporary(temporary_key, document.content)
    try:
        result = accept_match(
            storage,
            g.admin_actor,
            match_data,
            approved_keys=approved_keys,
            expected_fingerprint=expected_fingerprint,
            temporary_key=temporary_key,
            review_submission_id=submission_id,
            requested_player_identity_links=player_identity_links_from_payload(payload),
        )
        if temporary_key != original_queue_key:
            storage.delete(original_queue_key)
        return jsonify(result.payload), result.status_code
    except ValueError as error:
        if temporary_key != original_queue_key:
            storage.delete(temporary_key)
        return jsonify({"error": str(error)}), 409
