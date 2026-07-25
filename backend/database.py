import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import declarative_base, sessionmaker

BASE_DIR = Path(__file__).resolve().parent

Base = declarative_base()
VALID_APP_ENVIRONMENTS = {"local", "test", "staging", "production"}


def app_environment() -> str:
    environment = os.environ.get("APP_ENV", "local").strip().lower()
    if environment not in VALID_APP_ENVIRONMENTS:
        choices = ", ".join(sorted(VALID_APP_ENVIRONMENTS))
        raise RuntimeError(f"APP_ENV must be one of: {choices}.")
    return environment


def database_url(database_target: str | None = None) -> str:
    configured_url = (database_target or os.environ.get("DATABASE_URL", "")).strip()
    if not configured_url:
        raise RuntimeError("PostgreSQL DATABASE_URL is required.")

    if configured_url.startswith("postgres://"):
        configured_url = configured_url.replace("postgres://", "postgresql+psycopg://", 1)
    elif configured_url.startswith("postgresql://"):
        configured_url = configured_url.replace("postgresql://", "postgresql+psycopg://", 1)

    url = make_url(configured_url)
    if url.get_backend_name() != "postgresql":
        raise RuntimeError(
            "PostgreSQL DATABASE_URL is required; other database engines are retired."
        )
    return configured_url


def get_engine(database_target: str | None = None):
    url = database_url(database_target)
    return create_engine(
        url,
        future=True,
        pool_pre_ping=True,
        pool_size=int(os.environ.get("DB_POOL_SIZE", "3")),
        max_overflow=int(os.environ.get("DB_MAX_OVERFLOW", "2")),
        pool_recycle=int(os.environ.get("DB_POOL_RECYCLE_SECONDS", "1800")),
        connect_args={"application_name": os.environ.get("DB_APPLICATION_NAME", "ctc-stats-api")},
    )


def get_session_factory(database_target: str | None = None):
    return sessionmaker(
        bind=get_engine(database_target), autoflush=False, expire_on_commit=False, future=True
    )
