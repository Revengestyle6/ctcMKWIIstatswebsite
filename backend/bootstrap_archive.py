import hashlib
import uuid
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from archive_storage import ArchiveStorage
from models import SourceFile
from sqlalchemy import select


def _utc_now():
    return datetime.now(timezone.utc)


def accepted_key_for_source(source_path: str) -> str:
    parts = PurePosixPath(source_path).parts
    if len(parts) < 2 or parts[0] != "JSON" or ".." in parts:
        raise ValueError(f"Historical source path is not canonical: {source_path}")
    return PurePosixPath("accepted", *parts[1:]).as_posix()


def local_path_for_source(json_root: Path, source_path: str) -> Path:
    parts = PurePosixPath(source_path).parts
    accepted_key_for_source(source_path)
    return json_root.joinpath(*parts[1:])


def archive_imported_sources(session_factory, storage: ArchiveStorage, json_root: Path):
    """Promote imported historical files into immutable object storage."""
    with session_factory() as session:
        source_ids = session.scalars(
            select(SourceFile.source_file_id)
            .where(SourceFile.source_path.like("JSON/%"))
            .order_by(SourceFile.source_file_id)
        ).all()

    archived = 0
    failed = 0
    for source_id in source_ids:
        temporary_key = None
        try:
            with session_factory() as session:
                source = session.get(SourceFile, source_id)
                if source is None:
                    raise ValueError("Historical source disappeared during archive bootstrap.")
                local_path = local_path_for_source(json_root, source.source_path)
                accepted_key = accepted_key_for_source(source.source_path)
                fingerprint = source.file_sha256

            content = local_path.read_bytes()
            if hashlib.sha256(content).hexdigest() != fingerprint:
                raise ValueError(f"Historical source fingerprint changed: {source.source_path}")

            with session_factory.begin() as session:
                source = session.get(SourceFile, source_id)
                source.storage_provider = storage.provider
                source.storage_object_key = accepted_key
                source.archive_status = "pending"
                source.last_archive_error_code = None

            temporary_key = f"queue/bootstrap/{uuid.uuid4()}.json"
            storage.put_temporary(temporary_key, content)
            stored = storage.promote(temporary_key, accepted_key, fingerprint)

            with session_factory.begin() as session:
                source = session.get(SourceFile, source_id)
                source.archive_status = "complete"
                source.storage_generation = stored.generation
                source.archived_at = _utc_now()
                source.archive_attempts += 1
                source.last_archive_error_code = None
            archived += 1
        except Exception as error:
            if temporary_key:
                try:
                    storage.delete(temporary_key)
                except Exception:
                    pass
            with session_factory.begin() as session:
                source = session.get(SourceFile, source_id)
                if source is not None:
                    source.archive_status = "repair_required"
                    source.archive_attempts += 1
                    source.last_archive_error_code = type(error).__name__[:80]
            failed += 1
    return archived, failed
