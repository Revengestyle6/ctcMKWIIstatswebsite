import json
from functools import lru_cache
from pathlib import Path

from sqlalchemy import select

from models import Match, Race, SourceFile


DEFAULT_EXCLUSION_PATH = Path(__file__).resolve().parent / "data" / "analytics_excluded_race_blocks.json"
RACES_PER_BLOCK = 4


@lru_cache(maxsize=1)
def _load_default_exclusions():
    return _load_exclusions(DEFAULT_EXCLUSION_PATH)


def _load_exclusions(path):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    entries = payload.get("exclusions", []) if isinstance(payload, dict) else []
    if not isinstance(entries, list):
        raise ValueError("Analytics exclusions must be a list.")
    normalized = []
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("source_path"), str):
            raise ValueError("Each analytics exclusion requires a source_path.")
        blocks = entry.get("blocks")
        if not isinstance(blocks, list) or not blocks or any(
            isinstance(block, bool) or not isinstance(block, int) or block < 1
            for block in blocks
        ):
            raise ValueError("Each analytics exclusion requires positive integer blocks.")
        normalized.append({
            "source_path": entry["source_path"],
            "match_index": int(entry.get("match_index", 0)),
            "blocks": frozenset(blocks),
            "reason": str(entry.get("reason") or "Reviewed legacy source corruption."),
        })
    return tuple(normalized)


def analytics_excluded_race_ids(session, exclusions=None):
    """Return reviewed legacy races that must not feed race-derived analytics."""
    entries = tuple(exclusions) if exclusions is not None else _load_default_exclusions()
    if not entries:
        return set()
    entries_by_source = {}
    for entry in entries:
        entries_by_source.setdefault(entry["source_path"], []).append(entry)

    rows = session.execute(
        select(
            Race.race_id,
            Race.race_number,
            Match.match_index_in_source,
            SourceFile.source_path,
        )
        .join(Match, Match.match_id == Race.match_id)
        .join(SourceFile, SourceFile.source_file_id == Match.source_file_id)
        .where(SourceFile.source_path.in_(entries_by_source))
    ).all()
    excluded_ids = set()
    for race_id, race_number, match_index, source_path in rows:
        block_number = ((race_number - 1) // RACES_PER_BLOCK) + 1
        if any(
            entry["match_index"] == match_index and block_number in entry["blocks"]
            for entry in entries_by_source[source_path]
        ):
            excluded_ids.add(race_id)
    return excluded_ids


def apply_analytics_race_filter(statement, session, race_id_column=Race.race_id):
    excluded_ids = analytics_excluded_race_ids(session)
    return statement.where(race_id_column.not_in(excluded_ids)) if excluded_ids else statement
