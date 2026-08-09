import unittest

from test_support import PostgreSQLTestDatabase, configure_test_environment

configure_test_environment()

from import_json_to_db import detect_new_entries, get_or_create_team  # noqa: E402
from models import Season, Team, TeamLeagueIdentity  # noqa: E402
from routes.common import unapproved_entries  # noqa: E402


class MatchUploadLeagueTeamValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = PostgreSQLTestDatabase()
        cls.SessionLocal = cls.database.SessionLocal

    @classmethod
    def tearDownClass(cls):
        cls.database.close()

    def setUp(self):
        with self.SessionLocal.begin() as session:
            session.query(TeamLeagueIdentity).delete()
            session.query(Season).delete()
            session.query(Team).delete()
            existing_team = Team(canonical_name="Cosmic Speed", canonical_tag="CS")
            session.add_all(
                [
                    Season(
                        league_code="ctc",
                        season_code="s3",
                        season_number=3,
                        name="CTC Season 3",
                        status="complete",
                    ),
                    existing_team,
                ]
            )
            session.flush()
            session.add(
                TeamLeagueIdentity(
                    team_id=existing_team.team_id,
                    league_code="ctc",
                    tag="CS",
                )
            )
            self.team_id = existing_team.team_id

    @staticmethod
    def match():
        return {
            "league": "gsc",
            "season": "s1",
            "division": "d1",
            "match_label": "GSC first match",
            "match_type": "regular",
            "week": 1,
            "format": "5v5",
            "tracks": [],
            "teams": {"CS": {"players": {}}, "NEW": {"players": {}}},
        }

    def test_first_match_requires_an_explicit_new_league_entry(self):
        with self.SessionLocal() as session:
            entries = detect_new_entries(session, self.match())

        league_entry = next(entry for entry in entries if entry["type"] == "league")
        self.assertEqual(league_entry["kind"], "new_league")
        self.assertEqual(league_entry["key"], "league:gsc")
        self.assertTrue(any(entry["kind"] == "new_season" for entry in entries))

    def test_matching_tag_requires_link_or_create_resolution(self):
        match = self.match()
        with self.SessionLocal() as session:
            entries = detect_new_entries(session, match)
            cross_entry = next(
                entry for entry in entries if entry["kind"] == "cross_league_team_match"
            )
            self.assertEqual(cross_entry["team_candidates"][0]["team_id"], self.team_id)
            approved = {entry["key"] for entry in entries}

            _entries, unapproved, _player_links, team_links = unapproved_entries(
                session,
                match,
                approved,
            )
            self.assertIn(cross_entry["key"], {entry["key"] for entry in unapproved})
            self.assertEqual(team_links, {})

            resolutions = {cross_entry["key"]: {"action": "link", "team_id": self.team_id}}
            resolved_entries, unapproved, _player_links, team_links = unapproved_entries(
                session,
                match,
                approved,
                requested_team_identity_resolutions=resolutions,
            )
            resolved = next(
                entry
                for entry in resolved_entries
                if entry["kind"] == "cross_league_team_match"
            )
            self.assertEqual(resolved["resolution"], resolutions[cross_entry["key"]])
            self.assertEqual(unapproved, [])
            self.assertEqual(team_links, {"cs": self.team_id})

    def test_link_resolution_adds_the_new_league_identity(self):
        with self.SessionLocal.begin() as session:
            linked = get_or_create_team(
                session,
                "gsc",
                "CS",
                "Cosmic Speed",
                linked_team_id=self.team_id,
            )
            self.assertEqual(linked.team_id, self.team_id)
            identities = session.query(TeamLeagueIdentity).filter_by(team_id=self.team_id).all()
            self.assertEqual(
                {(identity.league_code, identity.tag) for identity in identities},
                {("ctc", "CS"), ("gsc", "CS")},
            )

    def test_create_resolution_keeps_the_team_separate(self):
        match = self.match()
        with self.SessionLocal() as session:
            entries = detect_new_entries(session, match)
            cross_entry = next(
                entry for entry in entries if entry["kind"] == "cross_league_team_match"
            )
            approved = {entry["key"] for entry in entries}
            resolutions = {cross_entry["key"]: {"action": "create"}}
            _entries, unapproved, _player_links, team_links = unapproved_entries(
                session,
                match,
                approved,
                requested_team_identity_resolutions=resolutions,
            )
            self.assertEqual(unapproved, [])
            self.assertEqual(team_links, {})


if __name__ == "__main__":
    unittest.main()
