import hashlib
import hmac
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from archive_storage import ArchiveStorage
from import_json_to_db import detect_new_entries
from match_results import result_type
from match_upload import canonical_json_bytes, validate_committable_match
from models import ReviewSubmission, SubmissionRateLimit
from sqlalchemy import select

VALIDATION_VERSION = "phase3-v1"
ACTIVE_SUBMISSION_STATUSES = ("pending", "in_review")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def validate_submission(session, match_data: dict) -> tuple[bytes, str, list[str]]:
    validate_committable_match(match_data)
    content = canonical_json_bytes(match_data)
    maximum_bytes = int(os.environ.get("MAX_REVIEW_SUBMISSION_BYTES", str(1024 * 1024)))
    if len(content) > maximum_bytes:
        raise ValueError(f"Canonical JSON exceeds the {maximum_bytes}-byte submission limit.")

    warnings = []
    new_entries = detect_new_entries(session, match_data)
    if new_entries:
        warnings.append(f"Administrators must review {len(new_entries)} new database entries.")
    tracks = match_data.get("tracks") or []
    if result_type(match_data) == "played" and len(tracks) != 12:
        warnings.append(f"This match contains {len(tracks)} races instead of the usual 12.")
    if any((team.get("penalties") or 0) for team in (match_data.get("teams") or {}).values()):
        warnings.append("One or more teams has penalty points.")
    missing_roles = 0
    for team in (match_data.get("teams") or {}).values():
        for player in (team.get("players") or {}).values():
            roles = player.get("race_roles") or []
            missing_roles += sum(role not in {"runner", "bagger"} for role in roles)
    if missing_roles:
        warnings.append(f"{missing_roles} race roles require inference or administrator review.")
    fingerprint = hashlib.sha256(content).hexdigest()
    return content, fingerprint, warnings


def enforce_rate_limit(session, network_identifier: str) -> None:
    secret = os.environ.get("SUBMISSION_RATE_LIMIT_SECRET", "")
    if not secret:
        if os.environ.get("APP_ENV", "local").strip().lower() in {"staging", "production"}:
            raise RuntimeError("SUBMISSION_RATE_LIMIT_SECRET is required.")
        secret = "local-development-only"
    network_key = hmac.new(secret.encode(), network_identifier.encode(), hashlib.sha256).hexdigest()
    now = _utc_now()
    window_minutes = max(int(os.environ.get("SUBMISSION_RATE_WINDOW_MINUTES", "60")), 1)
    window = now.replace(minute=0, second=0, microsecond=0)
    if window_minutes != 60:
        minute = (now.minute // window_minutes) * window_minutes
        window = now.replace(minute=minute, second=0, microsecond=0)
    limit = max(int(os.environ.get("SUBMISSION_RATE_LIMIT", "10")), 1)
    row = session.get(SubmissionRateLimit, (network_key, window))
    if row is None:
        row = SubmissionRateLimit(
            network_key=network_key,
            window_started_at=window,
            request_count=1,
            expires_at=window + timedelta(minutes=window_minutes * 2),
        )
        session.add(row)
    elif row.request_count >= limit:
        raise PermissionError("The anonymous submission limit has been reached. Try again later.")
    else:
        row.request_count += 1


def create_submission(
    session,
    storage: ArchiveStorage,
    match_data: dict,
    *,
    original_filename: str,
    warnings_acknowledged: bool,
    network_identifier: str,
    enforce_network_rate_limit: bool = True,
) -> ReviewSubmission:
    content, fingerprint, warnings = validate_submission(session, match_data)
    if warnings and not warnings_acknowledged:
        raise RuntimeError(json.dumps({"warnings": warnings}, ensure_ascii=False))
    duplicate = session.scalar(
        select(ReviewSubmission).where(
            ReviewSubmission.fingerprint == fingerprint,
            ReviewSubmission.status.in_(ACTIVE_SUBMISSION_STATUSES),
        )
    )
    if duplicate:
        return duplicate

    if enforce_network_rate_limit:
        enforce_rate_limit(session, network_identifier)
    submission_id = str(uuid.uuid4())
    queue_key = f"queue/pending/{submission_id}.json"
    storage.put_temporary(queue_key, content)
    now = _utc_now()
    safe_filename = Path(original_filename or "match.json").name[:255] or "match.json"
    submission = ReviewSubmission(
        submission_id=submission_id,
        fingerprint=fingerprint,
        queue_object_key=queue_key,
        original_filename=safe_filename,
        match_label=str(match_data.get("match_label") or "").strip() or None,
        content_length=len(content),
        validation_version=VALIDATION_VERSION,
        warnings_json=json.dumps(warnings, ensure_ascii=False, separators=(",", ":")),
        warnings_acknowledged=warnings_acknowledged,
        status="pending",
        submitted_at=now,
        expires_at=now + timedelta(days=30),
        updated_at=now,
    )
    session.add(submission)
    try:
        session.flush()
    except Exception:
        storage.delete(queue_key)
        raise
    return submission


def public_receipt(submission: ReviewSubmission) -> dict:
    return {
        "receipt": submission.submission_id,
        "status": submission.status,
        "submitted_at": submission.submitted_at.isoformat(),
        "updated_at": submission.updated_at.isoformat(),
        "expires_at": submission.expires_at.isoformat(),
    }


def admin_submission(submission: ReviewSubmission, *, include_document=None) -> dict:
    document_match_label = (
        str(include_document.get("match_label") or "").strip()
        if isinstance(include_document, dict)
        else ""
    )
    payload = {
        **public_receipt(submission),
        "submission_id": submission.submission_id,
        "fingerprint": submission.fingerprint,
        "original_filename": submission.original_filename,
        "match_label": submission.match_label or document_match_label or None,
        "content_length": submission.content_length,
        "warnings": json.loads(submission.warnings_json or "[]"),
        "warnings_acknowledged": submission.warnings_acknowledged,
        "claimed_by_admin_user_id": submission.claimed_by_admin_user_id,
        "claimed_at": submission.claimed_at.isoformat() if submission.claimed_at else None,
        "reviewed_by_admin_user_id": submission.reviewed_by_admin_user_id,
        "reviewed_at": submission.reviewed_at.isoformat() if submission.reviewed_at else None,
        "decision_note": submission.decision_note,
        "accepted_match_id": submission.accepted_match_id,
    }
    if include_document is not None:
        payload["match"] = include_document
    return payload
