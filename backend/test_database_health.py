# ruff: noqa: E402

import unittest
from contextlib import nullcontext
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from test_support import configure_test_environment

configure_test_environment()

import admin_auth
import app as app_module
import routes.admin as admin_routes
from database_health import build_database_health
from database_health_reviews import set_issue_review
from models import (
    Division,
    Match,
    MatchPlayer,
    MatchTeam,
    Player,
    PlayerAlias,
    PlayerSeasonEntry,
    Season,
    SourceFile,
    Team,
    TeamSeasonEntry,
    Track,
)
from test_support import PostgreSQLTestDatabase


class DatabaseHealthTests(unittest.TestCase):
    def setUp(self):
        self.database = PostgreSQLTestDatabase()
        self.session = self.database.SessionLocal()

    def tearDown(self):
        self.session.close()
        self.database.close()

    def test_report_counts_records_and_surfaces_duplicate_catalog_names(self):
        self.session.add_all(
            [
                Track(canonical_name="Test Track"),
                Track(canonical_name="Test-Track"),
                Player(canonical_lounge_name="Example"),
                Player(canonical_lounge_name=" example "),
            ]
        )
        self.session.commit()

        report = build_database_health(self.session, include_archive=False)

        self.assertEqual(report["database"]["backend"], "postgresql")
        self.assertEqual(report["database"]["connection_status"], "ok")
        self.assertEqual(report["database"]["integrity"]["physical"]["status"], "not_run")
        self.assertEqual(report["database"]["integrity"]["foreign_keys"]["unvalidated"], 0)
        self.assertEqual(report["counts"]["tracks"], 2)
        self.assertEqual(report["counts"]["players"], 2)
        self.assertEqual(report["status"], "warning")
        issue_keys = {issue["key"] for issue in report["issues"]}
        self.assertIn("duplicate-track:testtrack", issue_keys)
        self.assertIn("duplicate-player-name:example", issue_keys)
        self.assertEqual(report["archive"]["status"], "skipped")

    def test_empty_database_is_healthy_when_archive_check_is_skipped(self):
        report = build_database_health(self.session, include_archive=False)
        self.assertEqual(report["status"], "healthy")
        self.assertEqual(report["summary"]["critical"], 0)
        self.assertEqual(report["summary"]["warnings"], 0)
        self.assertTrue(report["database"]["name"])
        self.assertIsNotNone(report["database"]["version"])
        self.assertIsNone(report["database"]["schema_revision"])

    def test_dismissed_catalog_warning_remains_visible_but_does_not_degrade_health(self):
        self.session.add_all(
            [Track(canonical_name="Test Track"), Track(canonical_name="Test-Track")]
        )
        self.session.commit()
        with TemporaryDirectory() as directory:
            review_path = Path(directory) / "reviews.json"
            set_issue_review(
                "duplicate-track:testtrack",
                "dismissed",
                "Confirmed aliases for the same reviewed catalog entry.",
                path=review_path,
            )
            report = build_database_health(
                self.session,
                include_archive=False,
                review_path=review_path,
            )

        issue = next(
            item for item in report["issues"] if item["key"] == "duplicate-track:testtrack"
        )
        self.assertTrue(issue["dismissible"])
        self.assertTrue(issue["is_dismissed"])
        self.assertEqual(report["summary"]["dismissed"], 1)
        self.assertEqual(report["status"], "healthy")

    def test_alias_collision_uses_actual_match_scope_and_canonical_names(self):
        self.session.add_all(
            [
                Season(season_id=1, season_code="s2", name="Season 2", status="active"),
                Season(season_id=2, season_code="s3", name="Season 3", status="active"),
                Team(team_id=1, canonical_name="Example Team", canonical_tag="EX"),
                Player(player_id=1, canonical_lounge_name="Canonical One"),
                Player(player_id=2, canonical_lounge_name="Canonical Two"),
            ]
        )
        self.session.commit()
        self.session.add_all(
            [
                Division(
                    division_id=1, season_id=1, division_code="d1", division_name="Division 1"
                ),
                Division(
                    division_id=2, season_id=2, division_code="d1", division_name="Division 1"
                ),
            ]
        )
        self.session.commit()
        self.session.add_all(
            [
                TeamSeasonEntry(
                    team_season_entry_id=1,
                    team_id=1,
                    season_id=1,
                    division_id=1,
                    display_name="Example Team",
                    clan_tag="EX",
                ),
                TeamSeasonEntry(
                    team_season_entry_id=2,
                    team_id=1,
                    season_id=2,
                    division_id=2,
                    display_name="Example Team",
                    clan_tag="EX",
                ),
                SourceFile(
                    source_file_id=1,
                    season_id=2,
                    division_id=2,
                    source_path="JSON/example.json",
                    source_filename="example.json",
                    file_sha256="example-sha",
                    json_shape="single_match",
                ),
            ]
        )
        self.session.commit()
        self.session.add_all(
            [
                PlayerSeasonEntry(
                    player_season_entry_id=1,
                    player_id=1,
                    team_season_entry_id=1,
                    season_id=1,
                    division_id=1,
                ),
                PlayerSeasonEntry(
                    player_season_entry_id=2,
                    player_id=2,
                    team_season_entry_id=1,
                    season_id=1,
                    division_id=1,
                ),
                PlayerSeasonEntry(
                    player_season_entry_id=3,
                    player_id=1,
                    team_season_entry_id=2,
                    season_id=2,
                    division_id=2,
                ),
                PlayerSeasonEntry(
                    player_season_entry_id=4,
                    player_id=2,
                    team_season_entry_id=2,
                    season_id=2,
                    division_id=2,
                ),
                PlayerAlias(player_id=1, alias_type="mii_name", alias_value="holy"),
                PlayerAlias(player_id=2, alias_type="mii_name", alias_value="HOLY"),
                Match(
                    match_id=1,
                    season_id=2,
                    division_id=2,
                    source_file_id=1,
                    match_label="Season 3 Match",
                    races_played=0,
                ),
            ]
        )
        self.session.commit()

        self.session.add(
            MatchTeam(
                match_team_id=1,
                match_id=1,
                team_season_entry_id=2,
                raw_team_key="EX",
            )
        )
        self.session.commit()
        self.session.add_all(
            [
                MatchPlayer(
                    match_player_id=1,
                    match_team_id=1,
                    player_id=1,
                    player_season_entry_id=3,
                    friend_code_raw="1111-1111-1111",
                    mii_name_raw="holy",
                ),
                MatchPlayer(
                    match_player_id=2,
                    match_team_id=1,
                    player_id=2,
                    player_season_entry_id=4,
                    friend_code_raw="2222-2222-2222",
                    mii_name_raw="HOLY",
                ),
            ]
        )
        self.session.commit()

        report = build_database_health(self.session, include_archive=False)
        collision_issues = [
            item for item in report["issues"] if item["key"].startswith("player-alias-collision:")
        ]
        issue = next(
            item
            for item in collision_issues
            if item["key"] == "player-alias-collision:s3:d1:mii_name:holy"
        )

        self.assertEqual(len(collision_issues), 1)
        self.assertIn("Mii Name alias", issue["detail"])
        self.assertEqual(
            {(entity["id"], entity["label"]) for entity in issue["entities"]},
            {(1, "Canonical One"), (2, "Canonical Two")},
        )


