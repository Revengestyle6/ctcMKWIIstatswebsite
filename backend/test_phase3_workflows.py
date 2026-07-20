import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import acceptance_service
from admin_auth import AdminActor
from archive_storage import LocalArchiveStorage
from database import Base
from import_json_to_db import detect_new_entries
from match_upload import prepare_upload_document
from models import AdminAuditLog, Match, ReviewSubmission, SourceFile
from phase3_maintenance import repair_accepted_archives
from review_queue import create_submission
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

SAMPLE_MATCH_PATH = (
    Path(__file__).resolve().parent
    / "JSON"
    / "ctc"
    / "s3"
    / "d2"
    / "W11 [M11] sts 366 - 356 CS.json"
)


class FailingPromotionStorage(LocalArchiveStorage):
    def promote(self, temporary_key: str, accepted_key: str, fingerprint: str):
        raise OSError("simulated storage outage")


class Phase3WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        root = Path(self.temporary_directory.name)
        self.engine = create_engine(f"sqlite:///{root / 'phase3.sqlite'}", future=True)
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False, future=True
        )
        self.storage = LocalArchiveStorage(root / "objects")
        self.match_data = json.loads(SAMPLE_MATCH_PATH.read_text(encoding="utf-8"))
        self.actor = AdminActor(1, "test-owner", "owner@example.com", "owner")
        with self.SessionLocal.begin() as session:
            from models import AdminUser

            session.add(
                AdminUser(
                    admin_user_id=1,
                    firebase_uid="test-owner",
                    email="owner@example.com",
                    normalized_email="owner@example.com",
                    role="owner",
                    status="active",
                    database_access_status="not_requested",
                    repository_access_status="not_requested",
                )
            )

    def tearDown(self):
        self.engine.dispose()
        self.temporary_directory.cleanup()

    def _approved_keys(self):
        with self.SessionLocal() as session:
            return {entry["key"] for entry in detect_new_entries(session, self.match_data)}

    def test_public_submission_stays_out_of_analytics(self):
        with self.SessionLocal.begin() as session:
            submission = create_submission(
                session,
                self.storage,
                self.match_data,
                original_filename="review.json",
                warnings_acknowledged=True,
                network_identifier="127.0.0.1",
            )
            receipt = submission.submission_id

        with self.SessionLocal() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(Match)), 0)
            stored = session.get(ReviewSubmission, receipt)
            self.assertEqual(stored.status, "pending")
            self.assertEqual(
                json.loads(self.storage.read(stored.queue_object_key)), self.match_data
            )

    def test_admin_acceptance_is_idempotent_and_archives_only_after_commit(self):
        document = prepare_upload_document(self.match_data)
        temporary_key = "queue/admin/first.json"
        self.storage.put_temporary(temporary_key, document.content)
        with patch.object(acceptance_service.stats, "SessionLocal", self.SessionLocal):
            result = acceptance_service.accept_match(
                self.storage,
                self.actor,
                self.match_data,
                approved_keys=self._approved_keys(),
                expected_fingerprint=document.fingerprint,
                temporary_key=temporary_key,
            )
        self.assertEqual(result.payload["archive_status"], "complete")
        self.assertEqual(self.storage.read(result.payload["archive_path"]), document.content)

        retry_key = "queue/admin/retry.json"
        self.storage.put_temporary(retry_key, document.content)
        with patch.object(acceptance_service.stats, "SessionLocal", self.SessionLocal):
            duplicate = acceptance_service.accept_match(
                self.storage,
                self.actor,
                self.match_data,
                approved_keys=set(),
                expected_fingerprint=document.fingerprint,
                temporary_key=retry_key,
            )
        self.assertEqual(duplicate.payload["status"], "duplicate")
        with self.SessionLocal() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(Match)), 1)
            self.assertGreaterEqual(
                session.scalar(select(func.count()).select_from(AdminAuditLog)), 2
            )

    def test_archive_failure_keeps_match_visible_and_marks_repair_required(self):
        root = Path(self.temporary_directory.name) / "failing-objects"
        storage = FailingPromotionStorage(root)
        document = prepare_upload_document(self.match_data)
        temporary_key = "queue/admin/failure.json"
        storage.put_temporary(temporary_key, document.content)
        with patch.object(acceptance_service.stats, "SessionLocal", self.SessionLocal):
            result = acceptance_service.accept_match(
                storage,
                self.actor,
                self.match_data,
                approved_keys=self._approved_keys(),
                expected_fingerprint=document.fingerprint,
                temporary_key=temporary_key,
            )
        self.assertEqual(result.status_code, 202)
        self.assertEqual(result.payload["archive_status"], "repair_required")
        with self.SessionLocal() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(Match)), 1)
            source = session.scalar(select(SourceFile))
            self.assertEqual(source.archive_status, "repair_required")
            self.assertEqual(source.last_archive_error_code, "OSError")

        working_storage = LocalArchiveStorage(root)
        with patch.object(acceptance_service.stats, "SessionLocal", self.SessionLocal):
            retry = acceptance_service.accept_match(
                working_storage,
                self.actor,
                self.match_data,
                approved_keys=set(),
                expected_fingerprint=document.fingerprint,
                temporary_key=temporary_key,
            )
        self.assertEqual(retry.payload["status"], "duplicate")
        self.assertEqual(retry.payload["archive_status"], "complete")

        with self.SessionLocal.begin() as session:
            source = session.scalar(select(SourceFile))
            source.archive_status = "repair_required"
            accepted_key = source.storage_object_key
        working_storage.delete(accepted_key)
        repaired, failed = repair_accepted_archives(self.SessionLocal, working_storage)
        self.assertEqual((repaired, failed), (1, 0))
        with self.SessionLocal() as session:
            source = session.scalar(select(SourceFile))
            self.assertEqual(source.archive_status, "complete")
            self.assertTrue((working_storage.root / source.storage_object_key).is_file())


class Phase3AuthorizationTests(unittest.TestCase):
    def test_sensitive_routes_reject_anonymous_requests(self):
        from app import app

        client = app.test_client()
        for method, path, payload in (
            ("get", "/api/database-health", None),
            ("get", "/api/admin/users", None),
            ("get", "/api/admin/review-submissions", None),
            ("post", "/api/matches/commit", {}),
        ):
            response = getattr(client, method)(path, json=payload)
            self.assertEqual(response.status_code, 401, path)


if __name__ == "__main__":
    unittest.main()
