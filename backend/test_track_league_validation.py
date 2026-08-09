import unittest
from unittest.mock import patch

from test_support import PostgreSQLTestDatabase, configure_test_environment

configure_test_environment()

import stats_queries  # noqa: E402
from import_json_to_db import detect_new_entries, get_or_create_track  # noqa: E402
from models import Track, TrackAlias  # noqa: E402


class TrackLeagueValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = PostgreSQLTestDatabase()
        cls.SessionLocal = cls.database.SessionLocal

    @classmethod
    def tearDownClass(cls):
        cls.database.close()

    def setUp(self):
        with self.SessionLocal.begin() as session:
            custom_track = Track(league_code="ctc", canonical_name="Custom Course")
            base_track = Track(league_code="gsc", canonical_name="Luigi Circuit")
            session.add_all((custom_track, base_track))
            session.flush()
            session.add_all(
                (
                    TrackAlias(track_id=custom_track.track_id, alias_value="CC"),
                    TrackAlias(track_id=base_track.track_id, alias_value="LC"),
                )
            )

    def tearDown(self):
        for table in reversed(list(Track.metadata.sorted_tables)):
            with self.database.engine.begin() as connection:
                connection.execute(table.delete())

    @staticmethod
    def match(league, track):
        return {
            "league": league,
            "season": "s1",
            "division": "d1",
            "match_label": "W1 Test",
            "tracks": [track],
            "teams": {},
        }

    def test_opposite_league_canonical_name_and_alias_are_rejected(self):
        with self.SessionLocal() as session:
            with self.assertRaisesRegex(ValueError, "registered for GSC"):
                detect_new_entries(session, self.match("ctc", "Luigi Circuit"))
            with self.assertRaisesRegex(ValueError, "registered for GSC"):
                detect_new_entries(session, self.match("ctc", "LC"))
            with self.assertRaisesRegex(ValueError, "registered for CTC"):
                detect_new_entries(session, self.match("gsc", "Custom Course"))

    def test_unknown_gsc_track_enters_the_normal_approval_flow(self):
        with self.SessionLocal() as session:
            entries = detect_new_entries(session, self.match("gsc", "Mario Circuit"))
        track_entry = next(entry for entry in entries if entry["type"] == "track")
        self.assertEqual(track_entry["kind"], "new_track")
        self.assertEqual(track_entry["league"], "gsc")
        self.assertEqual(track_entry["key"], "track:gsc:mario circuit")

        with self.SessionLocal.begin() as session:
            track = get_or_create_track(session, "gsc", "Mario Circuit")
            self.assertEqual(track.league_code, "gsc")

    def test_search_is_scoped_but_can_include_conflicts_for_editor_validation(self):
        with patch.object(stats_queries, "SessionLocal", self.SessionLocal):
            gsc_tracks = stats_queries.search_tracks(league_code="gsc")
            validation_catalog = stats_queries.search_tracks(
                league_code="gsc", include_other_leagues=True
            )
        self.assertEqual([track["name"] for track in gsc_tracks], ["Luigi Circuit"])
        self.assertEqual(
            {(track["league"], track["name"]) for track in validation_catalog},
            {("ctc", "Custom Course"), ("gsc", "Luigi Circuit")},
        )
        luigi = next(track for track in validation_catalog if track["name"] == "Luigi Circuit")
        self.assertEqual(luigi["aliases"], ["LC"])
