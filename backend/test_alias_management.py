import os
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
    AdminAuditLog,
    AdminUser,
    Division,
    Match,
    MatchPlayer,
    MatchTeam,
    MkcRefreshPreview,
    Player,
    PlayerAlias,
    PlayerFriendCode,
    PlayerSeasonEntry,
    Race,
    RacePlayerResult,
    Season,
    SourceFile,
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
            session.query(AdminAuditLog).delete()
            session.query(MkcRefreshPreview).delete()
            session.query(RacePlayerResult).delete()
            session.query(MatchPlayer).delete()
            session.query(MatchTeam).delete()
            session.query(Race).delete()
            session.query(Match).delete()
            session.query(SourceFile).delete()
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
            session.query(AdminUser).delete()
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

            season = Season(
                league_code="ctc",
                season_code="s0",
                season_number=0,
                name="Test Season",
                status="complete",
            )
            session.add(season)
            session.flush()
            division = Division(
                season_id=season.season_id,
                division_code="d1",
                division_name="Division 1",
            )
            session.add(division)
            session.flush()
            self.season_id = season.season_id
            self.division_id = division.division_id
            source = SourceFile(
                season_id=season.season_id,
                division_id=division.division_id,
                source_path="test/alias-management.json",
                source_filename="alias-management.json",
                file_sha256="a" * 64,
                json_shape="single_match",
            )
            session.add(source)
            session.flush()
            match = Match(
                season_id=season.season_id,
                division_id=division.division_id,
                source_file_id=source.source_file_id,
                match_label="W1 Test",
                week_number=1,
                races_played=2,
            )
            session.add(match)
            session.flush()
            race = Race(
                match_id=match.match_id,
                race_number=1,
                track_id=track.track_id,
                track_name_raw="Luigi Circuit",
            )
            session.add(race)
            session.flush()
            self.match_id = match.match_id
            self.race_id = race.race_id

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
            alias_management.update_player_canonical_override(
                session,
                self.player_id,
                {"enabled": True},
            )
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

    def test_friend_codes_can_be_added_and_primary_removal_selects_replacement(self):
        with self.SessionLocal.begin() as session:
            primary = PlayerFriendCode(
                player_id=self.player_id,
                friend_code="5031-1216-1890",
            )
            session.add(primary)
            session.flush()
            detail, added = alias_management.add_player_friend_code(
                session,
                self.player_id,
                {"friend_code": "1111-2222-3333"},
            )
            self.assertEqual(added.friend_code, "1111-2222-3333")
            self.assertEqual(len(detail["friend_codes"]), 2)
            search_results = alias_management.list_entities(
                session, "players", query="1111-2222-3333"
            )
            self.assertEqual([result["id"] for result in search_results], [self.player_id])

            detail, deleted = alias_management.delete_player_friend_code(
                session,
                self.player_id,
                primary.player_friend_code_id,
            )
            self.assertTrue(deleted["was_primary"])
            self.assertEqual(detail["secondary"], "1111-2222-3333")
            self.assertEqual(
                [(code["value"], code["is_primary"]) for code in detail["friend_codes"]],
                [("1111-2222-3333", True)],
            )

    def test_friend_code_add_rejects_invalid_or_other_player_code(self):
        with self.SessionLocal.begin() as session:
            other_player = Player(canonical_name="Other")
            session.add(other_player)
            session.flush()
            session.add(
                PlayerFriendCode(
                    player_id=other_player.player_id,
                    friend_code="9999-8888-7777",
                )
            )
            session.flush()
            with self.assertRaisesRegex(ValueError, "format"):
                alias_management.add_player_friend_code(
                    session,
                    self.player_id,
                    {"friend_code": "999988887777"},
                )
            with self.assertRaisesRegex(ValueError, f"player ID {other_player.player_id}"):
                alias_management.add_player_friend_code(
                    session,
                    self.player_id,
                    {"friend_code": "9999-8888-7777"},
                )

    def test_friend_code_routes_add_remove_and_audit(self):
        with self.SessionLocal.begin() as session:
            admin = AdminUser(
                email="owner@example.com",
                normalized_email="owner@example.com",
                role="owner",
                status="active",
            )
            session.add(admin)

        headers = {"X-Dev-Admin-Email": "owner@example.com"}
        with (
            patch.dict(os.environ, {"APP_ENV": "test", "ALLOW_DEV_AUTH": "true"}),
            patch("admin_auth.SessionLocal", self.SessionLocal),
            patch("routes.admin.stats.SessionLocal", self.SessionLocal),
            app.test_client() as client,
        ):
            added = client.post(
                f"/api/admin/aliases/players/{self.player_id}/friend-codes",
                json={"friend_code": "1111-2222-3333"},
                headers=headers,
            )
            self.assertEqual(added.status_code, 201, added.get_json())
            friend_code = next(
                code
                for code in added.get_json()["friend_codes"]
                if code["value"] == "1111-2222-3333"
            )
            removed = client.delete(
                f"/api/admin/aliases/players/{self.player_id}/friend-codes/{friend_code['id']}",
                headers=headers,
            )
            self.assertEqual(removed.status_code, 200, removed.get_json())
            self.assertFalse(
                any(
                    code["value"] == "1111-2222-3333" for code in removed.get_json()["friend_codes"]
                )
            )

        with self.SessionLocal() as session:
            actions = {audit.action for audit in session.query(AdminAuditLog).all()}
            self.assertIn("player.friend_code_added", actions)
            self.assertIn("player.friend_code_deleted", actions)

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

            ctc_results = alias_management.list_entities(session, "tracks", league_code="ctc")
            gsc_results = alias_management.list_entities(session, "tracks", league_code="gsc")

            self.assertEqual([row["id"] for row in ctc_results], [self.track_id])
            self.assertEqual([row["id"] for row in gsc_results], [gsc_track.track_id])

    def test_track_can_be_renamed_and_historical_races_are_cleansed(self):
        with self.SessionLocal.begin() as session:
            detail, result = alias_management.update_track_canonical_name(
                session, self.track_id, {"canonical_name": "Luigi Raceway"}
            )

            self.assertEqual(detail["canonical_name"], "Luigi Raceway")
            self.assertEqual(detail["race_count"], 1)
            self.assertEqual(result, {"previous_name": "Luigi Circuit", "races_updated": 1})
            race = session.get(Race, self.race_id)
            self.assertEqual(race.track_name_raw, "Luigi Raceway")
            aliases = session.scalars(
                session.query(TrackAlias).where(TrackAlias.track_id == self.track_id).statement
            ).all()
            self.assertEqual([alias.alias_value for alias in aliases], ["Luigi Circuit"])

    def test_duplicate_track_can_be_merged_into_an_existing_track(self):
        with self.SessionLocal.begin() as session:
            duplicate = Track(league_code="ctc", canonical_name="Luigi Circut")
            session.add(duplicate)
            session.flush()
            duplicate_id = duplicate.track_id
            session.add(TrackAlias(track_id=duplicate_id, alias_value="LC typo"))
            duplicate_race = Race(
                match_id=self.match_id,
                race_number=2,
                track_id=duplicate_id,
                track_name_raw="Luigi Circut",
            )
            session.add(duplicate_race)
            session.flush()
            duplicate_race_id = duplicate_race.race_id

            result = alias_management.merge_track(
                session, duplicate_id, {"target_track_id": self.track_id}
            )

            self.assertIsNone(session.get(Track, duplicate_id))
            updated_race = session.get(Race, duplicate_race_id)
            self.assertEqual(updated_race.track_id, self.track_id)
            self.assertEqual(updated_race.track_name_raw, "Luigi Circuit")
            self.assertEqual(result["races_updated"], 1)
            self.assertEqual(result["aliases_moved"], 2)
            self.assertEqual(result["target"]["race_count"], 2)
            aliases = session.scalars(
                session.query(TrackAlias).where(TrackAlias.track_id == self.track_id).statement
            ).all()
            self.assertEqual({alias.alias_value for alias in aliases}, {"Luigi Circut", "LC typo"})

    def test_track_merge_rejects_cross_league_destination(self):
        with self.SessionLocal.begin() as session:
            destination = Track(league_code="gsc", canonical_name="Luigi Circuit")
            session.add(destination)
            session.flush()
            with self.assertRaisesRegex(ValueError, "same league"):
                alias_management.merge_track(
                    session, self.track_id, {"target_track_id": destination.track_id}
                )

    def test_track_merge_route_records_an_audit_log(self):
        with self.SessionLocal.begin() as session:
            duplicate = Track(league_code="ctc", canonical_name="Luigi Circut")
            admin = AdminUser(
                email="owner@example.com",
                normalized_email="owner@example.com",
                role="owner",
                status="active",
            )
            session.add_all((duplicate, admin))
            session.flush()
            duplicate_id = duplicate.track_id

        headers = {"X-Dev-Admin-Email": "owner@example.com"}
        with (
            patch.dict(os.environ, {"APP_ENV": "test", "ALLOW_DEV_AUTH": "true"}),
            patch("admin_auth.SessionLocal", self.SessionLocal),
            patch("routes.admin.stats.SessionLocal", self.SessionLocal),
            app.test_client() as client,
        ):
            response = client.post(
                f"/api/admin/aliases/tracks/{duplicate_id}/merge",
                json={"target_track_id": self.track_id},
                headers=headers,
            )
            self.assertEqual(response.status_code, 200, response.get_json())
            self.assertEqual(response.get_json()["target"]["id"], self.track_id)

        with self.SessionLocal() as session:
            audit = session.scalar(
                session.query(AdminAuditLog).where(AdminAuditLog.action == "track.merged").statement
            )
            self.assertIsNotNone(audit)

    def test_player_merge_moves_identity_and_historical_records(self):
        with self.SessionLocal.begin() as session:
            destination = Player(canonical_name="JuneMKC", primary_friend_code="1111-2222-3333")
            session.add(destination)
            session.flush()
            destination_id = destination.player_id
            session.add_all(
                (
                    PlayerFriendCode(player_id=self.player_id, friend_code="5031-1216-1890"),
                    PlayerFriendCode(player_id=destination_id, friend_code="1111-2222-3333"),
                    PlayerAlias(
                        player_id=self.player_id,
                        alias_type="mkc_name",
                        alias_value="JuneMKC",
                    ),
                    PlayerAlias(
                        player_id=destination_id,
                        alias_type="mkc_name",
                        alias_value="JuneMKC",
                    ),
                    PlayerAlias(
                        player_id=self.player_id,
                        alias_type="table_name",
                        alias_value="June old",
                    ),
                )
            )
            team_entry = TeamSeasonEntry(
                team_id=self.team_id,
                season_id=self.season_id,
                division_id=self.division_id,
                display_name="Cosmic Speed",
                clan_tag="CS",
            )
            session.add(team_entry)
            session.flush()
            source_entry = PlayerSeasonEntry(
                player_id=self.player_id,
                team_season_entry_id=team_entry.team_season_entry_id,
                season_id=self.season_id,
                division_id=self.division_id,
                primary_lounge_name="June",
            )
            target_entry = PlayerSeasonEntry(
                player_id=destination_id,
                team_season_entry_id=team_entry.team_season_entry_id,
                season_id=self.season_id,
                division_id=self.division_id,
                primary_mii_name="JUNE",
            )
            session.add_all((source_entry, target_entry))
            session.flush()
            source_entry_id = source_entry.player_season_entry_id
            target_entry_id = target_entry.player_season_entry_id
            match_team = MatchTeam(
                match_id=self.match_id,
                team_season_entry_id=team_entry.team_season_entry_id,
                raw_team_key="CS",
            )
            session.add(match_team)
            session.flush()
            match_player = MatchPlayer(
                match_team_id=match_team.match_team_id,
                player_id=self.player_id,
                player_season_entry_id=source_entry_id,
                friend_code_raw="5031-1216-1890",
            )
            session.add(match_player)
            session.flush()
            result = RacePlayerResult(
                race_id=self.race_id,
                match_player_id=match_player.match_player_id,
                player_id=self.player_id,
                match_team_id=match_team.match_team_id,
                team_season_entry_id=team_entry.team_season_entry_id,
            )
            session.add(result)
            session.flush()
            match_player_id = match_player.match_player_id
            result_id = result.race_player_result_id

            comparison = alias_management.player_merge_comparison(
                session, self.player_id, destination_id
            )
            self.assertEqual(comparison["source"]["canonical_name"], "June")
            self.assertEqual(comparison["target"]["canonical_name"], "JuneMKC")
            self.assertEqual(comparison["impact"]["race_results"], 1)
            self.assertEqual(comparison["blockers"], [])

            merged = alias_management.merge_player(
                session, self.player_id, {"target_player_id": destination_id}
            )

            self.assertIsNone(session.get(Player, self.player_id))
            self.assertEqual(session.get(MatchPlayer, match_player_id).player_id, destination_id)
            self.assertEqual(
                session.get(MatchPlayer, match_player_id).player_season_entry_id,
                target_entry_id,
            )
            self.assertEqual(session.get(RacePlayerResult, result_id).player_id, destination_id)
            self.assertIsNone(session.get(PlayerSeasonEntry, source_entry_id))
            self.assertEqual(merged["season_entries_consolidated"], 1)
            self.assertEqual(merged["aliases_consolidated"], 1)
            destination_codes = session.scalars(
                session.query(PlayerFriendCode)
                .where(PlayerFriendCode.player_id == destination_id)
                .statement
            ).all()
            self.assertEqual(
                {code.friend_code for code in destination_codes},
                {"5031-1216-1890", "1111-2222-3333"},
            )
            destination_aliases = session.scalars(
                session.query(PlayerAlias).where(PlayerAlias.player_id == destination_id).statement
            ).all()
            self.assertEqual(
                {(alias.alias_type, alias.alias_value) for alias in destination_aliases},
                {
                    ("mkc_name", "JuneMKC"),
                    ("table_name", "June old"),
                    ("canonical_name", "June"),
                },
            )

    def test_player_merge_is_blocked_when_both_records_appear_in_one_match(self):
        with self.SessionLocal.begin() as session:
            destination = Player(canonical_name="Other")
            team_entry = TeamSeasonEntry(
                team_id=self.team_id,
                season_id=self.season_id,
                division_id=self.division_id,
                display_name="Cosmic Speed",
                clan_tag="CS",
            )
            session.add_all((destination, team_entry))
            session.flush()
            match_team = MatchTeam(
                match_id=self.match_id,
                team_season_entry_id=team_entry.team_season_entry_id,
                raw_team_key="CS",
            )
            session.add(match_team)
            session.flush()
            session.add_all(
                (
                    MatchPlayer(
                        match_team_id=match_team.match_team_id,
                        player_id=self.player_id,
                        friend_code_raw="5031-1216-1890",
                    ),
                    MatchPlayer(
                        match_team_id=match_team.match_team_id,
                        player_id=destination.player_id,
                        friend_code_raw="1111-2222-3333",
                    ),
                )
            )
            session.flush()

            comparison = alias_management.player_merge_comparison(
                session, self.player_id, destination.player_id
            )
            self.assertEqual(comparison["overlapping_matches"][0]["id"], self.match_id)
            self.assertTrue(comparison["blockers"])
            with self.assertRaisesRegex(ValueError, "same match"):
                alias_management.merge_player(
                    session,
                    self.player_id,
                    {"target_player_id": destination.player_id},
                )

    def test_player_merge_review_and_confirmation_routes_are_audited(self):
        with self.SessionLocal.begin() as session:
            destination = Player(canonical_name="JuneMKC")
            admin = AdminUser(
                email="owner@example.com",
                normalized_email="owner@example.com",
                role="owner",
                status="active",
            )
            session.add_all((destination, admin))
            session.flush()
            destination_id = destination.player_id

        headers = {"X-Dev-Admin-Email": "owner@example.com"}
        with (
            patch.dict(os.environ, {"APP_ENV": "test", "ALLOW_DEV_AUTH": "true"}),
            patch("admin_auth.SessionLocal", self.SessionLocal),
            patch("routes.admin.stats.SessionLocal", self.SessionLocal),
            app.test_client() as client,
        ):
            comparison = client.get(
                f"/api/admin/aliases/players/{self.player_id}/merge-comparison",
                query_string={"target_player_id": destination_id},
                headers=headers,
            )
            self.assertEqual(comparison.status_code, 200, comparison.get_json())
            self.assertEqual(comparison.get_json()["target"]["id"], destination_id)

            response = client.post(
                f"/api/admin/aliases/players/{self.player_id}/merge",
                json={"target_player_id": destination_id},
                headers=headers,
            )
            self.assertEqual(response.status_code, 200, response.get_json())
            self.assertEqual(response.get_json()["target"]["id"], destination_id)

        with self.SessionLocal() as session:
            self.assertIsNone(session.get(Player, self.player_id))
            audit = session.scalar(
                session.query(AdminAuditLog)
                .where(AdminAuditLog.action == "player.merged")
                .statement
            )
            self.assertIsNotNone(audit)

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
