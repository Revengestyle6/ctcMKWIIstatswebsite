import hashlib
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from database import BASE_DIR, app_environment
from match_upload import UploadDocument


class StorageConflictError(ValueError):
    pass


@dataclass(frozen=True)
class StoredObject:
    key: str
    generation: str
    size: int
    sha256: str


def _safe_key(key: str) -> str:
    path = PurePosixPath(key)
    if not key or path.is_absolute() or ".." in path.parts:
        raise ValueError("Storage object key must be a safe relative path.")
    return path.as_posix()


def accepted_object_key(document: UploadDocument) -> str:
    parts = PurePosixPath(document.source_path).parts
    archive_parts = parts[1:] if parts and parts[0] == "JSON" else parts
    parent = PurePosixPath("accepted", *archive_parts[:-1])
    stem = PurePosixPath(archive_parts[-1]).stem
    return (parent / f"{stem}--{document.fingerprint[:12]}.json").as_posix()


class ArchiveStorage(ABC):
    provider: str

    @abstractmethod
    def put_temporary(self, key: str, content: bytes) -> StoredObject:
        raise NotImplementedError

    @abstractmethod
    def promote(self, temporary_key: str, accepted_key: str, fingerprint: str) -> StoredObject:
        raise NotImplementedError

    @abstractmethod
    def read(self, key: str) -> bytes:
        raise NotImplementedError

    @abstractmethod
    def delete(self, key: str) -> None:
        raise NotImplementedError


class LocalArchiveStorage(ArchiveStorage):
    provider = "local"

    def __init__(self, root: Path | None = None):
        configured = os.environ.get("ARCHIVE_STORAGE_ROOT")
        self.root = (
            Path(configured).expanduser().resolve()
            if configured
            else (root or BASE_DIR / "data" / "object_storage").resolve()
        )

    def _path(self, key: str) -> Path:
        return self.root / _safe_key(key)

    @staticmethod
    def _metadata(key: str, content: bytes) -> StoredObject:
        digest = hashlib.sha256(content).hexdigest()
        return StoredObject(key, digest, len(content), digest)

    def put_temporary(self, key: str, content: bytes) -> StoredObject:
        key = _safe_key(key)
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with path.open("xb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
        except FileExistsError as error:
            if path.read_bytes() != content:
                raise StorageConflictError(f"Storage object already exists: {key}") from error
        return self._metadata(key, content)

    def promote(self, temporary_key: str, accepted_key: str, fingerprint: str) -> StoredObject:
        temporary_key = _safe_key(temporary_key)
        accepted_key = _safe_key(accepted_key)
        temporary_path = self._path(temporary_key)
        content = temporary_path.read_bytes()
        if hashlib.sha256(content).hexdigest() != fingerprint:
            raise StorageConflictError("Temporary object fingerprint changed before acceptance.")
        accepted_path = self._path(accepted_key)
        accepted_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.link(temporary_path, accepted_path)
        except FileExistsError as error:
            if accepted_path.read_bytes() != content:
                raise StorageConflictError(
                    f"Accepted storage object already exists: {accepted_key}"
                ) from error
        temporary_path.unlink(missing_ok=True)
        return self._metadata(accepted_key, content)

    def read(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class GcsArchiveStorage(ArchiveStorage):
    provider = "gcs"

    def __init__(self, bucket_name: str):
        if not bucket_name:
            raise RuntimeError("ARCHIVE_GCS_BUCKET is required for GCS storage.")
        from google.cloud import storage

        self.bucket = storage.Client().bucket(bucket_name)

    @staticmethod
    def _metadata(blob, content: bytes) -> StoredObject:
        digest = hashlib.sha256(content).hexdigest()
        return StoredObject(blob.name, str(blob.generation or ""), len(content), digest)

    def put_temporary(self, key: str, content: bytes) -> StoredObject:
        from google.api_core.exceptions import PreconditionFailed

        key = _safe_key(key)
        blob = self.bucket.blob(key)
        try:
            blob.upload_from_string(
                content,
                content_type="application/json",
                if_generation_match=0,
                checksum="auto",
            )
        except PreconditionFailed as error:
            if blob.download_as_bytes() != content:
                raise StorageConflictError(f"Storage object already exists: {key}") from error
            blob.reload()
        return self._metadata(blob, content)

    def promote(self, temporary_key: str, accepted_key: str, fingerprint: str) -> StoredObject:
        from google.api_core.exceptions import PreconditionFailed

        temporary_key = _safe_key(temporary_key)
        accepted_key = _safe_key(accepted_key)
        temporary = self.bucket.blob(temporary_key)
        temporary.reload()
        content = temporary.download_as_bytes(if_generation_match=temporary.generation)
        if hashlib.sha256(content).hexdigest() != fingerprint:
            raise StorageConflictError("Temporary object fingerprint changed before acceptance.")
        accepted = self.bucket.blob(accepted_key)
        try:
            accepted.upload_from_string(
                content,
                content_type="application/json",
                if_generation_match=0,
                checksum="auto",
            )
        except PreconditionFailed as error:
            if accepted.download_as_bytes() != content:
                raise StorageConflictError(
                    f"Accepted storage object already exists: {accepted_key}"
                ) from error
            accepted.reload()
        temporary.delete(if_generation_match=temporary.generation)
        return self._metadata(accepted, content)

    def read(self, key: str) -> bytes:
        return self.bucket.blob(_safe_key(key)).download_as_bytes()

    def delete(self, key: str) -> None:
        from google.api_core.exceptions import NotFound

        try:
            self.bucket.blob(_safe_key(key)).delete()
        except NotFound:
            return


def get_archive_storage() -> ArchiveStorage:
    provider = os.environ.get("ARCHIVE_STORAGE_PROVIDER", "local").strip().lower()
    if app_environment() in {"staging", "production"} and provider != "gcs":
        raise RuntimeError("Staging and production require ARCHIVE_STORAGE_PROVIDER=gcs.")
    if provider == "local":
        return LocalArchiveStorage()
    if provider == "gcs":
        return GcsArchiveStorage(os.environ.get("ARCHIVE_GCS_BUCKET", ""))
    raise RuntimeError("ARCHIVE_STORAGE_PROVIDER must be local or gcs.")
