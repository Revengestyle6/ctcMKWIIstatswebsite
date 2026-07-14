import argparse
import json
from pathlib import Path

from database import DEFAULT_DB_PATH, get_session_factory, init_database
from match_upload import reconcile_archive


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare archived match JSON files with source_files rows.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="SQLite database path.")
    parser.add_argument("--json-root", type=Path, help="Override the JSON archive root.")
    args = parser.parse_args()

    init_database(args.db)
    with get_session_factory(args.db)() as session:
        report = reconcile_archive(session, args.json_root)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if any(report.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
