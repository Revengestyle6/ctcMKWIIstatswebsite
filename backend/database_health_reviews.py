import json
import threading
from datetime import datetime, timezone
from pathlib import Path

from models import AdminUser, HealthIssueReview
from sqlalchemy import select

DEFAULT_REVIEW_PATH = Path(__file__).resolve().parent / "data" / "database_health_reviews.json"
VALID_REVIEW_STATUSES = {"open", "dismissed"}
_WRITE_LOCK = threading.Lock()


def load_reviews(path=None, *, session=None):
    if session is not None:
        rows = session.execute(
            select(HealthIssueReview, AdminUser.email)
            .join(AdminUser, AdminUser.admin_user_id == HealthIssueReview.reviewed_by_admin_user_id)
            .order_by(HealthIssueReview.issue_key)
        ).all()
        return {
            review.issue_key: {
                "status": review.status,
                "note": review.note,
                "reviewed_at": review.reviewed_at.isoformat(),
                "reviewed_by": email,
            }
            for review, email in rows
        }
    review_path = Path(path) if path else DEFAULT_REVIEW_PATH
    if not review_path.exists():
        return {}
    try:
        payload = json.loads(review_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Could not read database health reviews: {error}") from error
    reviews = payload.get("reviews", {}) if isinstance(payload, dict) else {}
    return reviews if isinstance(reviews, dict) else {}


def set_issue_review(
    issue_key,
    status,
    note="",
    *,
    path=None,
    reviewed_by="local reviewer",
    session=None,
    reviewed_by_admin_user_id=None,
):
    if not isinstance(issue_key, str) or not issue_key.strip():
        raise ValueError("issue_key is required.")
    if status not in VALID_REVIEW_STATUSES:
        raise ValueError("status must be open or dismissed.")
    if not isinstance(note, str):
        raise ValueError("note must be text.")
    note = note.strip()
    if status == "dismissed" and not note:
        raise ValueError("A dismissal reason is required.")

    if session is not None:
        if not reviewed_by_admin_user_id:
            raise ValueError("An administrator is required.")
        review = session.get(HealthIssueReview, issue_key)
        if review is None:
            review = HealthIssueReview(
                issue_key=issue_key,
                reviewed_by_admin_user_id=reviewed_by_admin_user_id,
            )
            session.add(review)
        review.status = status
        review.note = note
        review.reviewed_by_admin_user_id = reviewed_by_admin_user_id
        review.reviewed_at = datetime.now(timezone.utc)
        session.flush()
        return {
            "status": review.status,
            "note": review.note,
            "reviewed_at": review.reviewed_at.isoformat(),
            "reviewed_by": reviewed_by,
        }

    review_path = Path(path) if path else DEFAULT_REVIEW_PATH
    with _WRITE_LOCK:
        reviews = load_reviews(review_path)
        review = {
            "status": status,
            "note": note,
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
            "reviewed_by": reviewed_by,
        }
        reviews[issue_key] = review
        payload = {"version": 1, "reviews": dict(sorted(reviews.items()))}
        review_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = review_path.with_suffix(review_path.suffix + ".tmp")
        temporary_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        temporary_path.replace(review_path)
    return review
