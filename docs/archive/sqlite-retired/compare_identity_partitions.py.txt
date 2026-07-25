#!/usr/bin/env python3
"""Compare how two SQLite databases group player friend codes into identities."""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


def _players(database_path: Path) -> list[dict]:
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute("""
            SELECT p.player_id, p.canonical_lounge_name, p.primary_friend_code,
                   p.created_at
            FROM players p
            ORDER BY p.player_id
        """).fetchall()
        friend_codes_by_player: dict[int, list[str]] = {}
        for row in connection.execute("""
            SELECT player_id, friend_code
            FROM player_friend_codes
            ORDER BY player_id, friend_code
        """):
            friend_codes_by_player.setdefault(row["player_id"], []).append(row["friend_code"])
        return [
            {
                **dict(row),
                "friend_codes": friend_codes_by_player.get(row["player_id"], []),
            }
            for row in rows
        ]
    finally:
        connection.close()


def _record_summary(record: dict) -> dict:
    return {
        "player_id": record["player_id"],
        "canonical_lounge_name": record["canonical_lounge_name"],
        "primary_friend_code": record["primary_friend_code"],
        "friend_codes": record["friend_codes"],
    }


def compare(reference_path: Path, candidate_path: Path) -> dict:
    reference = _players(reference_path)
    candidate = _players(candidate_path)
    reference_by_code = {code: player for player in reference for code in player["friend_codes"]}
    candidate_by_code = {code: player for player in candidate for code in player["friend_codes"]}

    reference_merges = []
    for reference_player in reference:
        candidate_players = {
            candidate_by_code[code]["player_id"]: candidate_by_code[code]
            for code in reference_player["friend_codes"]
            if code in candidate_by_code
        }
        if len(candidate_players) > 1:
            reference_merges.append(
                {
                    "reference_player": _record_summary(reference_player),
                    "candidate_players": [
                        _record_summary(player)
                        for player in sorted(
                            candidate_players.values(), key=lambda item: item["player_id"]
                        )
                    ],
                }
            )

    candidate_merges = []
    for candidate_player in candidate:
        reference_players = {
            reference_by_code[code]["player_id"]: reference_by_code[code]
            for code in candidate_player["friend_codes"]
            if code in reference_by_code
        }
        if len(reference_players) > 1:
            candidate_merges.append(
                {
                    "candidate_player": _record_summary(candidate_player),
                    "reference_players": [
                        _record_summary(player)
                        for player in sorted(
                            reference_players.values(), key=lambda item: item["player_id"]
                        )
                    ],
                }
            )

    return {
        "reference": {
            "path": str(reference_path),
            "player_count": len(reference),
            "friend_code_count": len(reference_by_code),
        },
        "candidate": {
            "path": str(candidate_path),
            "player_count": len(candidate),
            "friend_code_count": len(candidate_by_code),
        },
        "reference_players_split_in_candidate": reference_merges,
        "candidate_players_split_in_reference": candidate_merges,
        "friend_codes_only_in_reference": sorted(set(reference_by_code) - set(candidate_by_code)),
        "friend_codes_only_in_candidate": sorted(set(candidate_by_code) - set(reference_by_code)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare player identity groupings between two SQLite databases."
    )
    parser.add_argument("reference", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--output", type=Path, help="Optional JSON output path.")
    args = parser.parse_args()
    content = (
        json.dumps(
            compare(args.reference, args.candidate),
            indent=2,
            ensure_ascii=False,
        )
        + "\n"
    )
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content, encoding="utf-8")
    else:
        print(content, end="")


if __name__ == "__main__":
    main()
