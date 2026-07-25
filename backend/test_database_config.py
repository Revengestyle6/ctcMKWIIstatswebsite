import os
import unittest
from unittest.mock import patch

from database import app_environment, database_url, get_engine


class DatabaseConfigurationTests(unittest.TestCase):
    def test_database_url_is_required_in_every_environment(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(app_environment(), "local")
            with self.assertRaisesRegex(RuntimeError, "PostgreSQL DATABASE_URL is required"):
                database_url()

    def test_sqlite_is_rejected_in_every_environment(self):
        for environment in ("local", "test", "staging", "production"):
            with self.subTest(environment=environment):
                with patch.dict(os.environ, {"APP_ENV": environment}, clear=True):
                    with self.assertRaisesRegex(RuntimeError, "other database engines are retired"):
                        database_url("sqlite:///temporary.sqlite")

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
