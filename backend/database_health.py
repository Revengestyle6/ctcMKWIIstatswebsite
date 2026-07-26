import json
import re
import unicodedata
from datetime import datetime, timezone
from difflib import SequenceMatcher

from analytics_eligibility import analytics_excluded_race_ids
from database import Base
from database_health_reviews import load_reviews
from match_upload import reconcile_archive, serialize_addition_log
from models import DatabaseAdditionLog, Match, Player, SourceFile, Track
from sqlalchemy import func, inspect, select, text

TRACK_SIMILARITY_THRESHOLD = 0.92
MAX_ISSUE_ENTITIES = 20


def _iso(value):
    return value.isoformat() if value else None


def _normalized_name(value):
    normalized = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return re.sub(r"[^a-z0-9]+", "", normalized)


def _issue(key, severity, category, title, detail, *, count=1, entities=None, dismissible=False):
    return {
        "key": key,
        "severity": severity,
        "category": category,
        "title": title,
        "detail": detail,
        "count": count,
        "entities": (entities or [])[:MAX_ISSUE_ENTITIES],
        "dismissible": dismissible,
    }


def _database_details(session):
    bind = session.get_bind()
    backend = bind.dialect.name
    schema_revision = None
    if inspect(session.connection()).has_table("alembic_version"):
        schema_revision = session.scalar(text("SELECT version_num FROM alembic_version LIMIT 1"))

    if backend != "postgresql":
        raise RuntimeError(f"Unsupported database backend: {backend}")
    return {
        "backend": backend,
        "name": session.scalar(text("SELECT current_database()")),
        "version": session.scalar(text("SELECT current_setting('server_version')")),
        "size_bytes": session.scalar(text("SELECT pg_database_size(current_database())")),
        "connection_status": "ok",
        "schema_revision": schema_revision,
    }


def _database_integrity(session):
    backend = session.get_bind().dialect.name
    if backend == "postgresql":
        constraint_rows = (
            session.execute(
                text("""
                    SELECT c.conname AS constraint_name,
                           c.convalidated AS is_validated,
                           c.conrelid::regclass::text AS table_name
                    FROM pg_constraint c
                    WHERE c.contype = 'f'
                      AND c.connamespace = (
                          SELECT oid FROM pg_namespace WHERE nspname = current_schema()
                      )
                    ORDER BY c.conrelid::regclass::text, c.conname
                """)
            )
            .mappings()
            .all()
        )
        unvalidated = [row for row in constraint_rows if not row["is_validated"]]
        return (
            {
                "physical": {
                    "status": "not_run",
                    "method": "Scheduled amcheck (pending Cloud SQL deployment)",
                },
                "foreign_keys": {
                    "status": "ok" if not unvalidated else "failed",
                    "constraints": len(constraint_rows),
                    "validated": len(constraint_rows) - len(unvalidated),
                    "unvalidated": len(unvalidated),
                    "violations": None,
                },
            },
            [],
            [],
            unvalidated,
        )

    raise RuntimeError(f"Unsupported database backend: {backend}")


def _table_counts(session):
    return {
        table.name: session.scalar(select(func.count()).select_from(table)) or 0
        for table in Base.metadata.sorted_tables
    }


def _addition_data(session, limit):
    rows = session.scalars(
        select(DatabaseAdditionLog)
        .order_by(DatabaseAdditionLog.addition_log_id.desc())
        .limit(limit)
    ).all()
    by_type = dict(
        session.execute(
            select(DatabaseAdditionLog.entity_type, func.count())
            .group_by(DatabaseAdditionLog.entity_type)
            .order_by(func.count().desc())
        ).all()
    )
    return {
        "total": sum(by_type.values()),
        "by_entity_type": by_type,
        "recent": [serialize_addition_log(row) for row in rows],
    }