class DatabaseHealthApiTests(unittest.TestCase):
    def setUp(self):
        app_module.app.config.update(TESTING=True)
        app_module.cache.clear()
        self.client = app_module.app.test_client()

    def test_health_route_forwards_archive_option(self):
        report = {"status": "healthy", "issues": []}
        with (
            patch.object(
                admin_auth,
                "authenticate_admin",
                return_value=admin_auth.AdminActor(1, "test-uid", "owner@example.com", "owner"),
            ),
            patch.object(app_module.stats, "SessionLocal", return_value=nullcontext(object())),
            patch.object(
                app_module.database_health_service, "build_database_health", return_value=report
            ) as mocked,
        ):
            response = self.client.get("/api/database-health?include_archive=0")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), report)
        self.assertFalse(mocked.call_args.kwargs["include_archive"])

    def test_review_route_persists_dismissible_finding(self):
        report = {"issues": [{"key": "similar-track:a:b", "dismissible": True}]}
        review = {"status": "dismissed", "note": "Confirmed separate tracks."}
        with (
            patch.object(
                admin_auth,
                "authenticate_admin",
                return_value=admin_auth.AdminActor(1, "test-uid", "owner@example.com", "owner"),
            ),
            patch.object(app_module.stats, "SessionLocal", return_value=nullcontext(object())),
            patch.object(
                app_module.database_health_service, "build_database_health", return_value=report
            ),
            patch.object(admin_routes, "set_issue_review", return_value=review) as save_review,
        ):
            response = self.client.post(
                "/api/database-health/reviews",
                json={
                    "issue_key": "similar-track:a:b",
                    "status": "dismissed",
                    "note": "Confirmed separate tracks.",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["review"], review)
        self.assertEqual(
            save_review.call_args.args,
            (
                "similar-track:a:b",
                "dismissed",
                "Confirmed separate tracks.",
            ),
        )
        self.assertEqual(save_review.call_args.kwargs["reviewed_by_admin_user_id"], 1)

    def test_review_route_rejects_hard_integrity_finding(self):
        report = {"issues": [{"key": "invalid-result-value", "dismissible": False}]}
        with (
            patch.object(
                admin_auth,
                "authenticate_admin",
                return_value=admin_auth.AdminActor(1, "test-uid", "owner@example.com", "owner"),
            ),
            patch.object(app_module.stats, "SessionLocal", return_value=nullcontext(object())),
            patch.object(
                app_module.database_health_service, "build_database_health", return_value=report
            ),
        ):
            response = self.client.post(
                "/api/database-health/reviews",
                json={
                    "issue_key": "invalid-result-value",
                    "status": "dismissed",
                    "note": "Ignore it.",
                },
            )

        self.assertEqual(response.status_code, 409)


if __name__ == "__main__":
    unittest.main()
