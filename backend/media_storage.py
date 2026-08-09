import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from database import BASE_DIR, app_environment


def safe_media_key(key: str) -> str:
    path = PurePosixPath(key)
    if not key or path.is_absolute() or ".." in path.parts:
        raise ValueError("Media object key must be a safe relative path.")
    return path.as_posix()


@dataclass(frozen=True)
class MediaObject:
    content: bytes
    content_type: str


class MediaStorage(ABC):
    @abstractmethod
    def put(self, key: str, content: bytes, content_type: str) -> None:
        raise NotImplementedError

    @abstractmethod
    def read(self, key: str) -> MediaObject:
        raise NotImplementedError


class LocalMediaStorage(MediaStorage):
    def __init__(self, root: Path | None = None):
        configured = os.environ.get("MEDIA_STORAGE_ROOT")
        self.root = (
            Path(configured).expanduser().resolve()
            if configured
            else (root or BASE_DIR / "data" / "media").resolve()
        )

    def _path(self, key: str) -> Path:
        return self.root / safe_media_key(key)

    def put(self, key: str, content: bytes, content_type: str) -> None:
        del content_type
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with path.open("xb") as stream:
                stream.write(content)
        except FileExistsError:
            if path.read_bytes() != content:
                raise ValueError(f"Media object already exists with different content: {key}")

    def read(self, key: str) -> MediaObject:
        return MediaObject(self._path(key).read_bytes(), "image/webp")


class GcsMediaStorage(MediaStorage):
    def __init__(self, bucket_name: str):
        if not bucket_name:
            raise RuntimeError("MEDIA_GCS_BUCKET is required for GCS media storage.")
        from google.cloud import storage

        self.bucket = storage.Client().bucket(bucket_name)

    def put(self, key: str, content: bytes, content_type: str) -> None:
        from google.api_core.exceptions import PreconditionFailed

        blob = self.bucket.blob(safe_media_key(key))
        try:
            blob.upload_from_string(
                content,
                content_type=content_type,
                if_generation_match=0,
                checksum="auto",
            )
        except PreconditionFailed as error:
            if blob.download_as_bytes() != content:
                raise ValueError(
                    f"Media object already exists with different content: {key}"
                ) from error

    def read(self, key: str) -> MediaObject:
        from google.api_core.exceptions import NotFound

        blob = self.bucket.blob(safe_media_key(key))
        try:
            content = blob.download_as_bytes()
        except NotFound as error:
            raise FileNotFoundError(key) from error
        if not blob.content_type:
            blob.reload()
        return MediaObject(content, blob.content_type or "application/octet-stream")


def get_media_storage() -> MediaStorage:
    provider = os.environ.get("MEDIA_STORAGE_PROVIDER", "local").strip().lower()
    if app_environment() in {"staging", "production"} and provider != "gcs":
        raise RuntimeError("Staging and production require MEDIA_STORAGE_PROVIDER=gcs.")
    if provider == "local":
        return LocalMediaStorage()
    if provider == "gcs":
        return GcsMediaStorage(os.environ.get("MEDIA_GCS_BUCKET", ""))
    raise RuntimeError("MEDIA_STORAGE_PROVIDER must be local or gcs.")