def _catalog_issues(session):
    issues = []

    tracks = list(session.execute(select(Track.track_id, Track.canonical_name)).all())
    tracks_by_key = {}
    for track_id, name in tracks:
        tracks_by_key.setdefault(_normalized_name(name), []).append((track_id, name))
    for name_key, group in tracks_by_key.items():
        if name_key and len(group) > 1:
            issues.append(
                _issue(
                    f"duplicate-track:{name_key}",
                    "warning",
                    "tracks",
                    "Duplicate normalized track names",
                    "These canonical track names differ only by case, spacing, punctuation, or Unicode formatting.",
                    count=len(group),
                    entities=[{"id": track_id, "label": name} for track_id, name in group],
                    dismissible=True,
                )
            )

    unique_tracks = [(track_id, name, _normalized_name(name)) for track_id, name in tracks]
    fuzzy_candidates = []
    for index, (left_id, left_name, left_key) in enumerate(unique_tracks):
        if len(left_key) < 5:
            continue
        for right_id, right_name, right_key in unique_tracks[index + 1 :]:
            if len(right_key) < 5 or left_key == right_key:
                continue
            ratio = SequenceMatcher(None, left_key, right_key).ratio()
            if ratio >= TRACK_SIMILARITY_THRESHOLD:
                fuzzy_candidates.append((ratio, left_id, left_name, right_id, right_name))
    for ratio, left_id, left_name, right_id, right_name in sorted(fuzzy_candidates, reverse=True)[
        :25
    ]:
        stable_names = sorted((_normalized_name(left_name), _normalized_name(right_name)))
        issues.append(
            _issue(
                f"similar-track:{stable_names[0]}:{stable_names[1]}",
                "warning",
                "tracks",
                "Similar canonical track names",
                f"Potential typo or unregistered alias ({round(ratio * 100, 1)}% similarity).",
                count=2,
                entities=[
                    {"id": left_id, "label": left_name},
                    {"id": right_id, "label": right_name},
                ],
                dismissible=True,
            )
        )

    players = list(session.execute(select(Player.player_id, Player.canonical_name)).all())
    player_name_by_id = {player_id: name for player_id, name in players}
    players_by_key = {}
    for player_id, name in players:
        name_key = _normalized_name(name)
        if name_key:
            players_by_key.setdefault(name_key, []).append((player_id, name))
    for name_key, group in players_by_key.items():
        if len(group) > 1:
            issues.append(
                _issue(
                    f"duplicate-player-name:{name_key}",
                    "warning",
                    "players",
                    "Duplicate canonical player names",
                    "The same normalized canonical name belongs to multiple player IDs. Review friend codes and match history before merging.",
                    count=len(group),
                    entities=[{"id": player_id, "label": name} for player_id, name in group],
                    dismissible=True,
                )
            )

    alias_rows = (
        session.execute(
            text("""
        WITH alias_appearances AS (
            SELECT m.season_id, m.division_id, mp.player_id,
                   'lounge_name' AS alias_type,
                   lower(trim(mp.lounge_name_raw)) AS alias_key
            FROM match_players mp
            JOIN match_teams mt ON mt.match_team_id = mp.match_team_id
            JOIN matches m ON m.match_id = mt.match_id
            WHERE trim(coalesce(mp.lounge_name_raw, '')) != ''

            UNION ALL

            SELECT m.season_id, m.division_id, mp.player_id,
                   'mii_name' AS alias_type,
                   lower(trim(mp.mii_name_raw)) AS alias_key
            FROM match_players mp
            JOIN match_teams mt ON mt.match_team_id = mp.match_team_id
            JOIN matches m ON m.match_id = mt.match_id
            WHERE trim(coalesce(mp.mii_name_raw, '')) != ''

            UNION ALL

            SELECT m.season_id, m.division_id, mp.player_id,
                   'table_name' AS alias_type,
                   lower(trim(mp.table_name_raw)) AS alias_key
            FROM match_players mp
            JOIN match_teams mt ON mt.match_team_id = mp.match_team_id
            JOIN matches m ON m.match_id = mt.match_id
            WHERE trim(coalesce(mp.table_name_raw, '')) != ''
        )
        SELECT DISTINCT s.season_code, d.division_code, aa.alias_type, aa.alias_key,
               aa.player_id
        FROM alias_appearances aa
        JOIN seasons s ON s.season_id = aa.season_id
        JOIN divisions d ON d.division_id = aa.division_id
        ORDER BY s.season_code, d.division_code, aa.alias_type, aa.alias_key, aa.player_id
    """)
        )
        .mappings()
        .all()
    )
    collisions = {}
    for row in alias_rows:
        key = (
            row["season_code"],
            row["division_code"],
            row["alias_type"],
            row["alias_key"],
        )
        collisions.setdefault(key, []).append(int(row["player_id"]))
    ranked_collisions = sorted(
        ((key, player_ids) for key, player_ids in collisions.items() if len(player_ids) > 1),
        key=lambda item: (-len(item[1]), item[0][3]),
    )[:100]
    for (season_code, division_code, alias_type, alias_key), player_ids in ranked_collisions:
        alias_type_label = str(alias_type).replace("_", " ").title()
        issues.append(
            _issue(
                f"player-alias-collision:{season_code}:{division_code}:{alias_type}:{alias_key}",
                "warning",
                "players",
                "Player alias collision",
                f"{alias_type_label} alias “{alias_key}” maps to multiple players in "
                f"{season_code.upper()} {division_code.upper()}.",
                count=len(player_ids),
                entities=[
                    {
                        "id": player_id,
                        "label": player_name_by_id.get(player_id) or f"Player {player_id}",
                    }
                    for player_id in player_ids
                ],
                dismissible=True,
            )
        )
    return issues


