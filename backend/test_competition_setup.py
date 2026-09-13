import os
import unittest
from unittest.mock import patch

from test_support import PostgreSQLTestDatabase, configure_test_environment

configure_test_environment()

from app import app  # noqa: E402
from competition_setup import create_team_season_entry  # noqa: E402
from import_json_to_db import (  # noqa: E402
    get_or_create_division,
    get_or_create_season,
    get_or_create_team,
    get_or_create_team_entry,
)
from models import (  # noqa: E402
    AdminAuditLog,
    AdminUser,
    Division,
    DivisionConference,
    DivisionPlayoffConfig,
    Season,
    Team,
    TeamLeagueIdentity,
    TeamSeasonEntry,
)
from sqlalchemy import select  # noqa: E402
from standings_service import get_division_standings  # noqa: E402


class CompetitionSetupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = PostgreSQLTestDatabase()
        cls.SessionLocal = cls.database.SessionLocal

    @classmethod
    def tearDownClass(cls):
        cls.database.close()

    def setUp(self):
        with self.SessionLocal.begin() as session:
            for table in (
                AdminAuditLog,
                AdminUser,
                TeamLeagueIdentity,
                TeamSeasonEntry,
                DivisionConference,
                DivisionPlayoffConfig,
                Division,
                Season,
                Team,
            ):
                session.query(table).delete()
            session.add(
                AdminUser(
                    firebase_uid=None,
                    email="owner@example.com",
                    normalized_email="owner@example.com",
                    role="owner",
                    status="active",
                )
            )

    def test_canonical_team_can_register_distinct_subteams_across_divisions(self):
        with self.SessionLocal.begin() as session:
            season = Season(
                league_code="ctc",
                season_code="s-test",
                season_number=999,
                name="Test Season",
            )
            team = Team(
                canonical_name="Canonical Team",
                canonical_tag="CT",
                canonical_identity_override=True,
            )
            session.add_all([season, team])
            session.flush()
            divisions = [
                Division(
                    season_id=season.season_id,
                    division_code=f"d{number}",
                    division_name=f"Division {number}",
                )
                for number in range(1, 5)
            ]
            session.add_all(divisions)
            session.flush()
            session.add(TeamLeagueIdentity(team_id=team.team_id, league_code="ctc", tag="CT"))
            session.flush()

            first, *_ = create_team_season_entry(
                session,
                {
                    "team_id": team.team_id,
                    "season_id": season.season_id,
                    "division_id": divisions[0].division_id,
                    "display_name": "First Subteam",
                    "clan_tag": "CT",
                },
            )
            different_tag, *_ = create_team_season_entry(
                session,
                {
                    "team_id": team.team_id,
                    "season_id": season.season_id,
                    "division_id": divisions[1].division_id,
                    "display_name": "First Subteam",
                    "clan_tag": "CT2",
                },
            )
            different_name, *_ = create_team_season_entry(
                session,
                {
                    "team_id": team.team_id,
                    "season_id": season.season_id,
                    "division_id": divisions[2].division_id,
                    "display_name": "Third Subteam",
                    "clan_tag": "CT",
                },
            )

            self.assertEqual(
                {first.team_id, different_tag.team_id, different_name.team_id},
                {team.team_id},
            )
            self.assertEqual(
                {first.division_id, different_tag.division_id, different_name.division_id},
                {division.division_id for division in divisions[:3]},
            )
            with self.assertRaisesRegex(ValueError, "Change at least one"):
                create_team_season_entry(
                    session,
                    {
                        "team_id": team.team_id,
                        "season_id": season.season_id,
                        "division_id": divisions[3].division_id,
                        "display_name": "First Subteam",
                        "clan_tag": "CT",
                    },
                )
            with self.assertRaisesRegex(ValueError, "already registered in Division 1"):
                create_team_season_entry(
                    session,
                    {
                        "team_id": team.team_id,
                        "season_id": season.season_id,
                        "division_id": divisions[0].division_id,
                        "display_name": "Another Subteam",
                        "clan_tag": "CT3",
                    },
                )

    def test_admin_can_build_preseason_structure_before_match_import(self):
        headers = {"X-Dev-Admin-Email": "owner@example.com"}
        with (
            patch.dict(os.environ, {"ALLOW_DEV_AUTH": "true"}),
            patch("admin_auth.SessionLocal", self.SessionLocal),
            patch("routes.admin.stats.SessionLocal", self.SessionLocal),
            app.test_client() as client,
        ):
            season_response = client.post(
                "/api/admin/competition-setup/seasons",
                json={
                    "league": "gsc",
                    "code": "s100",
                    "number": 100,
                    "name": "GSC Season 100",
                    "status": "upcoming",
                },
                headers=headers,
            )
            self.assertEqual(season_response.status_code, 201, season_response.get_json())
            season_id = season_response.get_json()["created_id"]

            division_response = client.post(
                "/api/admin/competition-setup/divisions",
                json={"season_id": season_id, "code": "d1", "name": "Division 1"},
                headers=headers,
            )
            self.assertEqual(division_response.status_code, 201, division_response.get_json())
            division_id = division_response.get_json()["created_id"]

            season_update_response = client.patch(
                f"/api/admin/competition-setup/seasons/{season_id}",
                json={
                    "code": "s100",
                    "number": 100,
                    "name": "GSC Championship 100",
                    "status": "active",
                    "starts_on": "2026-09-20",
                    "ends_on": "2026-12-13",
                },
                headers=headers,
            )
            self.assertEqual(
                season_update_response.status_code, 200, season_update_response.get_json()
            )
            updated_season = season_update_response.get_json()["catalog"]["seasons"][0]
            self.assertEqual(updated_season["status"], "active")
            self.assertEqual(updated_season["name"], "GSC Championship 100")
            self.assertEqual(updated_season["starts_on"], "2026-09-20")
            self.assertEqual(updated_season["ends_on"], "2026-12-13")

            invalid_dates_response = client.patch(
                f"/api/admin/competition-setup/seasons/{season_id}",
                json={
                    "code": "s100",
                    "number": 100,
                    "name": "GSC Championship 100",
                    "status": "active",
                    "starts_on": "2026-12-13",
                    "ends_on": "2026-09-20",
                },
                headers=headers,
            )
            self.assertEqual(invalid_dates_response.status_code, 400)
            self.assertIn("before the start date", invalid_dates_response.get_json()["error"])

            division_update_response = client.patch(
                f"/api/admin/competition-setup/divisions/{division_id}",
                json={"code": "d1", "name": "Premier Division"},
                headers=headers,
            )
            self.assertEqual(
                division_update_response.status_code, 200, division_update_response.get_json()
            )
            self.assertEqual(
                division_update_response.get_json()["catalog"]["seasons"][0]["divisions"][0][
                    "name"
                ],
                "Premier Division",
            )
            self.assertEqual(
                division_update_response.get_json()["catalog"]["seasons"][0]["divisions"][0][
                    "playoff_team_count"
                ],
                3,
            )

            playoff_update_response = client.patch(
                f"/api/admin/competition-setup/divisions/{division_id}",
                json={
                    "code": "d1",
                    "name": "Premier Division",
                    "is_conference_based": False,
                    "playoff_team_count": 4,
                },
                headers=headers,
            )
            self.assertEqual(
                playoff_update_response.status_code, 200, playoff_update_response.get_json()
            )
            self.assertEqual(
                playoff_update_response.get_json()["catalog"]["seasons"][0]["divisions"][0][
                    "playoff_team_count"
                ],
                4,
            )

            team_response = client.post(
                "/api/admin/competition-setup/teams",
                json={
                    "league": "gsc",
                    "canonical_name": "Cosmic Speed",
                    "canonical_tag": "CS",
                },
                headers=headers,
            )
            self.assertEqual(team_response.status_code, 201, team_response.get_json())
            team_id = team_response.get_json()["created_id"]

            entry_response = client.post(
                "/api/admin/competition-setup/team-season-entries/with-logo",
                data={
                    "team_id": team_id,
                    "season_id": season_id,
                    "division_id": division_id,
                    "display_name": "Cosmic Speed",
                    "clan_tag": "CS",
                    "hex_color": "#3B82F6",
                    "logo_mode": "none",
                },
                headers=headers,
                content_type="multipart/form-data",
            )
            self.assertEqual(entry_response.status_code, 201, entry_response.get_json())
            catalog = entry_response.get_json()["catalog"]
            self.assertEqual(catalog["seasons"][0]["divisions"][0]["code"], "d1")
            self.assertEqual(catalog["entries"][0]["team"]["id"], team_id)

            conference_response = client.patch(
                f"/api/admin/competition-setup/divisions/{division_id}",
                json={
                    "code": "d1",
                    "name": "Premier Division",
                    "is_conference_based": True,
                    "conference_names": {"a": "Gold Conference", "b": "Silver Conference"},
                    "conference_assignments": {str(catalog["entries"][0]["id"]): "a"},
                },
                headers=headers,
            )
            self.assertEqual(conference_response.status_code, 200, conference_response.get_json())
            configured_division = conference_response.get_json()["catalog"]["seasons"][0][
                "divisions"
            ][0]
            self.assertTrue(configured_division["is_conference_based"])
            self.assertEqual(configured_division["playoff_team_count"], 4)
            self.assertEqual(
                [conference["name"] for conference in configured_division["conferences"]],
                ["Gold Conference", "Silver Conference"],
            )

            duplicate_response = client.post(
                "/api/admin/competition-setup/team-season-entries",
                json={
                    "team_id": team_id,
                    "season_id": season_id,
                    "division_id": division_id,
                    "display_name": "Cosmic Speed",
                    "clan_tag": "CS",
                },
                headers=headers,
            )
            self.assertEqual(duplicate_response.status_code, 400)
            self.assertIn("already registered", duplicate_response.get_json()["error"])

        with self.SessionLocal() as session:
            standings = get_division_standings(session, league="gsc", season="s100", division="d1")
            self.assertEqual(standings["matches"], [])
            self.assertEqual(len(standings["standings"]), 1)
            row = standings["standings"][0]
            self.assertEqual(row["tag"], "CS")
            self.assertEqual(row["played"], 0)
            self.assertEqual(row["wins"], 0)
            self.assertEqual(row["losses"], 0)
            self.assertEqual(row["standings_points"], 0)
            self.assertEqual(standings["conferences"][0]["name"], "Gold Conference")
            self.assertEqual(standings["conferences"][0]["standings"][0]["tag"], "CS")
            imported_season = get_or_create_season(session, "gsc", "s100")
            imported_division = get_or_create_division(session, imported_season, "d1")
            imported_team = get_or_create_team(session, "gsc", "CS", "Cosmic Speed")
            imported_entry = get_or_create_team_entry(
                session,
                imported_team,
                imported_season,
                imported_division,
                "CS",
                "Cosmic Speed",
                "#3B82F6",
            )
            self.assertEqual(imported_season.season_id, season_id)
            self.assertEqual(imported_division.division_id, division_id)
            self.assertEqual(imported_team.team_id, team_id)
            self.assertEqual(imported_entry.team_season_entry_id, catalog["entries"][0]["id"])
            self.assertEqual(
                set(session.scalars(select(AdminAuditLog.action)).all()),
                {
                    "season.created",
                    "season.updated",
                    "division.created",
                    "division.updated",
                    "team.created",
                    "team_season_entry.created",
                },
            )


if __name__ == "__main__":
    unittest.main()
