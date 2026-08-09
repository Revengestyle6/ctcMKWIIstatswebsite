import os
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from test_support import PostgreSQLTestDatabase, configure_test_environment

configure_test_environment()

from app import app  # noqa: E402
from models import (  # noqa: E402
    AdminAuditLog,
    AdminUser,
    Division,
    Season,
    Team,
    TeamLogo,
    TeamSeasonEntry,
)
from PIL import Image  # noqa: E402
from player_dashboard_stats import _team_logo_url  # noqa: E402
from team_logo_management import (  # noqa: E402
    create_team_logo,
    get_team_logo_detail,
    normalize_logo,
    update_team_logo,
)


def image_bytes(color, image_format="PNG"):
    stream = BytesIO()
    Image.new("RGBA", (80, 40), color).save(stream, image_format)
    return stream.getvalue()


class TeamLogoManagementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = PostgreSQLTestDatabase()
        cls.SessionLocal = cls.database.SessionLocal

    @classmethod
    def tearDownClass(cls):
        cls.database.close()

    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict(
            os.environ,
            {
                "APP_ENV": "test",
                "MEDIA_STORAGE_PROVIDER": "local",
                "MEDIA_STORAGE_ROOT": self.temporary_directory.name,
            },
        )
        self.environment.start()
        with self.SessionLocal.begin() as session:
            session.query(AdminAuditLog).delete()
            session.query(AdminUser).delete()
            session.query(TeamLogo).delete()
            session.query(TeamSeasonEntry).delete()
            session.query(Division).delete()
            session.query(Season).delete()
            session.query(Team).delete()
            team = Team(canonical_name="Cosmic Speed", canonical_tag="CS")
            season = Season(
                league_code="ctc",
                season_code="s3",
                season_number=3,
                name="Season 3",
                status="complete",
            )
            session.add_all((team, season))
            session.flush()
            division = Division(
                season_id=season.season_id,
                division_code="d1",
                division_name="Division 1",
            )
            session.add(division)
            session.flush()
            session.add(
                TeamSeasonEntry(
                    team_id=team.team_id,
                    season_id=season.season_id,
                    division_id=division.division_id,
                    display_name=team.canonical_name,
                    clan_tag=team.canonical_tag,
                )
            )
            self.team_id = team.team_id
            self.season_id = season.season_id
            session.add(
                AdminUser(
                    firebase_uid=None,
                    email="owner@example.com",
                    normalized_email="owner@example.com",
                    role="owner",
                    status="active",
                )
            )

    def tearDown(self):
        self.environment.stop()
        self.temporary_directory.cleanup()

    def test_image_is_normalized_to_bounded_webp(self):
        normalized = normalize_logo(image_bytes("red"))
        with Image.open(BytesIO(normalized)) as image:
            self.assertEqual(image.format, "WEBP")
            self.assertEqual(image.size, (80, 40))

    def test_upload_replaces_only_the_same_scope(self):
        with self.SessionLocal.begin() as session:
            _, default_logo = create_team_logo(
                session, self.team_id, image_bytes("red"), alt_text="Default logo"
            )
            _, season_logo = create_team_logo(
                session,
                self.team_id,
                image_bytes("blue"),
                season_id=self.season_id,
                alt_text="Season 3 logo",
            )
            _, replacement = create_team_logo(
                session,
                self.team_id,
                image_bytes("green"),
                season_id=self.season_id,
                alt_text="Replacement",
            )

            self.assertTrue(session.get(TeamLogo, default_logo.team_logo_id).is_active)
            self.assertFalse(session.get(TeamLogo, season_logo.team_logo_id).is_active)
            self.assertTrue(replacement.is_active)
            self.assertEqual(
                _team_logo_url(session, self.team_id, self.season_id),
                f"/api/team-logos/{replacement.team_logo_id}/content",
            )
            self.assertTrue(Path(self.temporary_directory.name, replacement.asset_path).is_file())

    def test_existing_logo_can_be_reactivated_and_alt_text_updated(self):
        with self.SessionLocal.begin() as session:
            _, first = create_team_logo(session, self.team_id, image_bytes("red"), alt_text="First")
            create_team_logo(session, self.team_id, image_bytes("blue"), alt_text="Second")
            detail, updated = update_team_logo(
                session,
                self.team_id,
                first.team_logo_id,
                {"is_active": True, "alt_text": "Restored logo"},
            )
            self.assertTrue(updated.is_active)
            self.assertEqual(updated.alt_text, "Restored logo")
            self.assertEqual(sum(logo["is_active"] for logo in detail["logos"]), 1)

    def test_team_detail_lists_only_participating_seasons(self):
        with self.SessionLocal() as session:
            detail = get_team_logo_detail(session, self.team_id)
            self.assertEqual([season["season"] for season in detail["seasons"]], ["s3"])

    def test_rejects_unsupported_content(self):
        with self.assertRaisesRegex(ValueError, "valid supported image"):
            normalize_logo(b"not an image")

    def test_admin_upload_and_public_content_routes(self):
        headers = {"X-Dev-Admin-Email": "owner@example.com"}
        with (
            patch.dict(os.environ, {"ALLOW_DEV_AUTH": "true"}),
            patch("admin_auth.SessionLocal", self.SessionLocal),
            patch("routes.admin.stats.SessionLocal", self.SessionLocal),
            patch("routes.public.stats.SessionLocal", self.SessionLocal),
            app.test_client() as client,
        ):
            response = client.post(
                f"/api/admin/teams/{self.team_id}/logos",
                data={
                    "image": (BytesIO(image_bytes("purple")), "logo.png"),
                    "season_id": str(self.season_id),
                    "alt_text": "Season logo",
                },
                headers=headers,
                content_type="multipart/form-data",
            )
            self.assertEqual(response.status_code, 201, response.get_json())
            logo = response.get_json()["logos"][0]
            self.assertTrue(logo["is_active"])
            content = client.get(logo["url"])
            self.assertEqual(content.status_code, 200)
            self.assertEqual(content.content_type, "image/webp")
            self.assertEqual(
                content.headers["Cache-Control"], "public, max-age=31536000, immutable"
            )


if __name__ == "__main__":
    unittest.main()