def _match_and_result_issues(session):
    issues = []
    analytics_excluded_ids = analytics_excluded_race_ids(session)
    checks = (
        (
            "non-two-team-match",
            "critical",
            "matches",
            "Team match does not contain two teams",
            """
                SELECT m.match_id AS id, m.match_label AS label, count(mt.match_team_id) AS value
                FROM matches m LEFT JOIN match_teams mt ON mt.match_id = m.match_id
                GROUP BY m.match_id HAVING count(mt.match_team_id) != 2
            """,
            "Expected exactly two match-team rows.",
        ),
        (
            "race-count-mismatch",
            "critical",
            "matches",
            "Stored race count does not match the match",
            """
                SELECT m.match_id AS id, m.match_label AS label, count(r.race_id) AS value
                FROM matches m LEFT JOIN races r ON r.match_id = m.match_id
                GROUP BY m.match_id HAVING count(r.race_id) != m.races_played
            """,
            "The number of race rows differs from matches.races_played.",
        ),
        (
            "duplicate-race-position",
            "critical",
            "results",
            "Duplicate placement in a race",
            """
                SELECT rpr.race_id AS id,
                       m.match_label || ' · race ' || r.race_number || ' · position ' || rpr.position AS label,
                       count(*) AS value
                FROM race_player_results rpr
                JOIN races r ON r.race_id = rpr.race_id
                JOIN matches m ON m.match_id = r.match_id
                WHERE rpr.position IS NOT NULL
                GROUP BY rpr.race_id, rpr.position, m.match_label, r.race_number
                HAVING count(*) > 1
            """,
            "A placement is assigned to more than one player in the same race.",
        ),
        (
            "invalid-result-value",
            "critical",
            "results",
            "Invalid score or placement",
            """
                SELECT rpr.race_player_result_id AS id, rpr.race_id,
                       m.match_label || ' · race ' || r.race_number || ' · ' ||
                       coalesce(p.canonical_name, 'Player ' || rpr.player_id) AS label,
                       'score=' || coalesce(CAST(rpr.score AS TEXT), 'null') ||
                       ', position=' || coalesce(CAST(rpr.position AS TEXT), 'null') AS value
                FROM race_player_results rpr
                JOIN races r ON r.race_id = rpr.race_id
                JOIN matches m ON m.match_id = r.match_id
                JOIN players p ON p.player_id = rpr.player_id
                WHERE (rpr.score IS NOT NULL AND (rpr.score < 0 OR rpr.score > 15))
                   OR (rpr.position IS NOT NULL AND (rpr.position < 1 OR rpr.position > 12))
            """,
            "Scores must be 0–15 and placements must be 1–12 when present.",
        ),
        (
            "inferred-role-mismatch",
            "critical",
            "results",
            "Inferred role disagrees with placement",
            """
                SELECT rpr.race_player_result_id AS id, rpr.race_id,
                       m.match_label || ' · race ' || r.race_number || ' · ' ||
                       coalesce(p.canonical_name, 'Player ' || rpr.player_id) AS label,
                       'position=' || rpr.position || ', role=' || rpr.role AS value
                FROM race_player_results rpr
                JOIN races r ON r.race_id = rpr.race_id
                JOIN matches m ON m.match_id = r.match_id
                JOIN players p ON p.player_id = rpr.player_id
                WHERE rpr.role_source = 'inferred' AND rpr.position BETWEEN 1 AND 10
                  AND rpr.role != CASE WHEN rpr.position >= 9 THEN 'bagger' ELSE 'runner' END
            """,
            "Non-manual roles should infer bagger for 9th/10th and runner for 1st–8th.",
        ),
        (
            "match-needs-review",
            "warning",
            "matches",
            "Match needs review",
            """
                SELECT match_id AS id, match_label AS label, 1 AS value
                FROM matches WHERE import_status = 'needs_review'
            """,
            "The importer marked this match for manual review.",
        ),
        (
            "unplaced-scored-result",
            "info",
            "results",
            "Scored result without a placement",
            """
                SELECT rpr.race_player_result_id AS id, rpr.race_id,
                       m.match_label || ' · race ' || r.race_number || ' · ' ||
                       coalesce(p.canonical_name, 'Player ' || rpr.player_id) AS label,
                       'score=' || rpr.score AS value
                FROM race_player_results rpr
                JOIN races r ON r.race_id = rpr.race_id
                JOIN matches m ON m.match_id = r.match_id
                JOIN players p ON p.player_id = rpr.player_id
                WHERE rpr.score IS NOT NULL AND rpr.position IS NULL
            """,
            "This can represent a disconnect, but should remain visible for audit.",
        ),
    )
    for key, severity, category, title, query, detail in checks:
        rows = session.execute(text(query)).mappings().all()
        if key == "invalid-result-value":
            contained_rows = [row for row in rows if row["race_id"] in analytics_excluded_ids]
            rows = [row for row in rows if row["race_id"] not in analytics_excluded_ids]
            if contained_rows:
                issues.append(
                    _issue(
                        "analytics-excluded-invalid-result",
                        "warning",
                        "results",
                        "Reviewed legacy result excluded from analytics",
                        "These raw scores or placements remain invalid for audit, but their complete "
                        "reviewed race blocks are excluded from all race-derived analytics.",
                        count=len(contained_rows),
                        entities=[
                            {
                                "id": row["id"],
                                "label": row["label"],
                                "value": row["value"],
                            }
                            for row in contained_rows
                        ],
                    )
                )
        elif key == "unplaced-scored-result":
            rows = [row for row in rows if row["race_id"] not in analytics_excluded_ids]
        if rows:
            issues.append(
                _issue(
                    key,
                    severity,
                    category,
                    title,
                    detail,
                    count=len(rows),
                    entities=[
                        {"id": row["id"], "label": row["label"], "value": row["value"]}
                        for row in rows
                    ],
                )
            )
    return issues


