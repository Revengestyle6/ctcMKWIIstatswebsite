import json
import os
import tempfile
import unittest
from pathlib import Path

import acceptance_service
from admin_auth import AdminActor
from archive_storage import LocalArchiveStorage
from database import get_session_factory
from import_json_to_db import detect_new_entries
from match_upload import prepare_upload_document
from models import AdminUser, Match
from sqlalchemy import func, select

POSTGRES_TEST_URL = os.environ.get("PHASE3_POSTGRES_TEST_URL", "")
SAMPLE_MATCH_PATH = (
    Path(__file__).resolve().parent
    / "JSON"
    / "ctc"
    / "s3"
    / "d2"
    / "W11 [M11] sts 366 - 356 CS.json"
)


@unittest.skipUnless(POSTGRES_TEST_URL, "PHASE3_POSTGRES_TEST_URL is not configured")
class Phase3PostgresIntegrationTests(unittest.TestCase):
    def test_acceptance_is_immediately_queryable_on_postgres(self):
        session_factory = get_session_factory(POSTGRES_TEST_URL)
        actor = AdminActor(1, "postgres-owner", "owner@example.com", "owner")
        match_data = json.loads(SAMPLE_MATCH_PATH.read_text(encoding="utf-8"))
        document = prepare_upload_document(match_data)
        with session_factory.begin() as session:
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
            acceptance_service.stats.SessionLocal = session_factory
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
        with session_factory() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(Match)), 1)
            match = session.get(Match, result.payload["match_id"])
            self.assertIsNotNone(match)
            self.assertEqual(match.match_label, match_data["match_label"])


if __name__ == "__main__":
    unittest.main()
