from dataclasses import dataclass
from datetime import datetime, timezone

import stats_db as stats
from admin_auth import AdminActor, record_audit
from archive_storage import ArchiveStorage, accepted_object_key
from import_json_to_db import import_editor_match
from match_upload import (
    AdditionCapture,
    find_duplicate_source,
    find_match_conflict,
    prepare_upload_document,
    record_addition_logs,
    serialize_addition_log,
    validate_committable_match,
)
from models import Match, ReviewSubmission, SourceFile
from routes.common import duplicate_commit_response, mkc_profiles_from_entries, unapproved_entries
from sqlalchemy import select


@dataclass(frozen=True)
class AcceptanceResult:
    payload: dict
    status_code: int = 200


def _utc_now():
    return datetime.now(timezone.utc)


def _finish_archive(
    storage: ArchiveStorage,
    *,
    source_file_id: int,
    temporary_key: str,
    accepted_key: str,
    fingerprint: str,
    submission_id: str | None,
) -> tuple[str, str | None]:
    try:
        stored = storage.promote(temporary_key, accepted_key, fingerprint)
    except Exception as error:
        error_code = type(error).__name__[:80]
        with stats.SessionLocal.begin() as session:
            source = session.get(SourceFile, source_file_id)
            if source is None:
                raise RuntimeError(f"Source file {source_file_id} disappeared after commit.")
            source.archive_status = "repair_required"
            source.archive_attempts += 1
            source.last_archive_error_code = error_code
            if submission_id:
                submission = session.get(ReviewSubmission, submission_id)
                submission.status = "accepted"
                submission.updated_at = _utc_now()
        return "repair_required", None

    with stats.SessionLocal.begin() as session:
        source = session.get(SourceFile, source_file_id)
        if source is None:
            raise RuntimeError(f"Source file {source_file_id} disappeared after commit.")
        source.archive_status = "complete"
        source.storage_generation = stored.generation
        source.archived_at = _utc_now()
        source.archive_attempts += 1
        source.last_archive_error_code = None
        if submission_id:
            submission = session.get(ReviewSubmission, submission_id)
            submission.status = "accepted"
            submission.updated_at = _utc_now()
    return "complete", stored.generation


