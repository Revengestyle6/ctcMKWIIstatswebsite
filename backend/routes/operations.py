import logging
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from database import get_session_factory
from flask import Blueprint, jsonify
from models import Match, SourceFile
from sqlalchemy import func, select, text

logger = logging.getLogger(__name__)
operations_api = Blueprint("operations_api", __name__)
SessionLocal = get_session_factory()


def _expected_schema_revision() -> str:
    configuration = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    return ScriptDirectory.from_config(configuration).get_current_head()


@operations_api.get("/api/health/live")
def health_live():
    return jsonify({"status": "ok"})


@operations_api.get("/api/health/ready")
def health_ready():
    try:
        with SessionLocal() as session:
            session.execute(text("SELECT 1"))
            revision = session.scalar(text("SELECT version_num FROM alembic_version LIMIT 1"))
        if revision != _expected_schema_revision():
            return (
                jsonify(
                    {
                        "status": "not_ready",
                        "error": "schema_revision_mismatch",
                        "schema_revision": revision,
                    }
                ),
                503,
            )
        return jsonify({"status": "ok", "schema_revision": revision})
    except Exception:
        logger.exception("Readiness check failed")
        return jsonify({"status": "not_ready", "error": "database_unavailable"}), 503


@operations_api.get("/api/health/data")
def health_data():
    """Return a public, aggregate-only freshness signal."""
    try:
        with SessionLocal() as session:
            match_count = session.scalar(select(func.count()).select_from(Match)) or 0
            latest_import = session.scalar(select(func.max(Match.created_at)))
            archive_repairs = (
                session.scalar(
                    select(func.count())
                    .select_from(SourceFile)
                    .where(SourceFile.archive_status == "repair_required")
                )
                or 0
            )
        return jsonify(
            {
                "status": "ok" if archive_repairs == 0 else "degraded",
                "match_count": match_count,
                "latest_import_at": latest_import.isoformat() if latest_import else None,
                "archive_repairs_pending": archive_repairs,
            }
        )
    except Exception:
        logger.exception("Public data health check failed")
        return jsonify({"status": "unavailable"}), 503
