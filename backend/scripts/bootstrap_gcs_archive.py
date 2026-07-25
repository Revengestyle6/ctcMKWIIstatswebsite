#!/usr/bin/env python3
import argparse
import sys
import tempfile
from pathlib import Path, PurePosixPath

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from archive_storage import GcsArchiveStorage
from bootstrap_archive import archive_imported_sources
from database import get_session_factory
from import_json_to_db import import_json_tree


def download_bootstrap_tree(bucket_name: str, prefix: str, json_root: Path) -> int:
    from google.cloud import storage

    normalized_prefix = prefix.strip("/") + "/"
    downloaded = 0
    for blob in storage.Client().list_blobs(bucket_name, prefix=normalized_prefix):
        relative_name = blob.name.removeprefix(normalized_prefix)
        relative_path = PurePosixPath(relative_name)
        if not relative_name or relative_path.is_absolute() or ".." in relative_path.parts:
            continue
        destination = json_root.joinpath(*relative_path.parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        blob.download_to_filename(destination)
        downloaded += 1
    return downloaded


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Rebuild a migrated PostgreSQL database from a temporary GCS JSON prefix, "
            "then promote every imported source into the immutable accepted archive."
        )
    )
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--source-prefix", default="bootstrap/JSON")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="ctc-gcs-bootstrap-") as temporary_directory:
        json_root = Path(temporary_directory) / "JSON"
        downloaded = download_bootstrap_tree(args.bucket, args.source_prefix, json_root)
        if downloaded == 0:
            raise RuntimeError("The bootstrap prefix contains no JSON source objects.")

        imported = import_json_tree(None, json_root)
        archived, failed = archive_imported_sources(
            get_session_factory(), GcsArchiveStorage(args.bucket), json_root
        )
        print(
            f"bootstrap_downloaded={downloaded} imported_matches={imported} "
            f"archived_sources={archived} archive_failures={failed}"
        )
        if failed:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
