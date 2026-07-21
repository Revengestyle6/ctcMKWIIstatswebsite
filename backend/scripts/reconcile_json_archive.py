import argparse
import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from database import get_session_factory
from match_upload import reconcile_archive


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare archived match JSON files with source_files rows."
    )
    parser.add_argument(
        "--database-url", help="PostgreSQL URL; defaults to the DATABASE_URL environment variable."
    )
    parser.add_argument("--json-root", type=Path, help="Override the JSON archive root.")
    args = parser.parse_args()

    with get_session_factory(args.database_url)() as session:
        report = reconcile_archive(session, args.json_root)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if any(report.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
