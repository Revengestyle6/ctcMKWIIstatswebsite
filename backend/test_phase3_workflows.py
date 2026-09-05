# ruff: noqa: E402

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from test_support import configure_test_environment

configure_test_environment()

import acceptance_service
import import_json_to_db
import match_management
import stats_db as stats
from admin_auth import AdminActor
from analytics_eligibility import analytics_excluded_race_ids
from archive_storage import LocalArchiveStorage
from bootstrap_archive import (
    accepted_key_for_source,
    archive_imported_sources,
    local_path_for_source,
)
from import_json_to_db import detect_new_entries
from match_upload import prepare_upload_document
from models import (
    AdminAuditLog,
    DatabaseAdditionLog,
    Match,
    MatchPlayer,
    MatchTeam,
    Player,
    PlayerAlias,
    PlayerFriendCode,
    PlayerSeasonEntry,
    Race,
    RacePlayerResult,
    ReviewSubmission,
    SourceFile,
    Track,
)
from phase3_maintenance import repair_accepted_archives
from review_queue import admin_submission, create_submission
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


class FailingPromotionStorage(LocalArchiveStorage):
    def promote(self, temporary_key: str, accepted_key: str, fingerprint: str):
        raise OSError("simulated storage outage")


class GcsLikeLocalArchiveStorage(LocalArchiveStorage):
    provider = "gcs"


