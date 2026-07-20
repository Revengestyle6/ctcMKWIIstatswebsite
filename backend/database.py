import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import declarative_base, sessionmaker

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DEFAULT_DB_PATH = DATA_DIR / "ctc_stats.sqlite"

Base = declarative_base()


@event.listens_for(Engine, "connect")
def set_sqlite_pragmas(dbapi_connection, _connection_record):
    if dbapi_connection.__class__.__module__.split(".")[0] != "sqlite3":
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


def database_url(db_path: Path | str | None = None) -> str:
    if db_path is None and os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    path = Path(db_path) if db_path else DEFAULT_DB_PATH
    return f"sqlite:///{path.as_posix()}"


def get_engine(db_path: Path | str | None = None):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return create_engine(database_url(db_path), future=True)


def get_session_factory(db_path: Path | str | None = None):
    return sessionmaker(
        bind=get_engine(db_path), autoflush=False, expire_on_commit=False, future=True
    )


def init_database(db_path: Path | str | None = None):
    from models import Base as ModelsBase

    engine = get_engine(db_path)
    ModelsBase.metadata.create_all(engine)
    return engine
