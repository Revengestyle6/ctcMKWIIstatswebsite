"""PostgreSQL isolation helpers for the active backend test suite."""

import os
import uuid

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

LOCAL_TEST_DATABASE_URL = "postgresql+psycopg://ctc_local:ctc_local@127.0.0.1:55432/ctc_dev"


def configure_test_environment() -> str:
    """Use an explicit test URL or the documented local container, never DATABASE_URL."""
    url = os.environ.get("TEST_DATABASE_URL") or LOCAL_TEST_DATABASE_URL
    os.environ["APP_ENV"] = "test"
    os.environ["DATABASE_URL"] = url
    return url


configure_test_environment()

from database import Base, database_url  # noqa: E402


class PostgreSQLTestDatabase:
    """Create a disposable schema without truncating a shared database."""

    def __init__(self):
        self.schema = f"test_{uuid.uuid4().hex}"
        self.database_url = database_url(os.environ["DATABASE_URL"])
        self.admin_engine = create_engine(self.database_url, future=True)
        with self.admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{self.schema}"'))
        self.engine = create_engine(
            self.database_url,
            future=True,
            connect_args={"options": f"-csearch_path={self.schema}"},
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(
            bind=self.engine,
            autoflush=False,
            expire_on_commit=False,
            future=True,
        )

    def drop_foreign_keys(self, table_name: str) -> None:
        """Remove test-fixture FKs when a unit intentionally uses synthetic IDs."""
        query = text("""
            SELECT conname
            FROM pg_constraint
            WHERE contype = 'f'
              AND conrelid = CAST(:table_name AS regclass)
        """)
        with self.engine.begin() as connection:
            names = connection.execute(query, {"table_name": table_name}).scalars().all()
            for name in names:
                connection.execute(text(f'ALTER TABLE "{table_name}" DROP CONSTRAINT "{name}"'))

    def close(self) -> None:
        self.engine.dispose()
        with self.admin_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{self.schema}" CASCADE'))
        self.admin_engine.dispose()
