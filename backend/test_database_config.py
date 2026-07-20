import os
import unittest
from pathlib import Path
from unittest.mock import patch

from database import app_environment, database_url, get_engine


class DatabaseConfigurationTests(unittest.TestCase):
    def test_local_environment_defaults_to_sqlite(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(app_environment(), "local")
            self.assertTrue(database_url().startswith("sqlite:///"))

    def test_explicit_sqlite_path_takes_priority(self):
        with patch.dict(
            os.environ,
            {"APP_ENV": "test", "DATABASE_URL": "postgresql://ignored/example"},
            clear=True,
        ):
            self.assertEqual(database_url(Path("temporary.sqlite")), "sqlite:///temporary.sqlite")

    def test_postgres_urls_use_psycopg_driver(self):
        with patch.dict(os.environ, {"APP_ENV": "local"}, clear=True):
            self.assertEqual(
                database_url("postgresql://user:password@localhost/database"),
                "postgresql+psycopg://user:password@localhost/database",
            )
            self.assertEqual(
                database_url("postgres://user:password@localhost/database"),
                "postgresql+psycopg://user:password@localhost/database",
            )

    def test_production_environments_reject_sqlite(self):
        for environment in ("staging", "production"):
            with self.subTest(environment=environment):
                with patch.dict(os.environ, {"APP_ENV": environment}, clear=True):
                    with self.assertRaisesRegex(RuntimeError, "require a PostgreSQL"):
                        database_url()

    def test_unknown_environment_is_rejected(self):
        with patch.dict(os.environ, {"APP_ENV": "prod"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "APP_ENV must be one of"):
                app_environment()

    def test_postgres_engine_uses_bounded_pool_settings(self):
        with patch.dict(
            os.environ,
            {
                "APP_ENV": "test",
                "DB_POOL_SIZE": "2",
                "DB_MAX_OVERFLOW": "1",
                "DB_POOL_RECYCLE_SECONDS": "90",
            },
            clear=True,
        ):
            engine = get_engine("postgresql://user:password@localhost/database")
            try:
                self.assertEqual(engine.pool.size(), 2)
                self.assertEqual(engine.pool._max_overflow, 1)
                self.assertEqual(engine.pool._recycle, 90)
            finally:
                engine.dispose()


if __name__ == "__main__":
    unittest.main()
