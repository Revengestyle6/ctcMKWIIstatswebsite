"""Audit the explanation against real imported records, including ambiguous roles."""

import unittest
from unittest.mock import patch

from test_support import PostgreSQLTestDatabase, configure_test_environment

configure_test_environment()

from import_json_to_db import import_preview_match  # noqa: E402
from models import MatchPlayer, MatchTeam, Race, RacePlayerResult, TeamSeasonEntry  # noqa: E402
from sqlalchemy import select  # noqa: E402
from standings_audit import get_standings_audit  # noqa: E402
from test_unaccounted_matches import aggregate_document  # noqa: E402


def race_document(number=1, division="d1", team="A", races=13):
    players = {}
    for index in range(10):
        tag = team if index < 5 else "B"
        position = index + 1
        role = "bagger" if index in (4, 9) else "runner"
        players.setdefault(tag, {})[f"1111-2222-{index:04d}"] = {
            "lounge_name": f"Player {index}",
            "total_score": races * 3,
            "race_scores": [3] * races,
            "race_positions": [position] * races,
            "race_roles": [role] * races,
        }
    return {
        "league": "ctc",
        "season": "s99",
        "division": division,
        "match_number": number,
        "format": "5v5",
        "races_played": races,
        "tracks": ["Test Track"] * races,
        "teams": {
            tag: {"table_tag_str": tag, "total_score": races * 15, "players": roster}
            for tag, roster in players.items()
        },
    }


