#!/usr/bin/env python3
"""Compare current read-only API responses with the approved Phase 0 fixtures."""

from __future__ import annotations

import difflib
from argparse import ArgumentParser
from pathlib import Path

from capture_phase0_baseline import (
    API_OUTPUT_DIR,
    ENDPOINTS,
    _canonical_json,
    _sanitize_dynamic_health_fields,
    app,
)


def main() -> None:
    parser = ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skip-database-health",
        action="store_true",
        help="Skip the SQLite-specific Phase 0 health fixture during PostgreSQL checks.",
    )
    parser.add_argument(
        "--fixture-dir",
        type=Path,
        default=API_OUTPUT_DIR,
        help="Directory containing expected endpoint JSON files.",
    )
    parser.add_argument(
        "--write-current",
        type=Path,
        help="Write current responses here instead of comparing them.",
    )
    parser.add_argument(
        "--only",
        help="Comma-separated endpoint fixture names to compare or write.",
    )
    args = parser.parse_args()
    selected_names = set(args.only.split(",")) if args.only else set(ENDPOINTS)
    unknown_names = selected_names.difference(ENDPOINTS)
    if unknown_names:
        parser.error(f"Unknown endpoint fixture(s): {', '.join(sorted(unknown_names))}")
    if args.write_current:
        args.write_current.mkdir(parents=True, exist_ok=True)

    client = app.test_client()
    failures = 0
    compared = 0

    for name, endpoint in ENDPOINTS.items():
        if name not in selected_names:
            continue
        if args.skip_database_health and name == "database-health-no-archive":
            continue
        compared += 1
        response = client.get(endpoint)
        payload = response.get_json(silent=True)
        if response.status_code != 200:
            failures += 1
            print(f"FAIL {name}: HTTP {response.status_code}")
            continue
        if name == "database-health-no-archive":
            payload = _sanitize_dynamic_health_fields(payload)

        current = _canonical_json(payload)
        if args.write_current:
            output_path = args.write_current / f"{name}.json"
            output_path.write_text(current, encoding="utf-8")
            print(f"WROTE {name}")
            continue

        fixture_path = args.fixture_dir / f"{name}.json"
        expected = fixture_path.read_text(encoding="utf-8")
        if current == expected:
            print(f"PASS {name}")
            continue

        failures += 1
        print(f"FAIL {name}: response differs from {fixture_path}")
        print(
            "".join(
                difflib.unified_diff(
                    expected.splitlines(keepends=True),
                    current.splitlines(keepends=True),
                    fromfile=str(fixture_path),
                    tofile=f"current:{endpoint}",
                    n=3,
                )
            ),
            end="",
        )

    if failures:
        raise SystemExit(f"{failures} Phase 0 API fixture comparison(s) failed")
    action = "written" if args.write_current else "match"
    print(f"All {compared} selected API fixtures {action}.")


if __name__ == "__main__":
    main()