class Phase3WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        root = Path(self.temporary_directory.name)
        self.database = PostgreSQLTestDatabase()
        self.engine = self.database.engine
        self.SessionLocal = self.database.SessionLocal
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
        self.database.close()
        self.temporary_directory.cleanup()

    def _approved_keys(self):
        with self.SessionLocal() as session:
            return {entry["key"] for entry in detect_new_entries(session, self.match_data)}

    def _accept_match(self):
        document = prepare_upload_document(self.match_data)
        temporary_key = f"queue/admin/{document.fingerprint}.json"
        self.storage.put_temporary(temporary_key, document.content)
        with patch.object(acceptance_service.stats, "SessionLocal", self.SessionLocal):
            return acceptance_service.accept_match(
                self.storage,
                self.actor,
                self.match_data,
                approved_keys=self._approved_keys(),
                expected_fingerprint=document.fingerprint,
                temporary_key=temporary_key,
            )

    def test_importer_accepts_a_downloaded_bootstrap_root(self):
        json_root = Path(self.temporary_directory.name) / "downloaded" / "JSON"
        source_path = json_root / "ctc" / "s3" / "d2" / SAMPLE_MATCH_PATH.name
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_bytes(SAMPLE_MATCH_PATH.read_bytes())

        with patch.object(import_json_to_db, "get_session_factory", return_value=self.SessionLocal):
            imported = import_json_to_db.import_json_tree(None, json_root)

        self.assertGreater(imported, 0)
        with self.SessionLocal() as session:
            source = session.scalar(select(SourceFile))
            self.assertEqual(
                source.source_path,
                f"JSON/ctc/s3/d2/{SAMPLE_MATCH_PATH.name}",
            )

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
            self.assertEqual(stored.match_label, self.match_data["match_label"])
            self.assertEqual(
                admin_submission(stored)["match_label"], self.match_data["match_label"]
            )
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
            addition_logs = session.scalars(
                select(DatabaseAdditionLog).where(DatabaseAdditionLog.operation_type == "addition")
            ).all()
            self.assertTrue(addition_logs)
            self.assertTrue(all(log.admin_email == self.actor.email for log in addition_logs))

    def test_match_edit_replaces_owned_rows_and_keeps_stable_match_id(self):
        accepted = self._accept_match()
        match_id = accepted.payload["match_id"]
        edited = json.loads(json.dumps(self.match_data))
        player = next(iter(next(iter(edited["teams"].values()))["players"].values()))
        player["mii_name"] = f"{player['mii_name']} edited"
        with self.SessionLocal.begin() as session:
            source = session.scalar(
                select(SourceFile).join(Match).where(Match.match_id == match_id)
            )
            original_created_at = session.get(Match, match_id).created_at
            original_match_index = session.get(Match, match_id).match_index_in_source
            replaced, _document, summary = match_management.replace_match(
                session,
                match_id,
                edited,
                approved_keys=set(),
                requested_player_identity_links={},
                requested_team_identity_resolutions={},
                expected_source_fingerprint=source.file_sha256,
                actor=self.actor,
            )
            self.assertEqual(replaced.match_id, match_id)
            self.assertEqual(replaced.created_at, original_created_at)
            self.assertEqual(replaced.match_index_in_source, original_match_index)
            self.assertGreaterEqual(replaced.last_update_at, original_created_at)
            self.assertTrue(
                any(change["path"].endswith("mii_name") for change in summary["changes"])
            )
            self.assertEqual(
                session.scalar(
                    select(func.count()).select_from(Match).where(Match.match_id == match_id)
                ),
                1,
            )
            self.assertEqual(
                session.scalar(
                    select(func.count()).select_from(Race).where(Race.match_id == match_id)
                ),
                len(edited["tracks"]),
            )
            edit_log = session.scalar(
                select(DatabaseAdditionLog).where(
                    DatabaseAdditionLog.match_id == match_id,
                    DatabaseAdditionLog.operation_type == "edit",
                )
            )
            self.assertIsNotNone(edit_log)
            self.assertEqual(edit_log.admin_email, self.actor.email)
            self.assertEqual(edit_log.admin_user_id, self.actor.admin_user_id)
            detail = stats.get_match_detail(match_id, session=session)
            self.assertNotIn("match_team_id", detail["teams"][0])
            self.assertNotIn("match_player_id", detail["teams"][0]["players"][0])

    def test_match_edit_preserves_source_identity_and_review_notes(self):
        accepted = self._accept_match()
        match_id = accepted.payload["match_id"]
        edited = json.loads(json.dumps(self.match_data))
        edited["match_label"] = f"{edited['match_label']} corrected"
        edited["review_notes"] = "Administrator confirmed the corrected source table."
        with self.SessionLocal.begin() as session:
            source = session.scalar(
                select(SourceFile).join(Match).where(Match.match_id == match_id)
            )
            original_path = source.original_source_path
            exclusion = (
                {
                    "source_path": original_path,
                    "match_index": 0,
                    "blocks": frozenset({1}),
                    "reason": "Test reviewed source.",
                },
            )
            self.assertEqual(len(analytics_excluded_race_ids(session, exclusion)), 4)
            replaced, _document, _summary = match_management.replace_match(
                session,
                match_id,
                edited,
                approved_keys=set(),
                requested_player_identity_links={},
                requested_team_identity_resolutions={},
                expected_source_fingerprint=source.file_sha256,
                actor=self.actor,
            )
            self.assertEqual(source.original_source_path, original_path)
            self.assertNotEqual(source.source_path, original_path)
            self.assertIn(edited["review_notes"], replaced.review_notes)
            self.assertEqual(len(analytics_excluded_race_ids(session, exclusion)), 4)

    def test_match_edit_prunes_only_unsupported_imported_player_catalog_rows(self):
        accepted = self._accept_match()
        match_id = accepted.payload["match_id"]
        edited = json.loads(json.dumps(self.match_data))
        team = next(iter(edited["teams"].values()))
        removed_friend_code = next(iter(team["players"]))
        team["players"].pop(removed_friend_code)

        with self.SessionLocal.begin() as session:
            imported_code = session.scalar(
                select(PlayerFriendCode).where(PlayerFriendCode.friend_code == removed_friend_code)
            )
            player_id = imported_code.player_id
            imported_alias_ids = set(
                session.scalars(
                    select(PlayerAlias.player_alias_id).where(
                        PlayerAlias.player_id == player_id,
                        PlayerAlias.origin == "match_import",
                        PlayerAlias.alias_type.in_(("lounge_name", "mii_name", "table_name")),
                    )
                ).all()
            )
            season_entry_id = session.scalar(
                select(PlayerSeasonEntry.player_season_entry_id).where(
                    PlayerSeasonEntry.player_id == player_id
                )
            )
            manual_code = PlayerFriendCode(
                player_id=player_id,
                friend_code="9999-9999-9999",
                origin="admin",
            )
            manual_alias = PlayerAlias(
                player_id=player_id,
                alias_type="table_name",
                alias_value="Administrator alias",
                origin="admin",
            )
            session.add_all([manual_code, manual_alias])
            session.flush()
            manual_code_id = manual_code.player_friend_code_id
            manual_alias_id = manual_alias.player_alias_id
            source = session.scalar(
                select(SourceFile).join(Match).where(Match.match_id == match_id)
            )
            match_management.replace_match(
                session,
                match_id,
                edited,
                approved_keys=set(),
                requested_player_identity_links={},
                requested_team_identity_resolutions={},
                expected_source_fingerprint=source.file_sha256,
                actor=self.actor,
            )

            self.assertIsNone(
                session.scalar(
                    select(PlayerFriendCode).where(
                        PlayerFriendCode.friend_code == removed_friend_code
                    )
                )
            )
            self.assertIsNotNone(session.get(PlayerFriendCode, manual_code_id))
            self.assertIsNotNone(session.get(PlayerAlias, manual_alias_id))
            self.assertTrue(
                all(session.get(PlayerAlias, alias_id) is None for alias_id in imported_alias_ids)
            )
            self.assertIsNone(session.get(PlayerSeasonEntry, season_entry_id))
            self.assertIsNotNone(session.get(Player, player_id))

    def test_match_delete_removes_only_owned_rows_and_preserves_catalog(self):
        accepted = self._accept_match()
        match_id = accepted.payload["match_id"]
        with self.SessionLocal() as session:
            catalog_before = {
                "players": session.scalar(select(func.count()).select_from(Player)),
                "tracks": session.scalar(select(func.count()).select_from(Track)),
            }
            label = session.get(Match, match_id).match_label
        with self.SessionLocal.begin() as session:
            manifest = match_management.delete_match_from_database(
                session, match_id, self.actor, label
            )
            self.assertGreater(manifest["records_deleted"]["race_player_results"], 0)
        with self.SessionLocal() as session:
            self.assertIsNone(session.get(Match, match_id))
            self.assertEqual(session.scalar(select(func.count()).select_from(MatchTeam)), 0)
            self.assertEqual(session.scalar(select(func.count()).select_from(MatchPlayer)), 0)
            self.assertEqual(session.scalar(select(func.count()).select_from(Race)), 0)
            self.assertEqual(session.scalar(select(func.count()).select_from(RacePlayerResult)), 0)
            self.assertEqual(
                session.scalar(select(func.count()).select_from(Player)), catalog_before["players"]
            )
            self.assertEqual(
                session.scalar(select(func.count()).select_from(Track)), catalog_before["tracks"]
            )

    def test_match_management_list_filters_by_league_season_and_division(self):
        accepted = self._accept_match()
        with self.SessionLocal() as session:
            matches = match_management.list_matches(
                session, league_code="ctc", season_code="s3", division_code="d2"
            )
            self.assertEqual(
                [match["match_id"] for match in matches], [accepted.payload["match_id"]]
            )
            self.assertEqual(
                match_management.list_matches(session, league_code="gsc"),
                [],
            )
            self.assertEqual(
                match_management.list_matches(session, league_code="ctc", season_code="s99"),
                [],
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

    def test_historical_source_bootstrap_uses_canonical_paths_and_gcs_metadata(self):
        document = prepare_upload_document(self.match_data)
        temporary_key = "queue/admin/bootstrap-source.json"
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

        json_root = Path(self.temporary_directory.name) / "bootstrap" / "JSON"
        with self.SessionLocal() as session:
            source = session.scalar(select(SourceFile))
            source_path = source.source_path
        local_path = local_path_for_source(json_root, source_path)
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(document.content)

        gcs_storage = GcsLikeLocalArchiveStorage(
            Path(self.temporary_directory.name) / "gcs-objects"
        )
        archived, failed = archive_imported_sources(self.SessionLocal, gcs_storage, json_root)
        self.assertEqual((archived, failed), (1, 0))

        accepted_key = accepted_key_for_source(source_path)
        self.assertEqual(gcs_storage.read(accepted_key), document.content)
        with self.SessionLocal() as session:
            source = session.scalar(select(SourceFile))
            self.assertEqual(source.storage_provider, "gcs")
            self.assertEqual(source.storage_object_key, accepted_key)
            self.assertEqual(source.archive_status, "complete")
            self.assertTrue(source.storage_generation)


class Phase3AuthorizationTests(unittest.TestCase):
    def test_sensitive_routes_reject_anonymous_requests(self):
        from app import app

        client = app.test_client()
        for method, path, payload in (
            ("get", "/api/database-health", None),
            ("get", "/api/database-additions", None),
            ("get", "/api/admin/users", None),
            ("get", "/api/admin/aliases/tracks", None),
            ("get", "/api/admin/review-submissions", None),
            ("post", "/api/admin/review-submissions", {}),
            ("post", "/api/matches/commit", {}),
        ):
            response = getattr(client, method)(path, json=payload)
            self.assertEqual(response.status_code, 401, path)


if __name__ == "__main__":
    unittest.main()
