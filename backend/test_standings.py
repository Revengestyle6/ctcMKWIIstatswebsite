import unittest
from unittest.mock import patch

from test_support import PostgreSQLTestDatabase, configure_test_environment

configure_test_environment()

from match_results import validate_result_metadata  # noqa: E402
from models import (  # noqa: E402
    Division,
    Match,
    MatchTeam,
    Season,
    SourceFile,
    Team,
    TeamSeasonEntry,
)
from review_queue import validate_submission  # noqa: E402
from sqlalchemy import select  # noqa: E402
from standings_service import _qualifying_role_gp_counts, get_division_standings  # noqa: E402
from team_competition import update_team_competition_status  # noqa: E402


class RoleGpEligibilityTests(unittest.TestCase):
    def test_counts_gps_when_at_least_half_the_races_match_the_role(self):
        team_gp_races = {
            (1, 1): {1, 2, 3, 4},
            (1, 2): {5, 6, 7, 8},
            (1, 3): {9, 10, 11, 12},
            (2, 1): {13, 14, 15, 16},
        }
        player_gp_roles = {
            (1, 1): {1: "runner", 2: "runner", 3: "bagger", 4: "bagger"},
            (1, 2): {5: "bagger", 6: "bagger", 7: "bagger", 8: "runner"},
            (1, 3): {9: "runner", 10: "bagger", 11: "unknown", 12: "unknown"},
            (2, 1): {13: "runner", 14: "runner"},
        }

        self.assertEqual(
            _qualifying_role_gp_counts(team_gp_races, player_gp_roles),
            {"runner": 2, "bagger": 2},
        )


class StandingsServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = PostgreSQLTestDatabase()

    @classmethod
    def tearDownClass(cls):
        cls.database.close()

    def setUp(self):
        with self.database.SessionLocal.begin() as session:
            season = Season(
                league_code="gsc", season_code="s99", season_number=99, name="Season 99"
            )
            session.add(season)
            session.flush()
            division = Division(
                season_id=season.season_id, division_code="d1", division_name="Division 1"
            )
            session.add(division)
            session.flush()
            self.season_id = season.season_id
            self.division_id = division.division_id
            self.entries = {}
            for tag in ("A", "B", "C"):
                team = Team(canonical_name=f"Team {tag}", canonical_tag=tag)
                session.add(team)
                session.flush()
                entry = TeamSeasonEntry(
                    team_id=team.team_id,
                    season_id=season.season_id,
                    division_id=division.division_id,
                    display_name=f"Team {tag}",
                    clan_tag=tag,
                )
                session.add(entry)
                session.flush()
                self.entries[tag] = entry.team_season_entry_id

    def tearDown(self):
        with self.database.SessionLocal.begin() as session:
            for table in [MatchTeam, Match, SourceFile, TeamSeasonEntry, Team, Division, Season]:
                session.query(table).delete()

    def add_match(self, number, left, left_score, right, right_score, result_type="played"):
        with self.database.SessionLocal.begin() as session:
            source = SourceFile(
                season_id=self.season_id,
                division_id=self.division_id,
                source_path=f"test/{number}-{left}-{right}.json",
                source_filename=f"{number}.json",
                file_sha256=f"{number}-{left}-{right}",
                json_shape="single_match",
            )
            session.add(source)
            session.flush()
            match = Match(
                season_id=self.season_id,
                division_id=self.division_id,
                source_file_id=source.source_file_id,
                match_number=number,
                match_label=f"M{number} {left} vs {right}",
                match_type="regular",
                result_type=result_type,
                format="5v5",
                races_played=0 if result_type != "played" else 12,
            )
            session.add(match)
            session.flush()
            for tag, score in ((left, left_score), (right, right_score)):
                session.add(
                    MatchTeam(
                        match_id=match.match_id,
                        team_season_entry_id=self.entries[tag],
                        raw_team_key=tag,
                        raw_total_score=score,
                        final_score=score,
                    )
                )

    def standings(self):
        with self.database.SessionLocal() as session:
            return get_division_standings(session, league="gsc", season="s99", division="d1")

    def test_points_bonus_tie_and_special_results(self):
        self.add_match(1, "A", 100, "B", 85)
        self.add_match(2, "B", 75, "C", 75)
        self.add_match(3, "A", 150, "C", 0, "free_win")
        rows = {row["tag"]: row for row in self.standings()["standings"]}
        self.assertEqual(rows["A"]["standings_points"], 6)
        self.assertEqual(rows["B"]["standings_points"], 3)
        self.assertEqual(rows["C"]["standings_points"], 2)
        self.assertEqual(rows["B"]["bonus_points"], 1)
        self.assertEqual((rows["A"]["points_for"], rows["A"]["points_against"]), (250, 85))

    def test_dropped_team_rewrites_only_standings_scores(self):
        self.add_match(1, "A", 91, "B", 109)
        with self.database.SessionLocal.begin() as session:
            update_team_competition_status(
                session,
                self.entries["B"],
                {"status": "dropped", "note": "Withdrew from the division"},
            )
            preserved_scores = session.scalars(
                select(MatchTeam.final_score).order_by(MatchTeam.final_score)
            ).all()
            self.assertEqual(preserved_scores, [91, 109])
        data = self.standings()
        rows = {row["tag"]: row for row in data["standings"]}
        self.assertEqual((rows["A"]["points_for"], rows["A"]["points_against"]), (150, 0))
        self.assertEqual(rows["A"]["standings_points"], 3)
        result = data["matches"][0]
        self.assertTrue(result["standings_adjusted"])
        team_a = next(team for team in result["teams"] if team["tag"] == "A")
        self.assertEqual((team_a["original_score"], team_a["adjusted_score"]), (91, 150))

        with self.database.SessionLocal.begin() as session:
            update_team_competition_status(
                session, self.entries["B"], {"status": "active", "note": ""}
            )
            restored_entry = session.get(TeamSeasonEntry, self.entries["B"])
            self.assertEqual(restored_entry.competition_status, "active")
            self.assertIsNone(restored_entry.competition_status_note)

        restored = self.standings()
        restored_rows = {row["tag"]: row for row in restored["standings"]}
        self.assertEqual(
            (restored_rows["A"]["points_for"], restored_rows["A"]["points_against"]),
            (91, 109),
        )
        self.assertEqual(restored_rows["A"]["standings_points"], 1)
        self.assertEqual(restored_rows["B"]["standings_points"], 3)
        self.assertFalse(restored["matches"][0]["standings_adjusted"])


