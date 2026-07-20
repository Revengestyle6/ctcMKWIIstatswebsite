import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import declarative_base, sessionmaker

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DEFAULT_DB_PATH = DATA_DIR / "ctc_stats.sqlite"

Base = declarative_base()
VALID_APP_ENVIRONMENTS = {"local", "test", "staging", "production"}
PRODUCTION_ENVIRONMENTS = {"staging", "production"}


def app_environment() -> str:
    environment = os.environ.get("APP_ENV", "local").strip().lower()
    if environment not in VALID_APP_ENVIRONMENTS:
        choices = ", ".join(sorted(VALID_APP_ENVIRONMENTS))
        raise RuntimeError(f"APP_ENV must be one of: {choices}.")
    return environment


@event.listens_for(Engine, "connect")
def set_sqlite_pragmas(dbapi_connection, _connection_record):
    if dbapi_connection.__class__.__module__.split(".")[0] != "sqlite3":
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


def database_url(database_target: Path | str | None = None) -> str:
    if isinstance(database_target, str) and "://" in database_target:
        configured_url = database_target
    elif database_target is None and os.environ.get("DATABASE_URL"):
        configured_url = os.environ["DATABASE_URL"].strip()
    else:
        path = Path(database_target) if database_target else DEFAULT_DB_PATH
        configured_url = f"sqlite:///{path.as_posix()}"

    if configured_url.startswith("postgres://"):
        configured_url = configured_url.replace("postgres://", "postgresql+psycopg://", 1)
    elif configured_url.startswith("postgresql://"):
        configured_url = configured_url.replace("postgresql://", "postgresql+psycopg://", 1)

    url = make_url(configured_url)
    if app_environment() in PRODUCTION_ENVIRONMENTS and url.get_backend_name() == "sqlite":
        raise RuntimeError("Staging and production require a PostgreSQL DATABASE_URL.")
    return configured_url


def get_engine(database_target: Path | str | None = None):
    url = database_url(database_target)
    backend = make_url(url).get_backend_name()
    if backend == "sqlite":
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        return create_engine(url, future=True)

    return create_engine(
        url,
        future=True,
        pool_pre_ping=True,
        pool_size=int(os.environ.get("DB_POOL_SIZE", "3")),
        max_overflow=int(os.environ.get("DB_MAX_OVERFLOW", "2")),
        pool_recycle=int(os.environ.get("DB_POOL_RECYCLE_SECONDS", "1800")),
        connect_args={"application_name": os.environ.get("DB_APPLICATION_NAME", "ctc-stats-api")},
    )


def get_session_factory(database_target: Path | str | None = None):
    return sessionmaker(
        bind=get_engine(database_target), autoflush=False, expire_on_commit=False, future=True
    )


def init_database(database_target: Path | str | None = None):
    from models import Base as ModelsBase

    engine = get_engine(database_target)
    if engine.dialect.name == "sqlite":
        ModelsBase.metadata.create_all(engine)
    return engine