def build_database_health(
    session,
    *,
    archive_root=None,
    include_archive=True,
    addition_limit=100,
    review_path=None,
):
    generated_at = datetime.now(timezone.utc)
    database = _database_details(session)
    integrity, integrity_rows, foreign_key_rows, unvalidated_constraints = _database_integrity(
        session
    )
    counts = _table_counts(session)
    additions = _addition_data(session, addition_limit)
    issues = []

    if foreign_key_rows:
        issues.append(
            _issue(
                "foreign-key-violations",
                "critical",
                "database",
                "Foreign-key violations",
                "One or more records reference missing parent rows.",
                count=len(foreign_key_rows),
                entities=[
                    {"id": row[1], "label": str(row[0]), "value": row[2]}
                    for row in foreign_key_rows
                ],
            )
        )
    if unvalidated_constraints:
        issues.append(
            _issue(
                "postgres-unvalidated-foreign-keys",
                "critical",
                "database",
                "PostgreSQL foreign-key constraints are not validated",
                "Existing rows have not been verified against one or more foreign-key constraints.",
                count=len(unvalidated_constraints),
                entities=[
                    {
                        "id": None,
                        "label": f"{row['table_name']}.{row['constraint_name']}",
                    }
                    for row in unvalidated_constraints
                ],
            )
        )

    issues.extend(_catalog_issues(session))
    issues.extend(_match_and_result_issues(session))

    archive = {"status": "skipped", "missing_files": [], "hash_mismatches": [], "orphan_files": []}
    if include_archive:
        report = reconcile_archive(session, archive_root)
        archive = {"status": "ok" if not any(report.values()) else "warning", **report}
        labels = {
            "missing_files": "Archived source files are missing",
            "hash_mismatches": "Archived source hashes do not match",
            "orphan_files": "Archive files are not imported",
        }
        for key, title in labels.items():
            if report[key]:
                issues.append(
                    _issue(
                        f"archive-{key}",
                        "warning",
                        "archive",
                        title,
                        "The JSON archive and source_files table are out of sync.",
                        count=len(report[key]),
                        entities=[
                            {"id": None, "label": json.dumps(item, ensure_ascii=False)}
                            for item in report[key]
                        ],
                    )
                )

    reviews = load_reviews(review_path, session=None if review_path else session)
    for issue in issues:
        review = reviews.get(issue["key"])
        issue["review"] = review if isinstance(review, dict) else None
        issue["is_dismissed"] = bool(
            issue["dismissible"]
            and isinstance(review, dict)
            and review.get("status") == "dismissed"
        )

    severity_order = {"critical": 0, "warning": 1, "info": 2}
    issues.sort(
        key=lambda issue: (severity_order[issue["severity"]], issue["category"], issue["title"])
    )
    active_issues = [issue for issue in issues if not issue["is_dismissed"]]
    critical_count = sum(
        issue["count"] for issue in active_issues if issue["severity"] == "critical"
    )
    warning_count = sum(issue["count"] for issue in active_issues if issue["severity"] == "warning")
    status = "critical" if critical_count else "warning" if warning_count else "healthy"

    latest_import = session.scalar(select(func.max(SourceFile.imported_at)))
    latest_addition = session.scalar(select(func.max(DatabaseAdditionLog.created_at)))
    review_count = (
        session.scalar(
            select(func.count()).select_from(Match).where(Match.import_status == "needs_review")
        )
        or 0
    )
    return {
        "generated_at": generated_at.isoformat(),
        "status": status,
        "database": {
            **database,
            "integrity": integrity,
            "latest_import_at": _iso(latest_import),
            "latest_addition_at": _iso(latest_addition),
        },
        "summary": {
            "critical": critical_count,
            "warnings": warning_count,
            "informational": sum(
                issue["count"] for issue in active_issues if issue["severity"] == "info"
            ),
            "dismissed": sum(1 for issue in issues if issue["is_dismissed"]),
            "matches_needing_review": review_count,
            "total_records": sum(counts.values()),
        },
        "counts": counts,
        "additions": additions,
        "archive": archive,
        "issues": issues,
    }