class SpecialResultValidationTests(unittest.TestCase):
    def test_metadata_only_free_win_is_valid(self):
        payload = {
            "match_type": "regular",
            "result_type": "free_win",
            "races_played": 0,
            "tracks": [],
            "teams": {
                "A": {"total_score": 150, "players": {}},
                "B": {"total_score": 0, "players": {}},
            },
        }
        self.assertEqual(validate_result_metadata(payload), "free_win")

    def test_mutual_tie_rejects_nonzero_score(self):
        payload = {
            "match_type": "regular",
            "result_type": "mutual_tie",
            "races_played": 0,
            "tracks": [],
            "teams": {"A": {"total_score": 1}, "B": {"total_score": 0}},
        }
        with self.assertRaisesRegex(ValueError, "0-0"):
            validate_result_metadata(payload)

    def test_special_results_reject_penalties(self):
        for result_type, scores in (
            ("free_win", (150, 0)),
            ("mutual_tie", (0, 0)),
        ):
            with self.subTest(result_type=result_type):
                payload = {
                    "match_type": "regular",
                    "result_type": result_type,
                    "races_played": 0,
                    "tracks": [],
                    "teams": {
                        "A": {"total_score": scores[0], "penalties": 5},
                        "B": {"total_score": scores[1]},
                    },
                }
                with self.assertRaisesRegex(ValueError, "cannot contain penalties"):
                    validate_result_metadata(payload)

    def test_review_queue_does_not_warn_about_expected_zero_races(self):
        for result_type, scores in (
            ("free_win", (150, 0)),
            ("mutual_tie", (0, 0)),
        ):
            with self.subTest(result_type=result_type):
                payload = {
                    "league": "gsc",
                    "season": "s15",
                    "division": "d1",
                    "match_type": "regular",
                    "result_type": result_type,
                    "match_number": 99,
                    "races_played": 0,
                    "tracks": [],
                    "teams": {
                        "A": {"total_score": scores[0], "players": {}},
                        "B": {"total_score": scores[1], "players": {}},
                    },
                }
                with patch("review_queue.detect_new_entries", return_value=[]):
                    _content, _fingerprint, warnings = validate_submission(None, payload)
                self.assertEqual(warnings, [])


if __name__ == "__main__":
    unittest.main()
