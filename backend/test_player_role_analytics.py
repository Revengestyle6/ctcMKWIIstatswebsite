import unittest
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import RacePlayerResult
from player_role_analytics import (
    bagger_counterpart_summary,
    classify_role,
    confirmed_5v5_race_ids,
    normalize_role,
    role_coverage,
    summarize_role_rows,
    valid_race_score,
)


def result(
    *,
    score=None,
    position=None,
    role="unknown",
    role_source="unknown",
    race_id=1,
    match_team_id=1,
    player_id=1,
):
    return SimpleNamespace(
        score=score,
        position=position,
        role=role,
        role_source=role_source,
        race_id=race_id,
        match_team_id=match_team_id,
        player_id=player_id,
    )


class RoleAnalyticsTests(unittest.TestCase):
    def test_normalize_role_defaults_and_validates(self):
        self.assertEqual(normalize_role(None), "runner")
        self.assertEqual(normalize_role("  "), "runner")
        self.assertEqual(normalize_role(" RUNNER "), "runner")
        self.assertEqual(normalize_role(" BaGgEr "), "bagger")

        for value in ("all", "unknown", 1):
            with self.subTest(value=value):
                with self.assertRaisesRegex(
                    ValueError, r"^role must be runner or bagger\.$"
                ):
                    normalize_role(value)

    def test_valid_race_score_requires_numeric_value_in_range(self):
        for score in (0, 1, 4.5, 15):
            with self.subTest(score=score):
                self.assertTrue(valid_race_score(score))

        for score in (None, -1, 16, "4", True, float("nan"), float("inf")):
            with self.subTest(score=score):
                self.assertFalse(valid_race_score(score))

    def test_stored_roles_are_authoritative_and_strictly_separated(self):
        stored_runner = result(
            role="runner", role_source="manual", position=10, race_id=1
        )
        stored_bagger = result(
            role="bagger", role_source="inferred", position=1, race_id=1
        )

        self.assertEqual(classify_role(stored_runner, {1}), ("runner", "explicit"))
        self.assertEqual(classify_role(stored_bagger, {1}), ("bagger", "inferred"))

        classified = [
            (stored_runner, "runner", "explicit"),
            (stored_bagger, "bagger", "inferred"),
        ]
        self.assertEqual(summarize_role_rows(classified, "runner")["total_points"], 0)
        self.assertEqual(summarize_role_rows(classified, "bagger")["races"], 1)

    def test_unknown_roles_infer_only_for_confirmed_5v5_placements(self):
        cases = ((1, "runner"), (8, "runner"), (9, "bagger"), (10, "bagger"))
        for position, expected in cases:
            with self.subTest(position=position):
                row = result(position=position, race_id=7)
                self.assertEqual(classify_role(row, {7}), (expected, "inferred"))

        for position in (None, 0, 11):
            with self.subTest(position=position):
                row = result(position=position, race_id=7)
                self.assertEqual(classify_role(row, {7}), ("unknown", "unknown"))

        self.assertEqual(
            classify_role(result(position=9, race_id=8), {7}),
            ("unknown", "unknown"),
        )

    def test_role_coverage_counts_sources_and_returns_classified_rows(self):
        rows = [
            result(role="runner", role_source="manual", player_id=1),
            result(role="runner", role_source="inferred", player_id=2),
            result(role="bagger", role_source="manual", player_id=3),
            result(position=10, race_id=1, player_id=4),
            result(position=4, race_id=2, player_id=5),
        ]

        coverage, classified = role_coverage(rows, {1})

        self.assertEqual(
            coverage,
            {
                "explicit_runner": 1,
                "inferred_runner": 1,
                "explicit_bagger": 1,
                "inferred_bagger": 1,
                "unknown": 1,
                "total": 5,
                "known_rate": 80.0,
            },
        )
        self.assertEqual(classified[-1], (rows[-1], "unknown", "unknown"))

    def test_runner_summary_excludes_baggers_and_invalid_scores(self):
        rows = [
            (result(score=15, position=1, role="runner"), "runner", "explicit"),
            (result(score=12, position=3, role="runner"), "runner", "explicit"),
            (result(score=99, position=4, role="runner"), "runner", "explicit"),
            (result(score=None, position=None, role="runner"), "runner", "explicit"),
            (result(score=4, position=7, role="bagger"), "bagger", "explicit"),
        ]

        summary = summarize_role_rows(rows, "runner")

        self.assertEqual(summary["role"], "runner")
        self.assertEqual(summary["races"], 4)
        self.assertEqual(summary["scored_races"], 2)
        self.assertEqual(summary["total_points"], 27)
        self.assertEqual(summary["points_per_race"], 13.5)
        self.assertEqual(summary["twelve_race_pace"], 162.0)
        self.assertEqual(summary["average_placement"], 2.67)
        self.assertEqual(summary["excluded_score_rows"], 1)
        self.assertEqual(summary["wins"], 1)
        self.assertEqual(summary["podiums"], 2)
        self.assertEqual(summary["podium_rate"], 100.0)

    def test_bagger_summary_counts_any_positive_valid_score_as_bag_point(self):
        rows = [
            (result(score=0, position=10), "bagger", "explicit"),
            (result(score=1, position=9), "bagger", "explicit"),
            (result(score=4, position=7), "bagger", "explicit"),
            (result(score=-1, position=10), "bagger", "explicit"),
            (result(score=None, position=None), "bagger", "explicit"),
            (result(score=12, position=2), "runner", "explicit"),
        ]

        summary = summarize_role_rows(rows, "bagger")

        self.assertEqual(summary["races"], 5)
        self.assertEqual(summary["scored_races"], 3)
        self.assertEqual(summary["total_points"], 5)
        self.assertEqual(summary["points_per_race"], 1.67)
        self.assertEqual(summary["average_placement"], 9.0)
        self.assertEqual(summary["excluded_score_rows"], 1)
        self.assertEqual(summary["bag_points"], 2)
        self.assertEqual(summary["bag_point_rate"], 66.67)
        self.assertEqual(summary["zero_points"], 1)
        self.assertEqual(summary["zero_point_rate"], 33.33)

    def test_empty_role_summary_uses_none_for_averages_and_rates(self):
        runner = summarize_role_rows([], "runner")
        bagger = summarize_role_rows([], "bagger")

        self.assertIsNone(runner["points_per_race"])
        self.assertIsNone(runner["average_placement"])
        self.assertIsNone(runner["podium_rate"])
        self.assertIsNone(bagger["bag_point_rate"])
        self.assertIsNone(bagger["zero_point_rate"])

    def test_runner_pace_rounds_after_projection(self):
        rows = [
            (result(score=1, position=4), "runner", "explicit"),
            (result(score=0, position=5), "runner", "explicit"),
            (result(score=0, position=6), "runner", "explicit"),
        ]

        self.assertEqual(summarize_role_rows(rows, "runner")["twelve_race_pace"], 4.0)


class DatabaseRoleAnalyticsTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", future=True)
        with self.engine.connect() as connection:
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        RacePlayerResult.__table__.create(self.engine)
        self.session = sessionmaker(bind=self.engine, future=True)()
        self.next_result_id = 1

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def add_race(
        self,
        race_id,
        *,
        team_sizes=(5, 5),
        bagger_scores=(0, 0),
        selected_player_id=None,
        extra_baggers=(),
        duplicate_player_team=None,
    ):
        rows = []
        for team_offset, team_size in enumerate(team_sizes):
            team_id = 100 + team_offset
            for slot in range(team_size):
                player_id = race_id * 100 + team_offset * 10 + slot
                if team_offset == 0 and slot == 4 and selected_player_id is not None:
                    player_id = selected_player_id
                if duplicate_player_team == team_offset and slot == team_size - 1:
                    player_id = race_id * 100 + team_offset * 10
                is_bagger = slot == 4 or (team_offset, slot) in extra_baggers
                row = RacePlayerResult(
                    race_player_result_id=self.next_result_id,
                    race_id=race_id,
                    match_player_id=self.next_result_id,
                    player_id=player_id,
                    match_team_id=team_id,
                    team_season_entry_id=team_id,
                    score=bagger_scores[team_offset] if is_bagger else 10,
                    position=9 + team_offset if is_bagger else slot + 1,
                    role="bagger" if is_bagger else "runner",
                    role_source="manual",
                )
                self.next_result_id += 1
                rows.append(row)
        self.session.add_all(rows)
        self.session.flush()
        return rows

    def test_confirmed_5v5_requires_exact_rows_teams_and_distinct_players(self):
        valid_rows = self.add_race(1)
        short_rows = self.add_race(2, team_sizes=(5, 4))
        duplicate_rows = self.add_race(3, duplicate_player_team=1)

        self.assertEqual(
            confirmed_5v5_race_ids(
                self.session, valid_rows + short_rows + duplicate_rows
            ),
            {1},
        )

        self.session.delete(valid_rows[-1])
        self.session.flush()
        self.assertEqual(confirmed_5v5_race_ids(self.session, valid_rows), set())

    def test_counterpart_summary_totals_two_eligible_races(self):
        selected_player_id = 999
        rows = self.add_race(
            1, bagger_scores=(1, 1), selected_player_id=selected_player_id
        )
        rows += self.add_race(
            2, bagger_scores=(4, 0), selected_player_id=selected_player_id
        )
        confirmed = confirmed_5v5_race_ids(self.session, rows)
        _, classified = role_coverage(
            [row for row in rows if row.player_id == selected_player_id], confirmed
        )

        summary = bagger_counterpart_summary(
            self.session, selected_player_id, classified
        )

        self.assertEqual(
            summary,
            {
                "counterpart_races": 2,
                "opponent_points_for": 5,
                "opponent_points_against": 1,
                "opponent_point_differential": 4,
            },
        )
        self.assertNotIn("wins", summary)

    def test_counterpart_disqualifies_missing_multiple_or_invalid_baggers(self):
        selected_player_id = 999
        rows = []
        rows += self.add_race(
            1, bagger_scores=(1, 2), selected_player_id=selected_player_id
        )
        no_opponent = self.add_race(
            2, bagger_scores=(1, 2), selected_player_id=selected_player_id
        )
        no_opponent[-1].role = "runner"
        rows += no_opponent
        rows += self.add_race(
            3,
            bagger_scores=(1, 2),
            selected_player_id=selected_player_id,
            extra_baggers=((1, 3),),
        )
        rows += self.add_race(
            4, bagger_scores=(1, 16), selected_player_id=selected_player_id
        )
        rows += self.add_race(
            5, bagger_scores=(None, 2), selected_player_id=selected_player_id
        )
        self.session.flush()
        confirmed = confirmed_5v5_race_ids(self.session, rows)
        _, classified = role_coverage(
            [row for row in rows if row.player_id == selected_player_id], confirmed
        )

        summary = bagger_counterpart_summary(
            self.session, selected_player_id, classified
        )

        self.assertEqual(summary["counterpart_races"], 1)
        self.assertEqual(summary["opponent_points_for"], 1)
        self.assertEqual(summary["opponent_points_against"], 2)
        self.assertEqual(summary["opponent_point_differential"], -1)


if __name__ == "__main__":
    unittest.main()
