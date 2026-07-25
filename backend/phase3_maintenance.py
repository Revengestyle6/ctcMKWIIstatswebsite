import hashlib
import json
import uuid
from datetime import datetime, timezone

from archive_storage import ArchiveStorage
from match_upload import canonical_json_bytes
from models import Match, ReviewSubmission, SourceFile, SubmissionRateLimit
from sqlalchemy import delete, select


def _utc_now():
    return datetime.now(timezone.utc)


def expire_review_submissions(session, storage: ArchiveStorage, *, now=None) -> int:
    now = now or _utc_now()
    submissions = session.scalars(
        select(ReviewSubmission).where(
            ReviewSubmission.status.in_(("pending", "in_review")),
            ReviewSubmission.expires_at <= now,
        )
    ).all()
    for submission in submissions:
        storage.delete(submission.queue_object_key)
        submission.status = "expired"
        submission.updated_at = now
    terminal_submissions = session.scalars(
        select(ReviewSubmission).where(ReviewSubmission.status.in_(("rejected", "expired")))
    ).all()
    for submission in terminal_submissions:
        try:
            storage.delete(submission.queue_object_key)
        except Exception:
            # Bucket lifecycle is the final guard for an unavailable object store;
            # a later maintenance run will retry the idempotent delete.
            pass
    session.execute(delete(SubmissionRateLimit).where(SubmissionRateLimit.expires_at <= now))
    return len(submissions)


def repair_accepted_archives(session_factory, storage: ArchiveStorage) -> tuple[int, int]:
    """Repair accepted database rows whose immutable archive promotion failed."""
    with session_factory() as session:
        source_ids = session.scalars(
            select(SourceFile.source_file_id).where(
                SourceFile.archive_status.in_(("pending", "repair_required")),
                SourceFile.storage_provider == storage.provider,
            )
        ).all()

    repaired = 0
    failed = 0
    for source_id in source_ids:
        temporary_key = None
        try:
            with session_factory() as session:
                source = session.get(SourceFile, source_id)
                match = session.scalar(select(Match).where(Match.source_file_id == source_id))
                if source is None or match is None or not source.storage_object_key:
                    raise ValueError("The accepted source is missing repair metadata.")
                content = canonical_json_bytes(json.loads(match.raw_json or "{}"))
                if hashlib.sha256(content).hexdigest() != source.file_sha256:
                    raise ValueError(
                        "The accepted database JSON no longer matches its fingerprint."
                    )
                temporary_key = f"queue/repair/{uuid.uuid4()}.json"
                accepted_key = source.storage_object_key
                fingerprint = source.file_sha256

            storage.put_temporary(temporary_key, content)
            stored = storage.promote(temporary_key, accepted_key, fingerprint)
            with session_factory.begin() as session:
                source = session.get(SourceFile, source_id)
                if source is None:
                    raise ValueError("The accepted source disappeared during archive repair.")
                source.archive_status = "complete"
                source.storage_generation = stored.generation
                source.archived_at = _utc_now()
                source.archive_attempts += 1
                source.last_archive_error_code = None
            repaired += 1
        except Exception as error:
            if temporary_key:
                try:
                    storage.delete(temporary_key)
                except Exception:
                    pass
            with session_factory.begin() as session:
                source = session.get(SourceFile, source_id)
                if source is not None:
                    source.archive_attempts += 1
                    source.last_archive_error_code = type(error).__name__[:80]
            failed += 1
    return repaired, failed
