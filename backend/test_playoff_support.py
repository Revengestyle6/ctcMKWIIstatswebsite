import unittest

from test_support import PostgreSQLTestDatabase, configure_test_environment

configure_test_environment()

from import_json_to_db import detect_new_entries  # noqa: E402
from match_sets import apply_match_set  # noqa: E402
from models import (  # noqa: E402
    Division,
    Match,
    MatchTeam,
    Season,
    SourceFile,
    Team,
    TeamLeagueIdentity,
    TeamSeasonEntry,
)
from playoff_service import resolve_playoff_series, validate_competition_metadata  # noqa: E402
from sqlalchemy import func, select  # noqa: E402


class PlayoffSupportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = PostgreSQLTestDatabase()
        cls.SessionLocal = cls.database.SessionLocal

    @classmethod
    def tearDownClass(cls):
        cls.database.close()

    def setUp(self):
        with self.SessionLocal.begin() as session:
            season = Season(
                league_code="ctc",
                season_code="s3",
                season_number=3,
                name="Season 3",
                status="active",
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
            self.team_ids = []
            self.entry_ids = {}
            for tag in ("A", "B", "C", "D"):
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
                session.add(TeamLeagueIdentity(team_id=team.team_id, league_code="ctc", tag=tag))
                session.flush()
                self.team_ids.append(team.team_id)
                self.entry_ids[team.team_id] = entry.team_season_entry_id

    def tearDown(self):
        for table in reversed(list(Season.metadata.sorted_tables)):
            with self.database.engine.begin() as connection:
                connection.execute(table.delete())

    @staticmethod
    def metadata(stage="semifinals", series=1, match_number=1, format_code="four_team"):
        return {
            "match_type": "playoff",
            "playoff_format": format_code,
            "playoff_stage": stage,
            "playoff_series_number": series,
            "series_match_number": match_number,
            "best_of": 3,
            "teams": {"A": {"total_score": 101}, "B": {"total_score": 99}},
        }

    def add_series_match(self, session, series, number, first_score, second_score):
        source = SourceFile(
            season_id=self.season_id,
            division_id=self.division_id,
            source_path=f"test/{series.playoff_series_id}-{number}.json",
            source_filename=f"{number}.json",
            file_sha256=f"hash-{series.playoff_series_id}-{number}",
            json_shape="single_match",
        )
        session.add(source)
        session.flush()
        match = Match(
            season_id=self.season_id,
            division_id=self.division_id,
            source_file_id=source.source_file_id,
            match_type="playoff",
            playoff_series_id=series.playoff_series_id,
            series_match_number=number,
            match_label=f"{series.display_label} — Match {number}",
            races_played=12,
        )
        session.add(match)
        session.flush()
        for team_id, score in zip(self.team_ids[:2], (first_score, second_score)):
            session.add(
                MatchTeam(
                    match_id=match.match_id,
                    team_season_entry_id=self.entry_ids[team_id],
                    raw_team_key=str(team_id),
                    raw_total_score=score,
                    final_score=score,
                )
            )
        session.flush()

    def test_metadata_rejects_playoff_week_even_best_of_and_tie(self):
        match = self.metadata()
        match["match_number"] = 4
        with self.assertRaisesRegex(ValueError, "do not have a regular-season match number"):
            validate_competition_metadata(match)
        match.pop("match_number")
        match["best_of"] = 4
        with self.assertRaisesRegex(ValueError, "odd"):
            validate_competition_metadata(match)
        match["best_of"] = 3
        match["teams"]["A"]["total_score"] = 99
        with self.assertRaisesRegex(ValueError, "cannot end in a tie"):
            validate_competition_metadata(match)

    def test_new_division_still_requires_explicit_playoff_format_approval(self):
        match = self.metadata()
        match.update({"league": "ctc", "season": "s4", "division": "d9"})
        with self.SessionLocal() as session:
            entries = detect_new_entries(session, match)
        self.assertIn("playoff_format", {entry["type"] for entry in entries})

    def test_series_pairing_is_immutable_and_team_cannot_enter_other_semifinal(self):
        with self.SessionLocal.begin() as session:
            division = session.get(Division, self.division_id)
            resolve_playoff_series(
                session, self.season_id, division, self.metadata(), self.team_ids[:2]
            )
            with self.assertRaisesRegex(ValueError, "do not match"):
                resolve_playoff_series(
                    session,
                    self.season_id,
                    division,
                    self.metadata(),
                    self.team_ids[2:],
                )
            with self.assertRaisesRegex(ValueError, "already assigned"):
                resolve_playoff_series(
                    session,
                    self.season_id,
                    division,
                    self.metadata(series=2),
                    [self.team_ids[0], self.team_ids[2]],
                )

    def test_editor_database_check_rejects_duplicate_number_format_and_pairing(self):
        first_match = self.metadata(format_code="three_team")
        first_match.update({"league": "ctc", "season": "s3", "division": "d1"})
        with self.SessionLocal.begin() as session:
            division = session.get(Division, self.division_id)
            series, _ = resolve_playoff_series(
                session, self.season_id, division, first_match, self.team_ids[:2]
            )
            self.add_series_match(session, series, 1, 101, 99)

        with self.SessionLocal() as session:
            with self.assertRaisesRegex(ValueError, "Match 1 already exists"):
                detect_new_entries(session, first_match)

            wrong_format = {**first_match, "playoff_format": "four_team", "series_match_number": 2}
            with self.assertRaisesRegex(ValueError, "already locked as three_team"):
                detect_new_entries(session, wrong_format)

            wrong_pairing = {
                **first_match,
                "series_match_number": 2,
                "teams": {"C": {"total_score": 101}, "D": {"total_score": 99}},
            }
            with self.assertRaisesRegex(ValueError, "do not match"):
                detect_new_entries(session, wrong_pairing)

    def test_clinched_series_rejects_another_match(self):
        with self.SessionLocal.begin() as session:
            division = session.get(Division, self.division_id)
            series, _ = resolve_playoff_series(
                session, self.season_id, division, self.metadata(), self.team_ids[:2]
            )
            self.add_series_match(session, series, 1, 101, 99)
            series, _ = resolve_playoff_series(
                session,
                self.season_id,
                division,
                self.metadata(match_number=2),
                self.team_ids[:2],
            )
            self.add_series_match(session, series, 2, 105, 95)
            with self.assertRaisesRegex(ValueError, "already been clinched"):
                resolve_playoff_series(
                    session,
                    self.season_id,
                    division,
                    self.metadata(match_number=3),
                    self.team_ids[:2],
                )

    def test_missing_earlier_series_match_can_be_reuploaded_after_later_matches(self):
        with self.SessionLocal.begin() as session:
            division = session.get(Division, self.division_id)
            series, _ = resolve_playoff_series(
                session, self.season_id, division, self.metadata(), self.team_ids[:2]
            )
            self.add_series_match(session, series, 2, 101, 99)
            self.add_series_match(session, series, 3, 105, 95)

            resolved, metadata = resolve_playoff_series(
                session, self.season_id, division, self.metadata(), self.team_ids[:2]
            )

            self.assertEqual(resolved.playoff_series_id, series.playoff_series_id)
            self.assertEqual(metadata["series_match_number"], 1)

    def test_match_set_defaults_can_separate_regular_playoff_and_all(self):
        with self.SessionLocal.begin() as session:
            division = session.get(Division, self.division_id)
            series, _ = resolve_playoff_series(
                session, self.season_id, division, self.metadata(), self.team_ids[:2]
            )
            self.add_series_match(session, series, 1, 101, 99)
            source = SourceFile(
                season_id=self.season_id,
                division_id=self.division_id,
                source_path="test/regular.json",
                source_filename="regular.json",
                file_sha256="regular-hash",
                json_shape="single_match",
            )
            session.add(source)
            session.flush()
            session.add(
                Match(
                    season_id=self.season_id,
                    division_id=self.division_id,
                    source_file_id=source.source_file_id,
                    match_type="regular",
                    match_number=1,
                    match_label="W1 A B",
                    races_played=12,
                )
            )
            session.flush()
            base = select(func.count()).select_from(Match)
            self.assertEqual(session.scalar(apply_match_set(base, None)), 1)
            self.assertEqual(session.scalar(apply_match_set(base, "playoffs")), 1)
            self.assertEqual(session.scalar(apply_match_set(base, "all")), 2)


if __name__ == "__main__":
    unittest.main()
