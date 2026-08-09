import unittest
from unittest.mock import patch

from test_support import PostgreSQLTestDatabase, configure_test_environment

configure_test_environment()

import admin_auth  # noqa: E402
import alias_management  # noqa: E402
from app import app  # noqa: E402
from import_json_to_db import (  # noqa: E402
    detect_new_entries,
    load_database_team_aliases,
    resolve_team_alias,
)
from models import (  # noqa: E402
    AdminUser,
    Division,
    Player,
    PlayerAlias,
    PlayerFriendCode,
    PlayerSeasonEntry,
    Season,
    Team,
    TeamAlias,
    TeamSeasonEntry,
    Track,
    TrackAlias,
)


class AliasManagementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = PostgreSQLTestDatabase()
        cls.SessionLocal = cls.database.SessionLocal

    @classmethod
    def tearDownClass(cls):
        cls.database.close()

    def setUp(self):
        with self.SessionLocal.begin() as session:
            session.query(PlayerSeasonEntry).delete()
            session.query(PlayerFriendCode).delete()
            session.query(PlayerAlias).delete()
            session.query(TeamAlias).delete()
            session.query(TrackAlias).delete()
            session.query(TeamSeasonEntry).delete()
            session.query(Division).delete()
            session.query(Season).delete()
            session.query(Player).delete()
            session.query(Track).delete()
            session.query(Team).delete()
            player = Player(
                canonical_name="June",
                primary_friend_code="5031-1216-1890",
            )
            team = Team(canonical_name="Cosmic Speed", canonical_tag="CS")
            track = Track(canonical_name="Luigi Circuit")
            session.add_all((player, team, track))
            session.flush()
            self.player_id = player.player_id
            self.team_id = team.team_id
            self.track_id = track.track_id

    def test_player_alias_types_are_grouped_and_searchable(self):
        with self.SessionLocal.begin() as session:
            detail, _alias = alias_management.add_alias(
                session,
                "players",
                self.player_id,
                {"type": "mii_name", "value": "CS June"},
            )
            self.assertEqual(detail["alias_types"], ["lounge_name", "table_name", "mii_name"])
            self.assertEqual(detail["aliases"][0]["type"], "mii_name")
            results = alias_management.list_entities(session, "players", query="cs june")
            self.assertEqual([row["id"] for row in results], [self.player_id])

    def test_player_detail_includes_friend_codes_and_season_entries(self):
        with self.SessionLocal.begin() as session:
            season = Season(
                league_code="ctc",
                season_code="s3",
                season_number=3,
                name="Season 3",
                status="complete",
            )
            session.add(season)
            session.flush()
            division = Division(
                season_id=season.season_id,
                division_code="d2",
                division_name="Division 2",
            )
            session.add(division)
            session.flush()
            team_entry = TeamSeasonEntry(
                team_id=self.team_id,
                season_id=season.season_id,
                division_id=division.division_id,
                display_name="Cosmic Speed",
                clan_tag="CS",
            )
            friend_code = PlayerFriendCode(
                player_id=self.player_id,
                friend_code="5031-1216-1890",
            )
            session.add_all((team_entry, friend_code))
            session.flush()
            player_entry = PlayerSeasonEntry(
                player_id=self.player_id,
                team_season_entry_id=team_entry.team_season_entry_id,
                season_id=season.season_id,
                division_id=division.division_id,
                primary_lounge_name="June",
                primary_mii_name="CS June",
                flag="us",
            )
            session.add(player_entry)
            session.flush()

            detail = alias_management.get_entity(session, "players", self.player_id)

            self.assertEqual(detail["id"], self.player_id)
            self.assertEqual(
                detail["friend_codes"],
                [
                    {
                        "id": friend_code.player_friend_code_id,
                        "value": "5031-1216-1890",
                        "is_primary": True,
                        "first_seen_match_id": None,
                        "last_seen_match_id": None,
                    }
                ],
            )
            self.assertEqual(len(detail["season_entries"]), 1)
            self.assertEqual(detail["season_entries"][0]["league"], "ctc")
            self.assertEqual(detail["season_entries"][0]["season"], "s3")
            self.assertEqual(detail["season_entries"][0]["division"], "d2")
            self.assertEqual(detail["season_entries"][0]["team"]["clan_tag"], "CS")
            self.assertEqual(detail["season_entries"][0]["primary_mii_name"], "CS June")

            friend_code_id = friend_code.player_friend_code_id
            season_entry_id = player_entry.player_season_entry_id
            updated, previous_name = alias_management.update_player_canonical_name(
                session,
                self.player_id,
                {"canonical_name": "June Updated"},
            )
            self.assertEqual(previous_name, "June")
            self.assertEqual(updated["canonical_name"], "June Updated")
            self.assertEqual(updated["label"], "June Updated")
            self.assertEqual(updated["friend_codes"][0]["id"], friend_code_id)
            self.assertEqual(updated["season_entries"][0]["id"], season_entry_id)
            self.assertEqual(session.get(Player, self.player_id).player_id, self.player_id)

    def test_track_alias_can_be_added_and_removed(self):
        with self.SessionLocal.begin() as session:
            detail, alias = alias_management.add_alias(
                session, "tracks", self.track_id, {"value": "LC"}
            )
            self.assertEqual(detail["aliases"][0]["value"], "LC")
            detail, deleted = alias_management.delete_alias(
                session, "tracks", self.track_id, alias.track_alias_id
            )
            self.assertEqual(deleted["value"], "LC")
            self.assertEqual(detail["aliases"], [])

    def test_track_list_can_be_filtered_by_league(self):
        with self.SessionLocal.begin() as session:
            gsc_track = Track(league_code="gsc", canonical_name="Mario Circuit")
            session.add(gsc_track)
            session.flush()

            ctc_results = alias_management.list_entities(
                session, "tracks", league_code="ctc"
            )
            gsc_results = alias_management.list_entities(
                session, "tracks", league_code="gsc"
            )

            self.assertEqual([row["id"] for row in ctc_results], [self.track_id])
            self.assertEqual([row["id"] for row in gsc_results], [gsc_track.track_id])

    def test_team_alias_is_used_by_match_import_resolution(self):
        with self.SessionLocal.begin() as session:
            alias_management.add_alias(session, "teams", self.team_id, {"value": "Cosmic"})
            aliases = load_database_team_aliases(session)
            resolved = resolve_team_alias(aliases, "ctc", "s3", "d2", "W1 CS SLAY", "Cosmic")
            self.assertEqual(resolved["canonical_tag"], "CS")
            self.assertEqual(resolved["display_name"], "Cosmic Speed")

    def test_live_new_entry_detection_does_not_read_historical_corrections(self):
        match = {
            "league": "ctc",
            "season": "s3",
            "division": "d2",
            "match_label": "W1 CS SLAY",
            "teams": {"CS": {"players": {}}},
            "tracks": [],
        }
        with (
            self.SessionLocal() as session,
            patch(
                "import_json_to_db.load_historical_team_corrections",
                side_effect=AssertionError("Historical corrections must remain rebuild-only."),
            ),
        ):
            detect_new_entries(session, match)

    def test_local_admin_does_not_conflict_with_saved_firebase_identity(self):
        with self.SessionLocal.begin() as session:
            user = AdminUser(
                firebase_uid="firebase-production-uid",
                email="owner@example.com",
                normalized_email="owner@example.com",
                role="owner",
                status="active",
            )
            session.add(user)
            session.flush()
            user_id = user.admin_user_id
        with (
            patch.dict(
                "os.environ",
                {"APP_ENV": "local", "ALLOW_DEV_AUTH": "true"},
            ),
            app.test_request_context(headers={"X-Dev-Admin-Email": "owner@example.com"}),
            self.SessionLocal.begin() as session,
        ):
            actor = admin_auth.authenticate_admin(session)
            self.assertEqual(actor.email, "owner@example.com")
            self.assertEqual(
                session.get(AdminUser, user_id).firebase_uid,
                "firebase-production-uid",
            )


if __name__ == "__main__":
    unittest.main()
