import unittest
from unittest.mock import patch

from test_support import PostgreSQLTestDatabase, configure_test_environment

configure_test_environment()

from import_json_to_db import validate_conference_matchup  # noqa: E402
from match_results import validate_result_metadata  # noqa: E402
from models import (  # noqa: E402
    Division,
    DivisionConference,
    DivisionPlayoffConfig,
    Match,
    MatchTeam,
    Season,
    SourceFile,
    Team,
    TeamSeasonEntry,
)
from review_queue import validate_submission  # noqa: E402
from sqlalchemy import select  # noqa: E402
from standings_service import (  # noqa: E402
    _race_equivalent_gps,
    _rank_records,
    _role_eligibility,
    _role_gp_average,
    get_division_standings,
)
from team_competition import update_team_competition_status  # noqa: E402


class RoleGpEligibilityTests(unittest.TestCase):
    def test_role_gp_count_uses_fractional_race_equivalents(self):
        self.assertEqual(_race_equivalent_gps(11), 2.75)
        self.assertEqual(_race_equivalent_gps(12), 3)

    def test_fractional_role_gps_control_eligibility(self):
        eligible, reason = _role_eligibility("active", "runner", 2.75, 3)
        self.assertFalse(eligible)
        self.assertIn("2.75 of 3", reason)
        self.assertEqual(_role_eligibility("active", "runner", 3, 3), (True, None))

    def test_role_average_treats_each_four_role_races_as_one_gp(self):
        self.assertEqual(_role_gp_average(1088, 132), 32.97)
        self.assertEqual(_role_gp_average(30, 11), 10.91)
        self.assertEqual(_role_gp_average(30, 12), 10.0)
        self.assertIsNone(_role_gp_average(0, 0))


