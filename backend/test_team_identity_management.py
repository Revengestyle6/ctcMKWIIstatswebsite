import os
import unittest
from unittest.mock import patch

from test_support import PostgreSQLTestDatabase, configure_test_environment

configure_test_environment()

from alias_management import add_alias  # noqa: E402
from app import app  # noqa: E402
from import_json_to_db import get_or_create_team, get_or_create_team_entry  # noqa: E402
from models import (  # noqa: E402
    AdminAuditLog,
    AdminUser,
    Division,
    Season,
    Team,
    TeamAlias,
    TeamLeagueIdentity,
    TeamLogo,
    TeamSeasonEntry,
)
from player_dashboard_stats import DashboardScope  # noqa: E402
from team_dashboard_stats import _team_identity  # noqa: E402
from team_identity_management import (  # noqa: E402
    add_league_identity,
    delete_league_identity,
    get_team_identity,
    merge_team,
    team_merge_comparison,
    update_canonical_identity,
    update_canonical_override,
    update_canonical_preference,
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
            session.query(TeamLeagueIdentity).delete()
            session.query(TeamLogo).delete()
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
            session.add(TeamLeagueIdentity(team_id=team.team_id, league_code="ctc", tag="CS"))
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
            update_canonical_override(session, self.team_id, {"enabled": True})
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

    def test_canonical_tag_can_match_an_unlinked_team(self):
        with self.SessionLocal.begin() as session:
            update_canonical_override(session, self.team_id, {"enabled": True})
            detail, _ = update_canonical_identity(
                session,
                self.team_id,
                {"canonical_name": "Cosmic Speed", "canonical_tag": "ot"},
            )
            self.assertEqual(detail["team"]["canonical_tag"], "ot")

    def test_same_tag_in_another_league_stays_separate_until_linked(self):
        with self.SessionLocal.begin() as session:
            separate = get_or_create_team(session, "gsc", "CS", "GSC Cosmic")
            self.assertNotEqual(separate.team_id, self.team_id)
            identity = session.scalar(
                session.query(TeamLeagueIdentity)
                .where(TeamLeagueIdentity.team_id == separate.team_id)
                .statement
            )
            self.assertEqual(identity.league_code, "gsc")

    def test_admin_league_identity_explicitly_links_team(self):
        with self.SessionLocal.begin() as session:
            detail, identity = add_league_identity(
                session, self.team_id, {"league": "gsc", "tag": "CS"}
            )
            self.assertEqual(detail["league_identities"][-1]["league"], "gsc")
            linked = get_or_create_team(session, "gsc", "CS", "Ignored")
            self.assertEqual(linked.team_id, self.team_id)
            detail, deleted = delete_league_identity(
                session, self.team_id, identity.team_league_identity_id
            )
            self.assertEqual(deleted, {"league": "gsc", "tag": "CS"})
            self.assertFalse(any(item["league"] == "gsc" for item in detail["league_identities"]))

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
                DashboardScope("ctc", self.season_two_id, "s2", 2, self.division_two_id, "d2"),
            )
            self.assertEqual(identity["display_name"], "Season Two Name")
            self.assertEqual(identity["current_entry"]["tag"], "CS2")

    def test_dashboard_falls_back_when_imported_season_name_is_only_the_tag(self):
        with self.SessionLocal.begin() as session:
            update_canonical_override(session, self.team_id, {"enabled": True})
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
                DashboardScope("ctc", self.season_two_id, "s2", 2, self.division_two_id, "d2"),
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
            override_response = client.patch(
                f"/api/admin/teams/{self.team_id}/canonical-identity-override",
                json={"enabled": True},
                headers=headers,
            )
            self.assertEqual(override_response.status_code, 200, override_response.get_json())
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

    def test_automatic_identity_uses_preferred_league_and_override(self):
        with self.SessionLocal.begin() as session:
            detail, _previous = update_canonical_preference(
                session, self.team_id, {"league": "ctc"}
            )
            self.assertEqual(detail["team"]["canonical_name"], "Season Three Name")
            self.assertEqual(detail["team"]["canonical_tag"], "CS3")

            gsc_season = Season(
                league_code="gsc",
                season_code="s4",
                season_number=4,
                name="GSC Season 4",
                status="complete",
            )
            session.add(gsc_season)
            session.flush()
            gsc_division = Division(
                season_id=gsc_season.season_id,
                division_code="d1",
                division_name="Division 1",
            )
            session.add(gsc_division)
            session.flush()
            session.add(
                TeamSeasonEntry(
                    team_id=self.team_id,
                    season_id=gsc_season.season_id,
                    division_id=gsc_division.division_id,
                    display_name="GSC Identity",
                    clan_tag="GSC",
                )
            )
            session.flush()

            detail, _previous = update_canonical_preference(
                session, self.team_id, {"league": "gsc"}
            )
            self.assertEqual(detail["team"]["canonical_name"], "GSC Identity")
            update_canonical_override(session, self.team_id, {"enabled": True})
            update_canonical_identity(
                session,
                self.team_id,
                {"canonical_name": "Manual Team", "canonical_tag": "MAN"},
            )
            update_season_identity(
                session,
                self.team_id,
                self.entry_two_id,
                {"display_name": "Changed Old Identity", "clan_tag": "OLD"},
            )
            self.assertEqual(session.get(Team, self.team_id).canonical_name, "Manual Team")
            detail, _previous = update_canonical_override(session, self.team_id, {"enabled": False})
            self.assertEqual(detail["team"]["canonical_name"], "GSC Identity")

    def test_manual_identity_requires_override(self):
        with self.SessionLocal.begin() as session:
            with self.assertRaisesRegex(ValueError, "Enable the canonical-identity override"):
                update_canonical_identity(
                    session,
                    self.team_id,
                    {"canonical_name": "Manual Team", "canonical_tag": "MAN"},
                )

    def test_team_merge_preserves_identities_and_reapplies_destination_preference(self):
        with self.SessionLocal.begin() as session:
            source = session.get(Team, self.other_team_id)
            gsc_season = Season(
                league_code="gsc",
                season_code="s4",
                season_number=4,
                name="GSC Season 4",
                status="complete",
            )
            session.add(gsc_season)
            session.flush()
            gsc_division = Division(
                season_id=gsc_season.season_id,
                division_code="d1",
                division_name="Division 1",
            )
            session.add(gsc_division)
            session.flush()
            session.add_all(
                (
                    TeamSeasonEntry(
                        team_id=source.team_id,
                        season_id=gsc_season.season_id,
                        division_id=gsc_division.division_id,
                        display_name="Bird Team",
                        clan_tag="BIRD",
                    ),
                    TeamLeagueIdentity(
                        team_id=source.team_id,
                        league_code="gsc",
                        tag="BIRD",
                    ),
                    TeamAlias(team_id=source.team_id, alias_value="Fish"),
                )
            )
            update_canonical_preference(session, self.team_id, {"league": "ctc"})
            comparison = team_merge_comparison(session, source.team_id, self.team_id)
            self.assertEqual(comparison["impact"]["season_entries"], 1)
            self.assertFalse(comparison["blockers"])

            result = merge_team(session, source.team_id, {"target_team_id": self.team_id})
            self.assertEqual(result["season_entries_moved"], 1)
            self.assertEqual(result["league_identities_moved"], 1)
            self.assertEqual(result["target"]["team"]["canonical_name"], "Season Three Name")
            self.assertIsNone(session.get(Team, self.other_team_id))
            self.assertEqual(
                {entry["season"]["league"] for entry in result["target"]["season_entries"]},
                {"ctc", "gsc"},
            )

    def test_team_merge_routes_review_apply_and_audit(self):
        headers = {"X-Dev-Admin-Email": "owner@example.com"}
        with (
            patch.dict(os.environ, {"APP_ENV": "test", "ALLOW_DEV_AUTH": "true"}),
            patch("admin_auth.SessionLocal", self.SessionLocal),
            patch("routes.admin.stats.SessionLocal", self.SessionLocal),
            app.test_client() as client,
        ):
            comparison = client.get(
                f"/api/admin/aliases/teams/{self.other_team_id}/merge-comparison",
                query_string={"target_team_id": self.team_id},
                headers=headers,
            )
            self.assertEqual(comparison.status_code, 200, comparison.get_json())
            self.assertFalse(comparison.get_json()["blockers"])
            response = client.post(
                f"/api/admin/aliases/teams/{self.other_team_id}/merge",
                json={"target_team_id": self.team_id},
                headers=headers,
            )
            self.assertEqual(response.status_code, 200, response.get_json())
            self.assertEqual(response.get_json()["target"]["team"]["id"], self.team_id)
        with self.SessionLocal() as session:
            self.assertIsNone(session.get(Team, self.other_team_id))
            self.assertIn("team.merged", [row.action for row in session.query(AdminAuditLog)])

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
