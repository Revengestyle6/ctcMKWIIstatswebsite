import argparse
import csv
import shutil
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from database import BASE_DIR, DEFAULT_DB_PATH

IDENTITY_PATH = BASE_DIR / "data" / "player_identities.csv"


def load_identity_groups(path: Path):
    groups = defaultdict(lambda: {"friend_codes": set(), "canonical_lounge_name": ""})
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            canonical_friend_code = (row.get("canonical_friend_code") or "").strip()
            friend_code = (row.get("friend_code") or "").strip()
            canonical_lounge_name = (row.get("canonical_lounge_name") or "").strip()
            if not canonical_friend_code or not friend_code:
                continue

            group = groups[canonical_friend_code]
            group["friend_codes"].update({canonical_friend_code, friend_code})
            if canonical_lounge_name:
                group["canonical_lounge_name"] = canonical_lounge_name
    return groups


def scalar(conn, sql, params=()):
    return conn.execute(sql, params).fetchone()


def merge_alias(conn, keep_player_id, merge_player_id):
    rows = conn.execute(
        """
        SELECT player_alias_id, alias_type, alias_value, first_seen_match_id, last_seen_match_id
        FROM player_aliases
        WHERE player_id = ?
        """,
        (merge_player_id,),
    ).fetchall()
    for row in rows:
        existing = scalar(
            conn,
            """
            SELECT player_alias_id, first_seen_match_id, last_seen_match_id
            FROM player_aliases
            WHERE player_id = ? AND alias_type = ? AND alias_value = ?
            """,
            (keep_player_id, row["alias_type"], row["alias_value"]),
        )
        if existing:
            first_seen = min(
                value
                for value in (existing["first_seen_match_id"], row["first_seen_match_id"])
                if value is not None
            )
            last_seen = max(
                value
                for value in (existing["last_seen_match_id"], row["last_seen_match_id"])
                if value is not None
            )
            conn.execute(
                """
                UPDATE player_aliases
                SET first_seen_match_id = ?, last_seen_match_id = ?
                WHERE player_alias_id = ?
                """,
                (first_seen, last_seen, existing["player_alias_id"]),
            )
            conn.execute(
                "DELETE FROM player_aliases WHERE player_alias_id = ?", (row["player_alias_id"],)
            )
        else:
            conn.execute(
                "UPDATE player_aliases SET player_id = ? WHERE player_alias_id = ?",
                (keep_player_id, row["player_alias_id"]),
            )


def merge_season_entries(conn, keep_player_id, merge_player_id):
    rows = conn.execute(
        """
        SELECT *
        FROM player_season_entries
        WHERE player_id = ?
        """,
        (merge_player_id,),
    ).fetchall()
    for row in rows:
        existing = scalar(
            conn,
            """
            SELECT *
            FROM player_season_entries
            WHERE player_id = ? AND team_season_entry_id = ?
            """,
            (keep_player_id, row["team_season_entry_id"]),
        )
        if existing:
            first_seen = min(
                value
                for value in (existing["first_seen_match_id"], row["first_seen_match_id"])
                if value is not None
            )
            last_seen = max(
                value
                for value in (existing["last_seen_match_id"], row["last_seen_match_id"])
                if value is not None
            )
            primary_lounge_name = existing["primary_lounge_name"] or row["primary_lounge_name"]
            primary_mii_name = existing["primary_mii_name"] or row["primary_mii_name"]
            flag = existing["flag"] or row["flag"]
            conn.execute(
                """
                UPDATE player_season_entries
                SET primary_lounge_name = ?,
                    primary_mii_name = ?,
                    flag = ?,
                    first_seen_match_id = ?,
                    last_seen_match_id = ?
                WHERE player_season_entry_id = ?
                """,
                (
                    primary_lounge_name,
                    primary_mii_name,
                    flag,
                    first_seen,
                    last_seen,
                    existing["player_season_entry_id"],
                ),
            )
            conn.execute(
                """
                UPDATE match_players
                SET player_season_entry_id = ?
                WHERE player_season_entry_id = ?
                """,
                (existing["player_season_entry_id"], row["player_season_entry_id"]),
            )
            conn.execute(
                "DELETE FROM player_season_entries WHERE player_season_entry_id = ?",
                (row["player_season_entry_id"],),
            )
        else:
            conn.execute(
                "UPDATE player_season_entries SET player_id = ? WHERE player_season_entry_id = ?",
                (keep_player_id, row["player_season_entry_id"]),
            )


def merge_player(conn, keep_player_id, merge_player_id):
    merge_alias(conn, keep_player_id, merge_player_id)
    merge_season_entries(conn, keep_player_id, merge_player_id)
    conn.execute(
        "UPDATE player_friend_codes SET player_id = ? WHERE player_id = ?",
        (keep_player_id, merge_player_id),
    )
    conn.execute(
        "UPDATE match_players SET player_id = ? WHERE player_id = ?",
        (keep_player_id, merge_player_id),
    )
    conn.execute(
        "UPDATE race_player_results SET player_id = ? WHERE player_id = ?",
        (keep_player_id, merge_player_id),
    )
    conn.execute("DELETE FROM players WHERE player_id = ?", (merge_player_id,))


def player_ids_for_friend_codes(conn, friend_codes):
    placeholders = ",".join("?" for _ in friend_codes)
    return [
        row["player_id"]
        for row in conn.execute(
            f"""
            SELECT DISTINCT player_id
            FROM player_friend_codes
            WHERE friend_code IN ({placeholders})
            ORDER BY player_id
            """,
            tuple(friend_codes),
        )
    ]


def merge_identities(db_path: Path, identity_path: Path, create_backup: bool = True):
    if create_backup:
        backup_path = db_path.with_name(
            f"{db_path.name}.bak-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        )
        shutil.copy2(db_path, backup_path)
        print(f"Backup created: {backup_path}")

    groups = load_identity_groups(identity_path)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    merged = []
    with conn:
        for canonical_friend_code, group in groups.items():
            friend_codes = sorted(group["friend_codes"])
            player_ids = player_ids_for_friend_codes(conn, friend_codes)
            if not player_ids:
                continue

            keep_row = scalar(
                conn,
                """
                SELECT player_id
                FROM player_friend_codes
                WHERE friend_code = ?
                """,
                (canonical_friend_code,),
            )
            keep_player_id = keep_row["player_id"] if keep_row else player_ids[0]
            for merge_player_id in player_ids:
                if merge_player_id != keep_player_id:
                    merge_player(conn, keep_player_id, merge_player_id)
                    merged.append((merge_player_id, keep_player_id, canonical_friend_code))

            conn.execute(
                """
                UPDATE players
                SET primary_friend_code = ?,
                    canonical_lounge_name = COALESCE(NULLIF(?, ''), canonical_lounge_name)
                WHERE player_id = ?
                """,
                (canonical_friend_code, group["canonical_lounge_name"], keep_player_id),
            )

    conn.close()
    print(f"Merged player rows: {len(merged)}")
    for merge_player_id, keep_player_id, canonical_friend_code in merged:
        print(f"{merge_player_id} -> {keep_player_id} ({canonical_friend_code})")


def main():
    parser = argparse.ArgumentParser(
        description="Merge reviewed player identities by friend-code map."
    )
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="SQLite database path.")
    parser.add_argument(
        "--identity-map", type=Path, default=IDENTITY_PATH, help="Player identity CSV path."
    )
    parser.add_argument(
        "--no-backup", action="store_true", help="Do not create a timestamped DB backup first."
    )
    args = parser.parse_args()

    merge_identities(args.db, args.identity_map, create_backup=not args.no_backup)


if __name__ == "__main__":
    main()