def accept_match(
    storage: ArchiveStorage,
    actor: AdminActor,
    match_data: dict,
    *,
    approved_keys: set[str],
    expected_fingerprint: str,
    temporary_key: str,
    review_submission_id: str | None = None,
    requested_player_identity_links: dict[str, int] | None = None,
    requested_team_identity_resolutions: dict[str, dict] | None = None,
) -> AcceptanceResult:
    document = prepare_upload_document(match_data)
    validate_committable_match(match_data)
    if not expected_fingerprint or expected_fingerprint != document.fingerprint:
        raise ValueError(
            "The match changed after preview. Generate a new preview before accepting."
        )
    if storage.read(temporary_key) != document.content:
        raise ValueError("The temporary submission no longer matches the reviewed document.")
    accepted_key = accepted_object_key(document)

    session = stats.SessionLocal()
    transaction = session.begin()
    try:
        submission = None
        if review_submission_id:
            submission = session.scalar(
                select(ReviewSubmission)
                .where(ReviewSubmission.submission_id == review_submission_id)
                .with_for_update()
            )
            if submission is None:
                raise ValueError("Review submission was not found.")
            if submission.status not in {"pending", "in_review"}:
                raise ValueError(f"Review submission is already {submission.status}.")
            if submission.claimed_by_admin_user_id not in {None, actor.admin_user_id}:
                raise ValueError("This submission is claimed by another administrator.")
            submission.claimed_by_admin_user_id = actor.admin_user_id
            submission.claimed_at = submission.claimed_at or _utc_now()

        new_entries, unapproved, player_identity_links, team_identity_links = unapproved_entries(
            session,
            match_data,
            approved_keys,
            requested_player_identity_links,
            requested_team_identity_resolutions,
            lookup_mkc_profiles=True,
        )
        if unapproved:
            raise ValueError("Every new database entry must be approved before acceptance.")

        existing_source = find_duplicate_source(session, document)
        if existing_source:
            match = session.scalar(
                select(Match).where(Match.source_file_id == existing_source.source_file_id)
            )
            if existing_source.file_sha256 != document.fingerprint or match is None:
                raise ValueError("The archive path conflicts with a different database source.")
            if submission:
                submission.status = "accepted"
                submission.reviewed_by_admin_user_id = actor.admin_user_id
                submission.reviewed_at = _utc_now()
                submission.accepted_match_id = match.match_id
                submission.updated_at = _utc_now()
            record_audit(
                session,
                actor,
                "match.accept_duplicate",
                target_type="match",
                target_id=match.match_id,
                details={"fingerprint": document.fingerprint},
            )
            payload = duplicate_commit_response(session, existing_source, document.fingerprint)
            source_file_id = existing_source.source_file_id
            archive_status = existing_source.archive_status
            existing_accepted_key = existing_source.storage_object_key or accepted_key
            transaction.commit()
            if archive_status != "complete":
                archive_status, _generation = _finish_archive(
                    storage,
                    source_file_id=source_file_id,
                    temporary_key=temporary_key,
                    accepted_key=existing_accepted_key,
                    fingerprint=document.fingerprint,
                    submission_id=review_submission_id,
                )
            else:
                try:
                    storage.delete(temporary_key)
                except Exception:
                    # The accepted database record is authoritative. Maintenance can
                    # remove a stale temporary object without failing an idempotent retry.
                    pass
            payload["archive_status"] = archive_status
            return AcceptanceResult(payload, 200 if archive_status == "complete" else 202)

        conflicting_match = find_match_conflict(session, match_data)
        if conflicting_match:
            raise ValueError(
                f"Possible duplicate of match {conflicting_match.match_id}: "
                f"{conflicting_match.match_label}"
            )

        capture = AdditionCapture(session)
        match = import_editor_match(
            session,
            match_data,
            source_path=document.source_path,
            source_filename=document.filename,
            file_sha256=document.fingerprint,
            player_identity_links=player_identity_links,
            team_identity_links=team_identity_links,
            player_mkc_profiles=mkc_profiles_from_entries(new_entries),
            source_metadata={
                "storage_provider": storage.provider,
                "storage_object_key": accepted_key,
                "archive_status": "pending",
                "accepted_by_admin_user_id": actor.admin_user_id,
                "review_submission_id": review_submission_id,
            },
        )
        session.flush()
        source_file_id = match.source_file_id
        detail = stats.get_match_detail(match.match_id, session=session)
        additions = capture.stop()
        log_rows = record_addition_logs(session, additions, match.match_id)
        serialized_logs = [serialize_addition_log(log) for log in log_rows]
        if submission:
            submission.reviewed_by_admin_user_id = actor.admin_user_id
            submission.reviewed_at = _utc_now()
            submission.accepted_match_id = match.match_id
            submission.updated_at = _utc_now()
        record_audit(
            session,
            actor,
            "match.accept",
            target_type="match",
            target_id=match.match_id,
            details={
                "fingerprint": document.fingerprint,
                "review_submission_id": review_submission_id,
            },
        )
        transaction.commit()
    except Exception:
        if transaction.is_active:
            transaction.rollback()
        raise
    finally:
        session.close()

    archive_status, _generation = _finish_archive(
        storage,
        source_file_id=source_file_id,
        temporary_key=temporary_key,
        accepted_key=accepted_key,
        fingerprint=document.fingerprint,
        submission_id=review_submission_id,
    )
    return AcceptanceResult(
        {
            "status": "committed",
            "match_id": match.match_id,
            "archive_path": accepted_key,
            "archive_status": archive_status,
            "fingerprint": document.fingerprint,
            "match": detail,
            "additions": serialized_logs,
            "message": (
                "Match committed and archived successfully."
                if archive_status == "complete"
                else "Match committed; archive reconciliation is required."
            ),
        },
        200 if archive_status == "complete" else 202,
    )