class ConferenceTiebreakTests(unittest.TestCase):
    def test_cross_conference_tie_uses_series_wins_and_normalized_differential(self):
        def record(entry_id, conference_id):
            return {
                "team_season_entry_id": entry_id,
                "name": f"Team {entry_id}",
                "standings_points": 10,
                "wins": 2,
                "ties": 0,
                "losses": 1,
                "points_for": 300,
                "points_against": 300,
                "point_differential": 0,
                "head_to_head_differential": 0,
                "conference": {
                    "id": conference_id,
                    "code": str(conference_id),
                    "name": f"Conference {conference_id}",
                    "sort_order": conference_id,
                },
            }

        records = {1: record(1, 1), 2: record(2, 1), 3: record(3, 2)}

        def match(left, right, differential):
            return {
                "teams": [
                    {
                        "team_season_entry_id": left,
                        "standings_points": 3 if differential > 0 else 0,
                        "outcome": "win" if differential > 0 else "loss",
                        "adjusted_score": 100 + differential,
                        "adjusted_opponent_score": 100,
                    },
                    {
                        "team_season_entry_id": right,
                        "standings_points": 0 if differential > 0 else 3,
                        "outcome": "loss" if differential > 0 else "win",
                        "adjusted_score": 100,
                        "adjusted_opponent_score": 100 + differential,
                    },
                ]
            }

        matches = [
            match(1, 2, 50),
            match(1, 2, 30),
            match(2, 3, 10),
            match(3, 1, 60),
        ]
        ordered = _rank_records(records, matches)
        self.assertEqual([row["team_season_entry_id"] for row in ordered], [3, 1, 2])
        self.assertEqual(records[1]["tiebreak"]["series_wins"], 1)
        self.assertEqual(records[1]["tiebreak"]["series_average_differential"], -20)
        self.assertEqual(records[2]["tiebreak"]["series_average_differential"], -30)
        self.assertEqual(records[3]["tiebreak"]["series_average_differential"], 50)


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
            for table in [
                MatchTeam,
                Match,
                SourceFile,
                TeamSeasonEntry,
                DivisionConference,
                DivisionPlayoffConfig,
                Team,
                Division,
                Season,
            ]:
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

    def test_mutual_tie_counts_as_tie_without_score_or_standings_points(self):
        self.add_match(1, "A", 0, "B", 0, "mutual_tie")

        data = self.standings()
        rows = {row["tag"]: row for row in data["standings"]}
        for tag in ("A", "B"):
            self.assertEqual(rows[tag]["ties"], 1)
            self.assertEqual(rows[tag]["standings_points"], 0)
            self.assertEqual(rows[tag]["points_for"], 0)
            self.assertEqual(rows[tag]["points_against"], 0)
            self.assertEqual(rows[tag]["point_differential"], 0)

        match = data["matches"][0]
        self.assertEqual(match["result_type"], "mutual_tie")
        self.assertFalse(match["standings_adjusted"])
        self.assertEqual(
            [
                (team["adjusted_score"], team["standings_points"], team["outcome"])
                for team in match["teams"]
            ],
            [(0, 0, "tie"), (0, 0, "tie")],
        )

    def test_conference_tables_and_four_team_playoff_seeding(self):
        with self.database.SessionLocal.begin() as session:
            division = session.get(Division, self.division_id)
            division.is_conference_based = True
            conference_a = DivisionConference(
                division_id=self.division_id,
                conference_code="a",
                conference_name="Gold Conference",
                sort_order=1,
            )
            conference_b = DivisionConference(
                division_id=self.division_id,
                conference_code="b",
                conference_name="Silver Conference",
                sort_order=2,
            )
            session.add_all((conference_a, conference_b))
            session.flush()
            for tag in ("D", "E", "F", "G", "H"):
                team = Team(canonical_name=f"Team {tag}", canonical_tag=tag)
                session.add(team)
                session.flush()
                entry = TeamSeasonEntry(
                    team_id=team.team_id,
                    season_id=self.season_id,
                    division_id=self.division_id,
                    display_name=f"Team {tag}",
                    clan_tag=tag,
                )
                session.add(entry)
                session.flush()
                self.entries[tag] = entry.team_season_entry_id
            for tag in ("A", "B", "C", "D"):
                session.get(
                    TeamSeasonEntry, self.entries[tag]
                ).conference_id = conference_a.division_conference_id
            for tag in ("E", "F", "G", "H"):
                session.get(
                    TeamSeasonEntry, self.entries[tag]
                ).conference_id = conference_b.division_conference_id
            session.add(
                DivisionPlayoffConfig(
                    division_id=self.division_id,
                    format_code="four_team",
                    playoff_team_count=4,
                    semifinal_series_count=2,
                    finals_bye_count=0,
                )
            )

        data = self.standings()
        self.assertTrue(data["conference_config"]["valid"])
        self.assertEqual(
            [conference["name"] for conference in data["conferences"]],
            ["Gold Conference", "Silver Conference"],
        )
        self.assertEqual(
            [[row["tag"] for row in conference["standings"]] for conference in data["conferences"]],
            [["A", "B", "C", "D"], ["E", "F", "G", "H"]],
        )
        seeds = data["playoff_qualification"]["seeds"]
        self.assertEqual([seed["tag"] for seed in seeds], ["A", "E", "B", "C"])
        self.assertEqual(
            [seed["qualification"] for seed in seeds],
            ["conference_winner", "conference_winner", "wild_card", "wild_card"],
        )
        self.assertEqual(data["playoff_qualification"]["semifinals"], [[1, 4], [2, 3]])

        with self.database.SessionLocal() as session:
            division = session.get(Division, self.division_id)
            validate_conference_matchup(
                session,
                division,
                [
                    session.get(TeamSeasonEntry, self.entries["A"]),
                    session.get(TeamSeasonEntry, self.entries["E"]),
                ],
            )
        self.add_match(1, "A", 100, "E", 90)
        with self.database.SessionLocal() as session:
            division = session.get(Division, self.division_id)
            with self.assertRaisesRegex(ValueError, "cross-conference matchup"):
                validate_conference_matchup(
                    session,
                    division,
                    [
                        session.get(TeamSeasonEntry, self.entries["A"]),
                        session.get(TeamSeasonEntry, self.entries["E"]),
                    ],
                )
        self.add_match(2, "A", 100, "B", 90)
        with self.database.SessionLocal() as session:
            validate_conference_matchup(
                session,
                session.get(Division, self.division_id),
                [
                    session.get(TeamSeasonEntry, self.entries["A"]),
                    session.get(TeamSeasonEntry, self.entries["B"]),
                ],
            )
        self.add_match(3, "A", 95, "B", 90)
        with self.database.SessionLocal() as session:
            with self.assertRaisesRegex(ValueError, "same-conference matchup"):
                validate_conference_matchup(
                    session,
                    session.get(Division, self.division_id),
                    [
                        session.get(TeamSeasonEntry, self.entries["A"]),
                        session.get(TeamSeasonEntry, self.entries["B"]),
                    ],
                )


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