class StandingsAuditTests(unittest.TestCase):
    def setUp(self):
        self.database = PostgreSQLTestDatabase()
        self.addCleanup(self.database.close)

    def import_document(self, document):
        with self.database.SessionLocal.begin() as session:
            match = import_preview_match(session, document)
            session.flush()
            return match.match_id

    def selected(self, session, fc="1111-2222-0000", tag="A"):
        return session.execute(
            select(MatchPlayer.player_id, MatchTeam.team_season_entry_id)
            .join(MatchTeam, MatchTeam.match_team_id == MatchPlayer.match_team_id)
            .join(
                TeamSeasonEntry,
                TeamSeasonEntry.team_season_entry_id == MatchTeam.team_season_entry_id,
            )
            .where(MatchPlayer.friend_code_raw == fc, TeamSeasonEntry.clan_tag == tag)
            .order_by(MatchPlayer.match_player_id)
        ).first()

    def audit(self, session, fc="1111-2222-0000", tag="A"):
        player_id, entry_id = self.selected(session, fc, tag)
        return get_standings_audit(
            session,
            league="ctc",
            season="s99",
            division="d1",
            player_id=player_id,
            team_season_entry_id=entry_id,
        )

    def test_partial_team_blocks_and_role_races_reconcile(self):
        self.import_document(race_document())
        with self.database.SessionLocal() as session:
            audit = self.audit(session)
        self.assertTrue(audit["reconciled"])
        self.assertEqual((audit["team_gps"], audit["team_races"]), (4, 13))
        self.assertEqual((audit["required_gps"], audit["required_races"]), (3, 12))
        self.assertEqual(audit["player"]["runner_gps_played"], 3.25)
        self.assertEqual(audit["matches"][0]["roles"]["runner"], {"points": 39, "races": 13})
        self.assertEqual(audit["flagged_races"], 0)

    def test_nine_finishers_dc_and_zero_awards_remain_reviewable(self):
        document = race_document(races=2)
        player = document["teams"]["A"]["players"]["1111-2222-0000"]
        player["race_positions"] = [None, None]
        player["race_scores"] = [3, 0]
        self.import_document(document)
        with self.database.SessionLocal() as session:
            audit = self.audit(session)
        self.assertEqual(audit["flagged_races"], 2)
        for race in audit["matches"][0]["races"]:
            self.assertEqual(race["room_size"], 9)
            self.assertEqual(set(race["flags"]), {"small_room", "dc_award"})
        self.assertEqual(audit["player"]["runner_races"], 2)
        self.assertEqual(audit["player"]["runner_points"], 3)
        self.assertTrue(audit["reconciled"])

    def test_role_change_baseline_does_not_include_other_divisions_or_teams(self):
        document = race_document()
        document["teams"]["A"]["players"]["1111-2222-0000"]["race_roles"][-1] = "bagger"
        document["teams"]["A"]["players"]["1111-2222-0004"]["race_roles"][-1] = "runner"
        self.import_document(document)
        for other in (
            race_document(2, division="d2", races=60),
            race_document(3, team="C", races=60),
        ):
            for team in other["teams"].values():
                for player in team["players"].values():
                    player["race_roles"] = ["bagger"] * 60
            self.import_document(other)
        with self.database.SessionLocal() as session:
            runner = self.audit(session)
            bagger = self.audit(session, "1111-2222-0004")
        self.assertEqual(runner["role_history"], {"runner": 12, "bagger": 1})
        self.assertEqual(runner["dominant_role"], "runner")
        self.assertEqual(bagger["dominant_role"], "bagger")
        for audit in (runner, bagger):
            self.assertEqual(audit["flagged_races"], 1)
            self.assertIn("unusual_role", audit["matches"][0]["races"][-1]["flags"])

    def test_small_sample_does_not_establish_a_typical_role(self):
        document = race_document(races=5)
        document["teams"]["A"]["players"]["1111-2222-0000"]["race_roles"][-1] = "bagger"
        self.import_document(document)
        with self.database.SessionLocal() as session:
            audit = self.audit(session)
        self.assertIsNone(audit["dominant_role"])
        self.assertEqual(audit["flagged_races"], 0)

    def test_unknown_and_excluded_races_are_explicit_and_reconcile(self):
        match_id = self.import_document(race_document(races=3))
        with self.database.SessionLocal.begin() as session:
            player_id, _ = self.selected(session)
            results = session.scalars(
                select(RacePlayerResult)
                .join(Race)
                .where(Race.match_id == match_id, RacePlayerResult.player_id == player_id)
                .order_by(Race.race_number)
            ).all()
            excluded_id = results[0].race_id
            results[1].role = "unknown"
            results[1].role_source = "unknown"
            results[1].position = None
            results[2].position = None
            results[2].score = None
        with (
            self.database.SessionLocal() as session,
            patch("analytics_eligibility._load_default_exclusions", return_value=()),
        ):
            with (
                patch("standings_audit.analytics_excluded_race_ids", return_value={excluded_id}),
                patch("standings_service.analytics_excluded_race_ids", return_value={excluded_id}),
            ):
                audit = self.audit(session)
        self.assertTrue(audit["reconciled"])
        self.assertEqual(audit["team_races"], 2)
        self.assertEqual(audit["unknown_role_races"], 1)
        self.assertFalse(audit["matches"][0]["races"][0]["included"])
        self.assertIn("unknown_role", audit["matches"][0]["races"][1]["flags"])
        self.assertFalse(audit["matches"][0]["races"][2]["participated"])

    def test_match_without_player_still_explains_team_denominator(self):
        self.import_document(race_document(races=4))
        second = race_document(2, races=4)
        second["teams"]["A"]["players"].pop("1111-2222-0000")
        self.import_document(second)
        with self.database.SessionLocal() as session:
            audit = self.audit(session)
        self.assertEqual(audit["team_races"], 8)
        self.assertEqual(audit["team_gps"], 2)
        self.assertEqual(len(audit["matches"]), 2)
        self.assertEqual(audit["matches"][1]["races"], [])
        self.assertEqual(audit["matches"][1]["roles"]["runner"]["points"], 0)

    def test_aggregate_gp_and_total_entries_expose_inclusive_dc_points(self):
        self.import_document(aggregate_document("gp", 1))
        self.import_document(aggregate_document("totals", 2))
        with self.database.SessionLocal() as session:
            audit = self.audit(session, "1111-2222-3330")
        self.assertTrue(audit["reconciled"])
        self.assertEqual((audit["team_gps"], audit["team_races"]), (6, 24))
        self.assertEqual(audit["player"]["runner_points"], 240)
        for match in audit["matches"]:
            self.assertEqual(match["source"], "unaccounted")
            self.assertEqual(match["races"], [])
            self.assertEqual(match["roles"]["runner"], {"points": 120, "races": 12})
            self.assertTrue(
                all(row["disconnection_points"] == 2 for row in match["aggregate_entries"])
            )

    def test_cross_scope_entry_is_rejected(self):
        self.import_document(race_document())
        with self.database.SessionLocal() as session:
            player_id, entry_id = self.selected(session)
            with self.assertRaisesRegex(ValueError, "not part"):
                get_standings_audit(
                    session,
                    league="ctc",
                    season="s99",
                    division="d1",
                    player_id=player_id,
                    team_season_entry_id=entry_id + 99,
                )

    def test_public_endpoint_requires_a_valid_scoped_entry(self):
        from app import app

        self.import_document(race_document())
        with self.database.SessionLocal() as session:
            player_id, entry_id = self.selected(session)
        client = app.test_client()
        query = "league=ctc&season=s99&division=d1"
        with patch("routes.public.stats.SessionLocal", self.database.SessionLocal):
            for suffix in ("", "&player_id=abc", f"&player_id={player_id}"):
                self.assertEqual(
                    client.get(f"/api/standings/audit?{query}{suffix}").status_code, 400
                )
            response = client.get(
                f"/api/standings/audit?{query}&player_id={player_id}&team_season_entry_id={entry_id}"
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["reconciled"])
        self.assertEqual(response.json["player"]["team_season_entry_id"], entry_id)


if __name__ == "__main__":
    unittest.main()
