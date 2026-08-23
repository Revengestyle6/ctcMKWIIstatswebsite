import unittest
from unittest.mock import patch

from test_support import PostgreSQLTestDatabase, configure_test_environment

configure_test_environment()

import alias_management  # noqa: E402
import mkc_name_sync  # noqa: E402
from admin_auth import AdminActor  # noqa: E402
from import_json_to_db import PlayerIdentities, get_or_create_player  # noqa: E402
from mkc_registry import lookup_mkc_player  # noqa: E402
from models import (  # noqa: E402
    AdminUser,
    MkcRefreshPreview,
    Player,
    PlayerAlias,
    PlayerFriendCode,
)
from player_naming import add_player_alias, latest_mkc_name  # noqa: E402


class MkcPlayerNameTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = PostgreSQLTestDatabase()
        cls.SessionLocal = cls.database.SessionLocal

    @classmethod
    def tearDownClass(cls):
        cls.database.close()

    def setUp(self):
        with self.SessionLocal.begin() as session:
            session.query(MkcRefreshPreview).delete()
            session.query(PlayerAlias).delete()
            session.query(PlayerFriendCode).delete()
            session.query(Player).delete()
            session.query(AdminUser).delete()
            admin = AdminUser(
                email="owner@example.com",
                normalized_email="owner@example.com",
                role="owner",
                status="active",
            )
            player = Player(canonical_name="JSON Name", primary_friend_code="1111-1111-1111")
            session.add_all((admin, player))
            session.flush()
            session.add_all(
                (
                    PlayerFriendCode(
                        player_id=player.player_id,
                        friend_code="1111-1111-1111",
                    ),
                    PlayerFriendCode(
                        player_id=player.player_id,
                        friend_code="2222-2222-2222",
                    ),
                )
            )
            self.admin_id = admin.admin_user_id
            self.player_id = player.player_id
        self.actor = AdminActor(
            self.admin_id,
            "local:owner@example.com",
            "owner@example.com",
            "owner",
        )

    def test_preview_uses_recent_code_and_apply_preserves_displaced_name(self):
        def lookup(friend_code):
            if friend_code == "2222-2222-2222":
                return {
                    "status": "found",
                    "friend_code": friend_code,
                    "mkc_player_id": 42,
                    "mkc_name": "MKC Name",
                }
            return {"status": "not_found", "friend_code": friend_code}

        with patch.object(mkc_name_sync, "lookup_mkc_player", side_effect=lookup) as request:
            with self.SessionLocal.begin() as session:
                preview = mkc_name_sync.create_refresh_preview(session, self.actor, self.player_id)
                self.assertEqual(preview["summary"]["new"], 1)
                self.assertTrue(preview["results"][0]["canonical_will_change"])
                self.assertEqual(session.get(Player, self.player_id).canonical_name, "JSON Name")
            self.assertEqual(request.call_args_list[0].args, ("2222-2222-2222",))

        with self.SessionLocal.begin() as session:
            applied = mkc_name_sync.apply_refresh_preview(
                session, preview["preview_id"], self.actor
            )
            self.assertEqual(applied["applied"]["aliases_created"], 2)
            self.assertEqual(applied["applied"]["canonical_names_changed"], 1)

        with self.SessionLocal() as session:
            player = session.get(Player, self.player_id)
            self.assertEqual(player.canonical_name, "MKC Name")
            aliases = {
                (alias.alias_type, alias.alias_value)
                for alias in session.query(PlayerAlias).filter_by(player_id=self.player_id)
            }
            self.assertIn(("mkc_name", "MKC Name"), aliases)
            self.assertIn(("mkc_id", "42"), aliases)
            self.assertIn(("canonical_name", "JSON Name"), aliases)
            self.assertTrue(
                all(alias.created_at is not None for alias in session.query(PlayerAlias).all())
            )

    def test_override_keeps_canonical_name_but_collects_mkc_alias(self):
        with self.SessionLocal.begin() as session:
            player = session.get(Player, self.player_id)
            player.canonical_name_override = True

        found = {
            "status": "found",
            "friend_code": "2222-2222-2222",
            "mkc_player_id": 42,
            "mkc_name": "New MKC Name",
        }
        with patch.object(mkc_name_sync, "lookup_mkc_player", return_value=found):
            with self.SessionLocal.begin() as session:
                preview = mkc_name_sync.create_refresh_preview(session, self.actor, self.player_id)
                result = preview["results"][0]
                self.assertFalse(result["canonical_will_change"])
                self.assertEqual(result["proposed_canonical_name"], "JSON Name")
            with self.SessionLocal.begin() as session:
                mkc_name_sync.apply_refresh_preview(session, preview["preview_id"], self.actor)

        with self.SessionLocal() as session:
            player = session.get(Player, self.player_id)
            self.assertEqual(player.canonical_name, "JSON Name")
            self.assertIsNotNone(
                session.query(PlayerAlias)
                .filter_by(
                    player_id=self.player_id,
                    alias_type="mkc_name",
                    alias_value="New MKC Name",
                )
                .one_or_none()
            )

    def test_new_player_import_stores_mkc_name_and_id_aliases(self):
        with self.SessionLocal.begin() as session:
            player = get_or_create_player(
                session,
                "4444-4444-4444",
                {"lounge_name": "Imported Lounge"},
                PlayerIdentities(),
                player_mkc_profiles={
                    "4444-4444-4444": {
                        "status": "found",
                        "mkc_name": "Imported MKC",
                        "mkc_player_id": 1461,
                    }
                },
            )
            aliases = {
                (alias.alias_type, alias.alias_value)
                for alias in session.query(PlayerAlias).filter_by(player_id=player.player_id)
            }
            self.assertEqual(player.canonical_name, "Imported MKC")
            self.assertIn(("mkc_name", "Imported MKC"), aliases)
            self.assertIn(("mkc_id", "1461"), aliases)

    def test_manual_name_requires_override_and_retains_previous_name(self):
        with self.SessionLocal.begin() as session:
            with self.assertRaisesRegex(ValueError, "Enable the canonical-name override"):
                alias_management.update_player_canonical_name(
                    session, self.player_id, {"canonical_name": "Manual Name"}
                )
            alias_management.update_player_canonical_override(
                session, self.player_id, {"enabled": True}
            )
            detail, previous = alias_management.update_player_canonical_name(
                session, self.player_id, {"canonical_name": "Manual Name"}
            )
            self.assertEqual(previous, "JSON Name")
            self.assertEqual(detail["canonical_name"], "Manual Name")
            self.assertTrue(detail["canonical_name_override"])
            self.assertTrue(
                any(
                    alias["type"] == "canonical_name" and alias["value"] == "JSON Name"
                    for alias in detail["aliases"]
                )
            )

    def test_no_profile_and_request_failure_are_reported_separately(self):
        responses = {
            "2222-2222-2222": {
                "status": "not_found",
                "friend_code": "2222-2222-2222",
            },
            "1111-1111-1111": {
                "status": "lookup_failed",
                "friend_code": "1111-1111-1111",
                "error": "MKCentral request failed: Timeout",
            },
        }
        with patch.object(
            mkc_name_sync,
            "lookup_mkc_player",
            side_effect=lambda friend_code: responses[friend_code],
        ):
            with self.SessionLocal.begin() as session:
                preview = mkc_name_sync.create_refresh_preview(session, self.actor, self.player_id)
        self.assertEqual(preview["summary"]["lookup_failed"], 1)
        self.assertEqual(preview["summary"]["not_found"], 0)
        self.assertEqual(preview["results"][0]["attempts"][0]["status"], "not_found")
        self.assertEqual(preview["results"][0]["attempts"][1]["status"], "lookup_failed")

    def test_returning_to_an_older_mkc_name_makes_it_current_again(self):
        with self.SessionLocal.begin() as session:
            first_alias, _created = add_player_alias(session, self.player_id, "mkc_name", "Name A")
            first_entered_at = first_alias.created_at
            add_player_alias(session, self.player_id, "mkc_name", "Name B")
            returned_alias, created = add_player_alias(
                session, self.player_id, "mkc_name", "Name A"
            )
            self.assertFalse(created)
            self.assertEqual(returned_alias.created_at, first_entered_at)
            self.assertEqual(latest_mkc_name(session, self.player_id), "Name A")

    def test_combined_mkc_name_keeps_raw_alias_and_remembers_canonical_choice(self):
        found = {
            "status": "found",
            "friend_code": "2222-2222-2222",
            "mkc_player_id": 42,
            "mkc_name": "Alpha | Beta/Gamma",
        }
        with patch.object(mkc_name_sync, "lookup_mkc_player", return_value=found):
            with self.SessionLocal.begin() as session:
                preview = mkc_name_sync.create_refresh_preview(session, self.actor, self.player_id)
                result = preview["results"][0]
                self.assertEqual(
                    result["canonical_name_options"],
                    ["Alpha", "Beta", "Gamma", "Alpha | Beta/Gamma"],
                )
                self.assertEqual(result["proposed_canonical_name"], "Alpha | Beta/Gamma")
            with self.SessionLocal.begin() as session:
                with self.assertRaisesRegex(ValueError, "not a valid option"):
                    mkc_name_sync.apply_refresh_preview(
                        session,
                        preview["preview_id"],
                        self.actor,
                        {str(self.player_id): "Unreviewed custom value"},
                    )
            with self.SessionLocal.begin() as session:
                mkc_name_sync.apply_refresh_preview(
                    session,
                    preview["preview_id"],
                    self.actor,
                    {str(self.player_id): "Beta"},
                )

            with self.SessionLocal.begin() as session:
                player = session.get(Player, self.player_id)
                self.assertEqual(player.canonical_name, "Beta")
                raw_alias = (
                    session.query(PlayerAlias)
                    .filter_by(
                        player_id=self.player_id,
                        alias_type="mkc_name",
                        alias_value="Alpha | Beta/Gamma",
                    )
                    .one_or_none()
                )
                self.assertIsNotNone(raw_alias)

            with self.SessionLocal.begin() as session:
                repeated = mkc_name_sync.create_refresh_preview(session, self.actor, self.player_id)
                repeated_result = repeated["results"][0]
                self.assertEqual(repeated_result["change"], "unchanged")
                self.assertEqual(repeated_result["proposed_canonical_name"], "Beta")
            self.assertFalse(repeated_result["canonical_will_change"])

    def test_shared_mkc_name_uses_lounge_names_while_ids_remain_distinct(self):
        with self.SessionLocal.begin() as session:
            second_player = Player(
                canonical_name="Second JSON", primary_friend_code="3333-3333-3333"
            )
            session.add(second_player)
            session.flush()
            second_player_id = second_player.player_id
            session.add(PlayerFriendCode(player_id=second_player_id, friend_code="3333-3333-3333"))
            add_player_alias(session, self.player_id, "lounge_name", "First Lounge")
            add_player_alias(session, second_player_id, "lounge_name", "Second Lounge")

        def lookup(friend_code):
            return {
                "status": "found",
                "friend_code": friend_code,
                "mkc_player_id": 43 if friend_code == "3333-3333-3333" else 42,
                "mkc_name": "Shared MKC Name",
            }

        with patch.object(mkc_name_sync, "lookup_mkc_player", side_effect=lookup):
            with self.SessionLocal.begin() as session:
                preview = mkc_name_sync.create_refresh_preview(session, self.actor)
                by_player = {result["player_id"]: result for result in preview["results"]}
                self.assertEqual(
                    by_player[self.player_id]["proposed_canonical_name"], "First Lounge"
                )
                self.assertEqual(
                    by_player[second_player_id]["proposed_canonical_name"], "Second Lounge"
                )
                self.assertEqual(
                    by_player[self.player_id]["shared_mkc_name_player_ids"],
                    [self.player_id, second_player_id],
                )
            with self.SessionLocal.begin() as session:
                mkc_name_sync.apply_refresh_preview(session, preview["preview_id"], self.actor)

        with self.SessionLocal() as session:
            self.assertEqual(session.get(Player, self.player_id).canonical_name, "First Lounge")
            self.assertEqual(session.get(Player, second_player_id).canonical_name, "Second Lounge")
            ids = session.execute(
                session.query(PlayerAlias.player_id, PlayerAlias.alias_value)
                .where(PlayerAlias.alias_type == "mkc_id")
                .statement
            ).all()
            self.assertEqual(set(ids), {(self.player_id, "42"), (second_player_id, "43")})


class MkcRegistryResponseTests(unittest.TestCase):
    @patch("mkc_registry._http_session")
    def test_successful_empty_response_is_not_a_transport_failure(self, session_factory):
        response = session_factory.return_value.get.return_value
        response.raise_for_status.return_value = None
        response.json.return_value = {"player_list": [], "player_count": 0, "page_count": 0}
        self.assertEqual(lookup_mkc_player("1111-1111-1111")["status"], "not_found")

    @patch("mkc_registry._http_session")
    def test_results_are_filtered_to_exact_mkw_friend_code(self, session_factory):
        response = session_factory.return_value.get.return_value
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "player_list": [
                {
                    "id": 10,
                    "name": "Wrong Platform",
                    "friend_codes": [
                        {"fc": "1111-1111-1111", "type": "switch"},
                    ],
                },
                {
                    "id": 11,
                    "name": "Correct Player",
                    "friend_codes": [
                        {"fc": "1111-1111-1111", "type": "mkw"},
                    ],
                },
            ]
        }
        result = lookup_mkc_player("1111-1111-1111")
        self.assertEqual(result["status"], "found")
        self.assertEqual(result["mkc_name"], "Correct Player")


if __name__ == "__main__":
    unittest.main()
