import os
import unittest
from unittest.mock import patch

from test_support import PostgreSQLTestDatabase, configure_test_environment

configure_test_environment()

from alias_management import add_alias  # noqa: E402
from app import app  # noqa: E402
from import_json_to_db import (  # noqa: E402  # noqa: E402
    detect_new_entries,
    get_or_create_team,
    get_or_create_team_entry,
    import_preview_match,
)
from match_upload import validate_committable_match  # noqa: E402
from models import (  # noqa: E402
    AdminAuditLog,
    AdminUser,
    Division,
    Match,
    MatchTeam,
    Player,
    PlayerSeasonEntry,
    Season,
    SourceFile,
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
            session.query(MatchTeam).delete()
            session.query(Match).delete()
            session.query(SourceFile).delete()
            session.query(PlayerSeasonEntry).delete()
            session.query(Player).delete()
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

    def test_unicode_team_tag_works_in_preview_and_identity_controls(self):
        with self.SessionLocal.begin() as session:
            season = Season(
                league_code="gsc", season_code="s15", season_number=15, name="GSC Season 15"
            )
            session.add(season)
            session.flush()
            division = Division(
                season_id=season.season_id, division_code="d9", division_name="Division 9"
            )
            session.add(division)
            session.flush()
            team_ids = {}
            for tag, name in (("zio", "zio"), ("βς", "Banana Syndicate")):
                team = Team(canonical_name=name, canonical_tag=tag)
                session.add(team)
                session.flush()
                team_ids[tag] = team.team_id
                session.add_all(
                    (
                        TeamLeagueIdentity(team_id=team.team_id, league_code="gsc", tag=tag),
                        TeamSeasonEntry(
                            team_id=team.team_id,
                            season_id=season.season_id,
                            division_id=division.division_id,
                            display_name=name,
                            clan_tag=tag,
                        ),
                    )
                )

        match_data = {
            "league": "gsc",
            "season": "s15",
            "division": "d9",
            "match_label": "Unicode team preview",
            "match_type": "regular",
            "result_type": "mutual_tie",
            "match_number": 1,
            "format": "5v5",
            "races_played": 0,
            "tracks": [],
            "teams": {
                "zio": {"total_score": 0, "players": {}},
                "βς": {"total_score": 0, "players": {}},
            },
        }
        with self.SessionLocal.begin() as session:
            validate_committable_match(match_data)
            self.assertEqual(detect_new_entries(session, match_data), [])
            match = import_preview_match(session, match_data)
            session.flush()
            imported_ids = {
                entry.team_id
                for entry in session.query(TeamSeasonEntry)
                .join(
                    MatchTeam,
                    MatchTeam.team_season_entry_id == TeamSeasonEntry.team_season_entry_id,
                )
                .filter(MatchTeam.match_id == match.match_id)
                .all()
            }
            self.assertEqual(imported_ids, set(team_ids.values()))
            self.assertEqual(
                session.query(TeamLeagueIdentity).filter_by(league_code="gsc", tag="βς").count(),
                1,
            )
            self.assertEqual(get_or_create_team(session, "gsc", "βς").team_id, team_ids["βς"])
            with self.assertRaisesRegex(ValueError, "already linked to this team"):
                add_league_identity(session, team_ids["βς"], {"league": "gsc", "tag": "βς"})
            with self.assertRaisesRegex(ValueError, "already this team's canonical tag"):
                add_alias(session, "teams", team_ids["βς"], {"value": "βς"})
            team = session.get(Team, team_ids["βς"])
            team.canonical_identity_override = True
            detail, _ = update_canonical_identity(
                session,
                team_ids["βς"],
                {"canonical_name": "Banana Syndicate", "canonical_tag": "βς"},
            )
            self.assertEqual(detail["team"]["canonical_tag"], "βς")

    def test_delete_season_entry_removes_only_selected_membership_and_dependents(self):
        with self.SessionLocal.begin() as session:
            player = Player(canonical_name="Roster Player")
            session.add(player)
            session.flush()
            session.add_all(
                (
                    PlayerSeasonEntry(
                        player_id=player.player_id,
                        team_season_entry_id=self.entry_two_id,
                        season_id=self.season_two_id,
                        division_id=self.division_two_id,
                    ),
                    TeamLogo(
                        team_id=self.team_id,
                        season_id=self.season_two_id,
                        team_season_entry_id=self.entry_two_id,
                        asset_path="test/season-logo.png",
                        alt_text="Season logo",
                    ),
                )
            )

        headers = {"X-Dev-Admin-Email": "owner@example.com"}
        with (
            patch.dict(os.environ, {"APP_ENV": "test", "ALLOW_DEV_AUTH": "true"}),
            patch("admin_auth.SessionLocal", self.SessionLocal),
            patch("routes.admin.stats.SessionLocal", self.SessionLocal),
            app.test_client() as client,
        ):
            response = client.delete(
                f"/api/admin/teams/{self.team_id}/season-entries/{self.entry_two_id}",
                headers=headers,
            )
            self.assertEqual(response.status_code, 200, response.get_json())
            self.assertNotIn(
                self.entry_two_id,
                [entry["id"] for entry in response.get_json()["catalog"]["entries"]],
            )
            self.assertEqual(len(response.get_json()["detail"]["season_entries"]), 1)

        with self.SessionLocal() as session:
            self.assertIsNone(session.get(TeamSeasonEntry, self.entry_two_id))
            self.assertEqual(session.query(PlayerSeasonEntry).count(), 0)
            self.assertEqual(session.query(TeamLogo).count(), 0)
            self.assertEqual(session.query(Player).count(), 1)
            self.assertEqual(session.query(TeamSeasonEntry).count(), 1)
            self.assertEqual(session.get(Team, self.team_id).canonical_name, "Season Three Name")
            self.assertIn(
                "team_season_entry.deleted",
                [row.action for row in session.query(AdminAuditLog)],
            )

    def test_delete_season_entry_requires_deleting_matches_first(self):
        with self.SessionLocal.begin() as session:
            source = SourceFile(
                season_id=self.season_two_id,
                division_id=self.division_two_id,
                source_path="test/season-entry-match.json",
                source_filename="season-entry-match.json",
                file_sha256="season-entry-match",
                json_shape="single",
            )
            session.add(source)
            session.flush()
            match = Match(
                season_id=self.season_two_id,
                division_id=self.division_two_id,
                source_file_id=source.source_file_id,
                match_label="Week 1",
                races_played=0,
            )
            session.add(match)
            session.flush()
            session.add(
                MatchTeam(
                    match_id=match.match_id,
                    team_season_entry_id=self.entry_two_id,
                    raw_team_key="CS2",
                )
            )

        headers = {"X-Dev-Admin-Email": "owner@example.com"}
        with (
            patch.dict(os.environ, {"APP_ENV": "test", "ALLOW_DEV_AUTH": "true"}),
            patch("admin_auth.SessionLocal", self.SessionLocal),
            patch("routes.admin.stats.SessionLocal", self.SessionLocal),
            app.test_client() as client,
        ):
            response = client.delete(
                f"/api/admin/teams/{self.team_id}/season-entries/{self.entry_two_id}",
                headers=headers,
            )
            self.assertEqual(response.status_code, 400, response.get_json())
            self.assertIn("Delete the associated matches first", response.get_json()["error"])
            self.assertIn("Week 1", response.get_json()["error"])

        with self.SessionLocal() as session:
            self.assertIsNotNone(session.get(TeamSeasonEntry, self.entry_two_id))
            self.assertEqual(session.query(TeamSeasonEntry).count(), 2)
            self.assertNotIn(
                "team_season_entry.deleted",
                [row.action for row in session.query(AdminAuditLog)],
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

    def test_dashboard_uses_canonical_identity_for_career_scope(self):
        with self.SessionLocal.begin() as session:
            update_canonical_override(session, self.team_id, {"enabled": True})
            update_canonical_identity(
                session,
                self.team_id,
                {"canonical_name": "Vibe Freaks", "canonical_tag": "vf"},
            )
            team = session.get(Team, self.team_id)
            identity = _team_identity(
                session,
                team,
                DashboardScope("ctc", None, None, None, None, None),
            )
            self.assertEqual(identity["display_name"], "Vibe Freaks")
            self.assertEqual(identity["tag"], "vf")
            self.assertIsNone(identity["current_entry"])
            self.assertEqual(identity["appearances"][0]["name"], "Season Three Name")

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
            status_response = client.patch(
                f"/api/admin/team-season-entries/{self.entry_two_id}/status",
                json={"status": "dropped", "note": "Season withdrawal"},
                headers=headers,
            )
            self.assertEqual(status_response.status_code, 200, status_response.get_json())
            self.assertEqual(status_response.get_json()["status"], "dropped")
        with self.SessionLocal() as session:
            actions = [row.action for row in session.query(AdminAuditLog).all()]
            self.assertIn("team.identity_updated", actions)
            self.assertIn("team_season_entry.competition_status_updated", actions)

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
        with self.SessionLocal.begin() as session:
            entry = session.get(TeamSeasonEntry, self.entry_two_id)
            entry.competition_status = "disqualified"
            entry.competition_status_note = "Administrative ruling"

        with self.SessionLocal() as session:
            detail = get_team_identity(session, self.team_id)
            self.assertEqual(detail["team"]["canonical_tag"], "CS")
            self.assertEqual(
                [entry["season"]["code"] for entry in detail["season_entries"]],
                ["s3", "s2"],
            )
            entry = next(
                item for item in detail["season_entries"] if item["id"] == self.entry_two_id
            )
            self.assertEqual(entry["competition_status"], "disqualified")
            self.assertEqual(entry["competition_status_note"], "Administrative ruling")


if __name__ == "__main__":
    unittest.main()
