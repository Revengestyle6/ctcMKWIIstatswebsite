#!/usr/bin/env python3
import argparse

from archive_storage import get_archive_storage
from database import get_session_factory
from phase3_maintenance import expire_review_submissions, repair_accepted_archives


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Expire review items and repair accepted archives."
    )
    parser.add_argument("--skip-expiry", action="store_true")
    parser.add_argument("--skip-repair", action="store_true")
    args = parser.parse_args()

    storage = get_archive_storage()
    session_factory = get_session_factory()
    expired = 0
    repaired = 0
    failed = 0
    if not args.skip_expiry:
        with session_factory.begin() as session:
            expired = expire_review_submissions(session, storage)
    if not args.skip_repair:
        repaired, failed = repair_accepted_archives(session_factory, storage)
    print(f"expired={expired} repaired={repaired} repair_failed={failed}")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
