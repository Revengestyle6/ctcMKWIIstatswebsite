# ruff: noqa: E402

import json
import tempfile
import unittest
from pathlib import Path

from test_support import configure_test_environment

configure_test_environment()

import acceptance_service
from admin_auth import AdminActor
from archive_storage import LocalArchiveStorage
from database_health import build_database_health
from import_json_to_db import detect_new_entries
from match_upload import prepare_upload_document
from models import AdminUser, Match
from sqlalchemy import func, select
from test_support import PostgreSQLTestDatabase

SAMPLE_MATCH_PATH = (
    Path(__file__).resolve().parent
    / "JSON"
    / "ctc"
    / "s3"
    / "d2"
    / "W11 [M11] sts 366 - 356 CS.json"
)


class Phase3PostgresIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.database = PostgreSQLTestDatabase()
        self.session_factory = self.database.SessionLocal

    def tearDown(self):
        self.database.close()

    def test_database_health_queries_are_postgres_compatible(self):
        with self.session_factory() as session:
            report = build_database_health(session, include_archive=False)

        self.assertEqual(report["database"]["backend"], "postgresql")
        self.assertEqual(report["database"]["connection_status"], "ok")
        self.assertTrue(report["database"]["name"])
        self.assertTrue(report["database"]["version"].startswith("18"))
        self.assertGreater(report["database"]["size_bytes"], 0)
        self.assertIsNone(report["database"]["schema_revision"])
        self.assertEqual(report["database"]["integrity"]["physical"]["status"], "not_run")
        self.assertEqual(report["database"]["integrity"]["foreign_keys"]["status"], "ok")
        self.assertEqual(report["database"]["integrity"]["foreign_keys"]["unvalidated"], 0)
        self.assertIn(report["status"], {"healthy", "warning", "critical"})

    def test_acceptance_is_immediately_queryable_on_postgres(self):
        actor = AdminActor(1, "postgres-owner", "owner@example.com", "owner")
        match_data = json.loads(SAMPLE_MATCH_PATH.read_text(encoding="utf-8"))
        document = prepare_upload_document(match_data)
        with self.session_factory.begin() as session:
            session.add(
                AdminUser(
                    admin_user_id=1,
                    firebase_uid=actor.firebase_uid,
                    email=actor.email,
                    normalized_email=actor.email,
                    role="owner",
                    status="active",
                    database_access_status="not_requested",
                    repository_access_status="not_requested",
                )
            )
            approved = {entry["key"] for entry in detect_new_entries(session, match_data)}

        with tempfile.TemporaryDirectory() as directory:
            storage = LocalArchiveStorage(Path(directory))
            temporary_key = "queue/admin/postgres.json"
            storage.put_temporary(temporary_key, document.content)
            original_factory = acceptance_service.stats.SessionLocal
            acceptance_service.stats.SessionLocal = self.session_factory
            try:
                result = acceptance_service.accept_match(
                    storage,
                    actor,
                    match_data,
                    approved_keys=approved,
                    expected_fingerprint=document.fingerprint,
                    temporary_key=temporary_key,
                )
            finally:
                acceptance_service.stats.SessionLocal = original_factory

        self.assertEqual(result.status_code, 200)
        with self.session_factory() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(Match)), 1)
            match = session.get(Match, result.payload["match_id"])
            self.assertIsNotNone(match)
            self.assertEqual(match.match_label, match_data["match_label"])


if __name__ == "__main__":
    unittest.main()
