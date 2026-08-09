import unittest
from unittest.mock import patch

from test_support import PostgreSQLTestDatabase, configure_test_environment

configure_test_environment()

import import_json_to_db  # noqa: E402
import stats_queries  # noqa: E402
from import_json_to_db import PlayerIdentities  # noqa: E402
from match_editor_catalog import (  # noqa: E402
    list_player_team_memberships,
    list_team_roster_pool,
)
from models import (  # noqa: E402
    Division,
    Player,
    PlayerAlias,
    PlayerFriendCode,
    PlayerSeasonEntry,
    Season,
    Team,
    TeamLeagueIdentity,
    TeamSeasonEntry,
)
from routes.common import unapproved_entries  # noqa: E402
from sqlalchemy import func, select  # noqa: E402


class MatchEditorPlayerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = PostgreSQLTestDatabase()
        cls.SessionLocal = cls.database.SessionLocal

    @classmethod
    def tearDownClass(cls):
        cls.database.close()

    def test_roster_pool_and_explicit_identity_mapping_reuse_records(self):
        with self.SessionLocal.begin() as session:
            season = Season(
                league_code="ctc",
                season_code="s3",
                season_number=3,
                name="Season 3",
                status="active",
            )
            team = Team(canonical_name="Cosmic Speed", canonical_tag="CS")
            other_team = Team(canonical_name="Slay", canonical_tag="SLAY")
            player = Player(canonical_name="June", primary_friend_code="1111-1111-1111")
            session.add_all((season, team, other_team, player))
            session.flush()
            division = Division(
                season_id=season.season_id,
                division_code="d2",
                division_name="Division 2",
            )
            session.add(division)
            session.flush()
            team_entry = TeamSeasonEntry(
                team_id=team.team_id,
                season_id=season.season_id,
                division_id=division.division_id,
                display_name="Cosmic Speed",
                clan_tag="CS",
            )
            other_team_entry = TeamSeasonEntry(
                team_id=other_team.team_id,
                season_id=season.season_id,
                division_id=division.division_id,
                display_name="Slay",
                clan_tag="SLAY",
            )
            session.add_all((team_entry, other_team_entry))
            session.add_all(
                (
                    TeamLeagueIdentity(team_id=team.team_id, league_code="ctc", tag="CS"),
                    TeamLeagueIdentity(team_id=other_team.team_id, league_code="ctc", tag="SLAY"),
                )
            )
            session.flush()
            season_entry = PlayerSeasonEntry(
                player_id=player.player_id,
                team_season_entry_id=team_entry.team_season_entry_id,
                season_id=season.season_id,
                division_id=division.division_id,
                primary_lounge_name="June S3",
                primary_mii_name="CS June",
                flag="us",
            )
            session.add_all(
                (
                    season_entry,
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
            session.flush()

            roster = list_team_roster_pool(
                session,
                "ctc",
                "s3",
                "d2",
                team.team_id,
            )
            self.assertEqual(len(roster), 1)
            self.assertEqual(roster[0]["player_id"], player.player_id)
            self.assertEqual(roster[0]["friend_code"], "2222-2222-2222")
            self.assertEqual(roster[0]["lounge_name"], "June S3")
            self.assertEqual(roster[0]["mii_name"], "CS June")
            self.assertEqual(roster[0]["flag"], "us")
            memberships = list_player_team_memberships(
                session,
                "ctc",
                "s3",
                "d2",
                [player.player_id],
            )
            self.assertEqual(
                memberships,
                [
                    {
                        "player_id": player.player_id,
                        "teams": [
                            {
                                "team_id": team.team_id,
                                "canonical_name": "Cosmic Speed",
                                "canonical_tag": "CS",
                                "display_name": "Cosmic Speed",
                                "clan_tag": "CS",
                            }
                        ],
                    }
                ],
            )

            new_friend_code = "9999-9999-9999"
            player_data = {
                "lounge_name": "June New",
                "table_name": "June New",
                "mii_name": "CS New",
                "flag": "ca",
            }
            match_data = {
                "league": "ctc",
                "season": "s3",
                "division": "d2",
                "match_label": "W9 CS SLAY",
                "teams": {
                    "CS": {
                        "players": {
                            new_friend_code: player_data,
                        }
                    }
                },
                "tracks": [],
            }
            requested_links = {new_friend_code: player.player_id}
            entries = import_json_to_db.detect_new_entries(
                session,
                match_data,
                player_identity_links=requested_links,
            )
            player_entry = next(entry for entry in entries if entry["type"] == "player")
            self.assertEqual(player_entry["kind"], "existing_player_new_friend_code")
            self.assertEqual(player_entry["proposed_player_id"], player.player_id)
            self.assertIn(f":{player.player_id}:", player_entry["key"])

            _entries, unapproved, approved_links, _team_links = unapproved_entries(
                session,
                match_data,
                {player_entry["key"]},
                requested_links,
            )
            self.assertEqual(unapproved, [])
            self.assertEqual(approved_links, requested_links)

            linked_player = import_json_to_db.get_or_create_player(
                session,
                new_friend_code,
                player_data,
                PlayerIdentities(),
                approved_links,
            )
            import_json_to_db.add_player_aliases(session, linked_player, player_data, None)
            reused_entry = import_json_to_db.get_or_create_player_entry(
                session,
                linked_player,
                team_entry,
                season,
                division,
                player_data,
                None,
            )
            new_team_entry = import_json_to_db.get_or_create_player_entry(
                session,
                linked_player,
                other_team_entry,
                season,
                division,
                player_data,
                None,
            )

            self.assertEqual(linked_player.player_id, player.player_id)
            self.assertEqual(
                reused_entry.player_season_entry_id,
                season_entry.player_season_entry_id,
            )
            self.assertEqual(reused_entry.primary_lounge_name, "June New")
            self.assertEqual(reused_entry.primary_mii_name, "CS New")
            self.assertEqual(reused_entry.flag, "ca")
            self.assertNotEqual(
                new_team_entry.player_season_entry_id,
                season_entry.player_season_entry_id,
            )
            memberships = list_player_team_memberships(
                session,
                "ctc",
                "s3",
                "d2",
                [player.player_id],
            )
            self.assertEqual(
                [team["team_id"] for team in memberships[0]["teams"]],
                [team.team_id, other_team.team_id],
            )
            self.assertEqual(
                session.scalar(
                    select(func.count())
                    .select_from(Player)
                    .where(Player.player_id == player.player_id)
                ),
                1,
            )
            self.assertEqual(
                session.scalar(
                    select(func.count())
                    .select_from(PlayerSeasonEntry)
                    .where(
                        PlayerSeasonEntry.player_id == player.player_id,
                        PlayerSeasonEntry.team_season_entry_id == team_entry.team_season_entry_id,
                    )
                ),
                1,
            )
            self.assertEqual(
                session.scalar(
                    select(func.count())
                    .select_from(PlayerFriendCode)
                    .where(PlayerFriendCode.friend_code == new_friend_code)
                ),
                1,
            )
            self.assertEqual(
                session.scalar(
                    select(func.count())
                    .select_from(PlayerAlias)
                    .where(
                        PlayerAlias.player_id == player.player_id,
                        PlayerAlias.alias_value == "June New",
                    )
                ),
                2,
            )
            player_id = player.player_id

        with patch.object(stats_queries, "SessionLocal", self.SessionLocal):
            result = stats_queries.find_player_identities(query=str(player_id))
        self.assertEqual(result["reason"], "player_search")
        self.assertEqual([row["player_id"] for row in result["results"]], [player_id])


if __name__ == "__main__":
    unittest.main()
