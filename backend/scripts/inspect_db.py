import argparse
import sys
from pathlib import Path

from sqlalchemy import func, select

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from database import DEFAULT_DB_PATH, get_session_factory
from models import (
    Division,
    Match,
    MatchPlayer,
    MatchTeam,
    Penalty,
    Player,
    Race,
    RacePlayerResult,
    Season,
    SourceFile,
    Team,
    TeamSeasonEntry,
    Track,
)

SUMMARY_MODELS = (
    Season,
    Division,
    SourceFile,
    Team,
    TeamSeasonEntry,
    Player,
    Match,
    MatchTeam,
    MatchPlayer,
    Track,
    Race,
    RacePlayerResult,
    Penalty,
)


def count(session, model) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def main():
    parser = argparse.ArgumentParser(description="Inspect the analytics SQLite database.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="SQLite database path.")
    parser.add_argument(
        "--review-limit", type=int, default=20, help="Number of review rows to show."
    )
    args = parser.parse_args()

    SessionLocal = get_session_factory(args.db)
    with SessionLocal() as session:
        print("Table counts")
        for model in SUMMARY_MODELS:
            print(f"{model.__tablename__}: {count(session, model)}")

        print()
        print("Match status")
        rows = session.execute(
            select(Match.import_status, func.count()).group_by(Match.import_status)
        ).all()
        for status, total in rows:
            print(f"{status}: {total}")

        print()
        print("Matches needing review")
        review_rows = session.execute(
            select(Match.match_id, Match.match_label, Match.review_notes)
            .where(Match.import_status == "needs_review")
            .order_by(Match.match_id)
            .limit(args.review_limit)
        ).all()
        if not review_rows:
            print("none")
        for match_id, label, notes in review_rows:
            print(f"{match_id}: {label} - {notes}")


if __name__ == "__main__":
    main()
