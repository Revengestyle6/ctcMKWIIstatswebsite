#!/usr/bin/env python3
"""Compare current read-only API responses with the approved Phase 0 fixtures."""

from __future__ import annotations

import difflib

from capture_phase0_baseline import (
    API_OUTPUT_DIR,
    ENDPOINTS,
    _canonical_json,
    _sanitize_dynamic_health_fields,
    app,
)


def main() -> None:
    client = app.test_client()
    failures = 0

    for name, endpoint in ENDPOINTS.items():
        response = client.get(endpoint)
        payload = response.get_json(silent=True)
        if response.status_code != 200:
            failures += 1
            print(f"FAIL {name}: HTTP {response.status_code}")
            continue
        if name == "database-health-no-archive":
            payload = _sanitize_dynamic_health_fields(payload)

        current = _canonical_json(payload)
        fixture_path = API_OUTPUT_DIR / f"{name}.json"
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
    print(f"All {len(ENDPOINTS)} Phase 0 API fixtures match.")


if __name__ == "__main__":
    main()
