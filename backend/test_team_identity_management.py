import os
import unittest
from unittest.mock import patch

from test_support import PostgreSQLTestDatabase, configure_test_environment

configure_test_environment()

from alias_management import add_alias  # noqa: E402
from app import app  # noqa: E402
from import_json_to_db import get_or_create_team_entry  # noqa: E402
from models import (  # noqa: E402
    AdminAuditLog,
    AdminUser,
    Division,
    Season,
    Team,
    TeamAlias,
    TeamSeasonEntry,
)
from player_dashboard_stats import DashboardScope  # noqa: E402
from team_dashboard_stats import _team_identity  # noqa: E402
from team_identity_management import (  # noqa: E402
    get_team_identity,
    update_canonical_identity,
    update_season_identity,
)


class TeamIdentityManagementTests(unittest.TestCase):
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
            session.query(AdminUser).delete()
            session.query(TeamAlias).delete()
            session.query(TeamSeasonEntry).delete()
            session.query(Division).delete()
            session.query(Season).delete()
            session.query(Team).delete()
            team = Team(canonical_name="CS", canonical_tag="CS")
            other_team = Team(canonical_name="Other Team", canonical_tag="OT")
            season_two = Season(
                league_code="ctc",
                season_code="s2",
                season_number=2,
                name="Season 2",
                status="complete",
            )
            season_three = Season(
                league_code="ctc",
                season_code="s3",
                season_number=3,
                name="Season 3",
                status="complete",
            )
            session.add_all((team, other_team, season_two, season_three))
            session.flush()
            division_two = Division(
                season_id=season_two.season_id,
                division_code="d2",
                division_name="Division 2",
            )
            division_three = Division(
                season_id=season_three.season_id,
                division_code="d1",
                division_name="Division 1",
            )
            session.add_all((division_two, division_three))
            session.flush()
            entry_two = TeamSeasonEntry(
                team_id=team.team_id,
                season_id=season_two.season_id,
                division_id=division_two.division_id,
                display_name="Season Two Name",
                clan_tag="CS2",
            )
            entry_three = TeamSeasonEntry(
                team_id=team.team_id,
                season_id=season_three.season_id,
                division_id=division_three.division_id,
                display_name="Season Three Name",
                clan_tag="CS3",
            )
            session.add_all((entry_two, entry_three))
            session.flush()
            self.team_id = team.team_id
            self.other_team_id = other_team.team_id
            self.season_two_id = season_two.season_id
            self.division_two_id = division_two.division_id
            self.entry_two_id = entry_two.team_season_entry_id
            session.add(
                AdminUser(
                    email="owner@example.com",
                    normalized_email="owner@example.com",
                    role="owner",
                    status="active",
                )
            )

    def test_canonical_update_preserves_previous_tag_as_alias(self):
        with self.SessionLocal.begin() as session:
            detail, previous = update_canonical_identity(
                session,
                self.team_id,
                {"canonical_name": "Cosmic Speed", "canonical_tag": "CSP"},
            )
            self.assertEqual(previous, {"canonical_name": "CS", "canonical_tag": "CS"})
            self.assertEqual(detail["team"]["canonical_name"], "Cosmic Speed")
            self.assertEqual(detail["team"]["canonical_tag"], "CSP")
            alias = session.scalar(
                session.query(TeamAlias).where(TeamAlias.team_id == self.team_id).statement
            )
            self.assertEqual(alias.alias_value, "CS")

    def test_canonical_tag_rejects_case_insensitive_conflicts(self):
        with self.SessionLocal.begin() as session:
            with self.assertRaisesRegex(ValueError, "another team"):
                update_canonical_identity(
                    session,
                    self.team_id,
                    {"canonical_name": "Cosmic Speed", "canonical_tag": "ot"},
                )

    def test_team_alias_rejects_another_canonical_tag(self):
        with self.SessionLocal.begin() as session:
            with self.assertRaisesRegex(ValueError, "another team's canonical tag"):
                add_alias(session, "teams", self.team_id, {"value": "ot"})

    def test_season_update_changes_only_selected_entry(self):
        with self.SessionLocal.begin() as session:
            detail, previous = update_season_identity(
                session,
                self.team_id,
                self.entry_two_id,
                {"display_name": "Second Season Speed", "clan_tag": "S2S"},
            )
            self.assertEqual(previous["display_name"], "Season Two Name")
            updated = next(
                entry for entry in detail["season_entries"] if entry["id"] == self.entry_two_id
            )
            unchanged = next(
                entry for entry in detail["season_entries"] if entry["id"] != self.entry_two_id
            )
            self.assertEqual(updated["display_name"], "Second Season Speed")
            self.assertEqual(updated["clan_tag"], "S2S")
            self.assertEqual(unchanged["display_name"], "Season Three Name")

    def test_import_reuses_entry_after_season_tag_edit(self):
        with self.SessionLocal.begin() as session:
            update_season_identity(
                session,
                self.team_id,
                self.entry_two_id,
                {"display_name": "Second Season Speed", "clan_tag": "S2S"},
            )
            team = session.get(Team, self.team_id)
            season = session.get(Season, self.season_two_id)
            division = session.get(Division, self.division_two_id)
            entry = get_or_create_team_entry(
                session, team, season, division, team.canonical_tag, team.canonical_name, None
            )
            self.assertEqual(entry.team_season_entry_id, self.entry_two_id)
            self.assertEqual(entry.clan_tag, "S2S")

    def test_dashboard_uses_identity_for_selected_season(self):
        with self.SessionLocal() as session:
            team = session.get(Team, self.team_id)
            identity = _team_identity(
                session,
                team,
                DashboardScope(self.season_two_id, "s2", 2, self.division_two_id, "d2"),
            )
            self.assertEqual(identity["display_name"], "Season Two Name")
            self.assertEqual(identity["current_entry"]["tag"], "CS2")

    def test_dashboard_falls_back_when_imported_season_name_is_only_the_tag(self):
        with self.SessionLocal.begin() as session:
            update_canonical_identity(
                session,
                self.team_id,
                {"canonical_name": "Cosmic Speed", "canonical_tag": "CS"},
            )
            update_season_identity(
                session,
                self.team_id,
                self.entry_two_id,
                {"display_name": "CS2", "clan_tag": "CS2"},
            )
            team = session.get(Team, self.team_id)
            identity = _team_identity(
                session,
                team,
                DashboardScope(self.season_two_id, "s2", 2, self.division_two_id, "d2"),
            )
            self.assertEqual(identity["display_name"], "Cosmic Speed")
            self.assertEqual(identity["current_entry"]["name"], "Cosmic Speed")

    def test_admin_identity_routes_update_and_audit(self):
        headers = {"X-Dev-Admin-Email": "owner@example.com"}
        with (
            patch.dict(os.environ, {"APP_ENV": "test", "ALLOW_DEV_AUTH": "true"}),
            patch("admin_auth.SessionLocal", self.SessionLocal),
            patch("routes.admin.stats.SessionLocal", self.SessionLocal),
            app.test_client() as client,
        ):
            response = client.patch(
                f"/api/admin/teams/{self.team_id}/identity",
                json={"canonical_name": "Cosmic Speed", "canonical_tag": "CSP"},
                headers=headers,
            )
            self.assertEqual(response.status_code, 200, response.get_json())
            self.assertEqual(response.get_json()["team"]["canonical_name"], "Cosmic Speed")
        with self.SessionLocal() as session:
            actions = [row.action for row in session.query(AdminAuditLog).all()]
            self.assertIn("team.identity_updated", actions)

    def test_detail_includes_conventional_and_season_identities(self):
        with self.SessionLocal() as session:
            detail = get_team_identity(session, self.team_id)
            self.assertEqual(detail["team"]["canonical_tag"], "CS")
            self.assertEqual(
                [entry["season"]["code"] for entry in detail["season_entries"]],
                ["s3", "s2"],
            )


if __name__ == "__main__":
    unittest.main()
