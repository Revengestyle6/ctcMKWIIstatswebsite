#!/usr/bin/env python3
"""Capture read-only API and database baselines for the production-readiness refactor."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import func, select, text

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = BACKEND_DIR.parent
OUTPUT_DIR = REPOSITORY_ROOT / "docs" / "baselines" / "phase-0-2026-07-19"
API_OUTPUT_DIR = OUTPUT_DIR / "api"

# A deliberate baseline capture must always describe the repository's local
# development database. Importers such as compare_phase0_api.py may intentionally
# target another configured database, so preserve their environment.
if __name__ == "__main__":
    os.environ.pop("DATABASE_URL", None)
sys.path.insert(0, str(BACKEND_DIR))

from app import app  # noqa: E402
from database import DEFAULT_DB_PATH  # noqa: E402
from database_health import build_database_health  # noqa: E402
from models import Base  # noqa: E402
from stats_db import SessionLocal  # noqa: E402

ENDPOINTS = {
    "seasons": "/api/seasons",
    "match-scopes": "/api/match-scopes",
    "team-scopes": "/api/team-scopes",
    "divisions-s3": "/api/divisions?season=s3",
    "teams-s3-d1": "/api/teams?season=s3&division=d1",
    "players-s3-d1": "/api/players?season=s3&division=d1",
    "tracks-s3-d1": "/api/tracks?season=s3&division=d1",
    "matches-s3-d1": "/api/matches?season=s3&division=d1",
    "match-222": "/api/matches/222",
    "player-180-overview-runner": ("/api/players/180/overview?season=s3&division=d1&role=runner"),
    "player-180-performance-runner": (
        "/api/players/180/performance?season=s3&division=d1&role=runner"
    ),
    "player-180-tracks-runner": (
        "/api/players/180/tracks?season=s3&division=d1&role=runner&min_races=2"
    ),
    "team-41-overview": "/api/teams/41/overview?season=s3&division=d1",
    "team-41-roster-runner": ("/api/teams/41/roster?season=s3&division=d1&role=runner&min_races=2"),
    "team-41-tracks": ("/api/teams/41/tracks?season=s3&division=d1&min_races=2"),
    "top-tracks-glimmer-express-trains-runner": (
        "/api/top-tracks?track=Glimmer%20Express%20Trains&season=s3&division=d1"
        "&role=runner&min_races=2"
    ),
    "database-health-no-archive": "/api/database-health?include_archive=0",
}


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def _write_json(path: Path, value: Any) -> dict[str, Any]:
    content = _canonical_json(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return {
        "path": path.relative_to(REPOSITORY_ROOT).as_posix(),
        "bytes": len(content.encode("utf-8")),
        "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
    }


def _existing_file_entry(path: Path) -> dict[str, Any]:
    content = path.read_bytes()
    return {
        "path": path.relative_to(REPOSITORY_ROOT).as_posix(),
        "bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }


def _sanitize_dynamic_health_fields(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    sanitized = dict(payload)
    if "generated_at" in sanitized:
        sanitized["generated_at"] = "<capture-time>"
    database = sanitized.get("database")
    if isinstance(database, dict):
        sanitized["database"] = {**database, "path": "<local-database-path>"}
    return sanitized


def _git_value(*args: str) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def _archive_fingerprint() -> dict[str, Any]:
    archive_root = BACKEND_DIR / "JSON"
    digest = hashlib.sha256()
    files = sorted(path for path in archive_root.rglob("*.json") if path.is_file())
    total_bytes = 0
    for path in files:
        relative_path = path.relative_to(archive_root).as_posix()
        content = path.read_bytes()
        total_bytes += len(content)
        digest.update(relative_path.encode("utf-8"))
        digest.update(b"\0")
        digest.update(hashlib.sha256(content).digest())
    return {
        "root": "backend/JSON",
        "json_file_count": len(files),
        "total_bytes": total_bytes,
        "tree_sha256": digest.hexdigest(),
    }


def _registry_fingerprints() -> list[dict[str, Any]]:
    paths = [
        BACKEND_DIR / "data" / "analytics_excluded_race_blocks.json",
        BACKEND_DIR / "data" / "database_health_reviews.json",
        BACKEND_DIR / "data" / "player_identities.csv",
        BACKEND_DIR / "data" / "team_aliases.csv",
    ]
    results = []
    for path in paths:
        content = path.read_bytes()
        results.append(
            {
                "path": path.relative_to(REPOSITORY_ROOT).as_posix(),
                "bytes": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        )
    return results


def _database_snapshot() -> dict[str, Any]:
    with SessionLocal() as session:
        table_counts = {
            table.name: session.scalar(select(func.count()).select_from(table)) or 0
            for table in Base.metadata.sorted_tables
        }
        sqlite_version = session.scalar(text("select sqlite_version()"))
        integrity_check = list(session.scalars(text("PRAGMA integrity_check")))
        foreign_key_violations = [
            list(row) for row in session.execute(text("PRAGMA foreign_key_check"))
        ]
        health = build_database_health(session, include_archive=False)

    issue_severities = Counter(issue["severity"] for issue in health["issues"])
    issue_categories = Counter(issue["category"] for issue in health["issues"])
    return {
        "database": {
            "path": "backend/data/ctc_stats.sqlite",
            "size_bytes": DEFAULT_DB_PATH.stat().st_size,
            "sqlite_version": sqlite_version,
        },
        "integrity_check": integrity_check,
        "foreign_key_violations": foreign_key_violations,
        "table_counts": table_counts,
        "health": {
            "status": health["status"],
            "summary": health["summary"],
            "issue_count_by_severity": dict(sorted(issue_severities.items())),
            "issue_count_by_category": dict(sorted(issue_categories.items())),
            "issue_keys": sorted(issue["key"] for issue in health["issues"]),
        },
        "archive": _archive_fingerprint(),
        "registries": _registry_fingerprints(),
    }


def main() -> None:
    captured_at = datetime.now(timezone.utc).isoformat()
    manifest_entries = []
    client = app.test_client()

    for name, endpoint in ENDPOINTS.items():
        response = client.get(endpoint)
        payload = response.get_json(silent=True)
        if response.status_code != 200:
            raise RuntimeError(
                f"Baseline endpoint {endpoint} returned {response.status_code}: {payload!r}"
            )
        if name == "database-health-no-archive":
            payload = _sanitize_dynamic_health_fields(payload)
        entry = _write_json(API_OUTPUT_DIR / f"{name}.json", payload)
        manifest_entries.append(
            {
                **entry,
                "endpoint": endpoint,
                "status": response.status_code,
            }
        )

    database_entry = _write_json(OUTPUT_DIR / "database-summary.json", _database_snapshot())
    manifest_entries.append(database_entry)
    for comparison_name in (
        "identity-rebuild-comparison.json",
        "identity-rebuild-resolved.json",
    ):
        identity_comparison = OUTPUT_DIR / comparison_name
        if identity_comparison.exists():
            manifest_entries.append(_existing_file_entry(identity_comparison))
    ui_output_dir = OUTPUT_DIR / "ui"
    if ui_output_dir.exists():
        manifest_entries.extend(
            _existing_file_entry(path) for path in sorted(ui_output_dir.glob("*.jpg"))
        )

    manifest = {
        "baseline": "production-readiness-phase-0",
        "captured_at": captured_at,
        "git": {
            "branch": _git_value("branch", "--show-current"),
            "commit": _git_value("rev-parse", "HEAD"),
        },
        "local_database": "backend/data/ctc_stats.sqlite",
        "artifacts": manifest_entries,
    }
    _write_json(OUTPUT_DIR / "manifest.json", manifest)
    print(f"Captured {len(ENDPOINTS)} API fixtures and database summary in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
