import io
import json
import os
import unittest
from unittest.mock import patch

import test_support  # noqa: F401 - configure the test database before importing routes.
from admin_auth import AdminActor
from app import app
from PIL import Image
from race_results_image import ImportLimitReached, InvalidGeminiResponse, read_results
from requests import Response, Timeout

PATH = "/api/admin/race-results-image"
ROSTER = ["ベイ☆", "Δάφνη", "Guest"]


def provider_response(rows=(), status=200):
    response = Response()
    response.status_code = status
    response._content = json.dumps(
        {
            "candidates": [
                {
                    "finishReason": "STOP",
                    "content": {"parts": [{"text": json.dumps({"rows": list(rows)})}]},
                }
            ],
            "usageMetadata": {"promptTokenCount": 315},
        }
    ).encode()
    return response


class RaceImageImportTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        self.actor = AdminActor(7, "fixture-uid", "fixture@example.com", "admin")
        self.env = self.enterContext(
            patch.dict(
                os.environ,
                {
                    "APP_ENV": "test",
                    "RACE_IMAGE_IMPORT_ENABLED": "true",
                    "GEMINI_API_KEY": "fixture-api-key",
                },
            )
        )
        self.enterContext(patch("admin_auth.SessionLocal"))
        self.auth = self.enterContext(
            patch("admin_auth.authenticate_admin", return_value=self.actor)
        )
        self.enterContext(patch("routes.race_results.SessionLocal"))
        self.reserve = self.enterContext(patch("routes.race_results.reserve_attempt"))
        self.provider = self.enterContext(
            patch("race_results_image.requests.post", return_value=provider_response())
        )
        self.log = self.enterContext(patch("routes.race_results.log_event"))

    def post(self, valid_image=True):
        image = io.BytesIO()
        if valid_image:
            Image.new("RGB", (100, 100)).save(image, "PNG")
        return self.client.post(
            PATH,
            data={
                "image": (io.BytesIO(image.getvalue()), "race.png"),
                "roster": json.dumps(ROSTER),
                "roomSize": "10",
            },
        )

    def test_requires_admin_and_enabled_pilot(self):
        self.auth.return_value = None
        self.assertEqual(self.post().status_code, 401)
        self.auth.return_value = self.actor
        self.env["APP_ENV"] = "production"
        self.assertEqual(self.client.get(PATH).json, {"enabled": False})
        self.assertEqual(self.post().status_code, 404)
        self.provider.assert_not_called()

    def test_sends_one_image_and_uses_printed_positions(self):
        self.provider.return_value = provider_response(
            [
                {"position": 3, "name": "ベイ★", "suggestions": [0]},
                {"position": None, "name": "Δάφνη", "suggestions": [1]},
                {"position": 7, "name": "Guest", "suggestions": []},
            ]
        )
        response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["position"] for row in response.json["rows"]], [3, None, 7])
        self.provider.assert_called_once()
        self.reserve.assert_called_once()
        url = self.provider.call_args.args[0]
        call = self.provider.call_args.kwargs
        self.assertTrue(url.endswith("/gemini-3.1-flash-lite:generateContent"))
        self.assertEqual(
            set(
                call["json"]["generationConfig"]["responseJsonSchema"]["properties"]["rows"][
                    "items"
                ]["required"]
            ),
            {"position", "name", "suggestions"},
        )
        self.assertEqual(call["headers"], {"x-goog-api-key": "fixture-api-key"})
        parts = call["json"]["contents"][0]["parts"]
        self.assertEqual(parts[1]["inlineData"]["mimeType"], "image/jpeg")
        self.assertEqual(json.loads(parts[0]["text"])["roster"][0], {"id": 0, "miiName": "ベイ☆"})
        self.assertEqual(self.log.call_args.args, ("race_image_gemini_attempt", "ok"))
        self.assertEqual(self.log.call_args.kwargs["promptTokenCount"], 315)
        self.assertNotIn("ベイ", str(self.log.call_args))

    def test_paid_usage_defaults_allow_more_than_one_full_match(self):
        for key in ("MINUTE", "DAY", "USER_HOUR"):
            self.env.pop(f"RACE_IMAGE_REQUESTS_PER_{key}", None)
        self.assertEqual(self.post().status_code, 200)
        self.assertEqual(self.reserve.call_args.args[3:], (24, 200, 60))

    def test_invalid_image_or_exhausted_app_quota_does_not_call_provider(self):
        self.assertEqual(self.post(valid_image=False).status_code, 400)
        self.reserve.assert_not_called()
        self.reserve.side_effect = ImportLimitReached
        self.assertEqual(self.post().status_code, 429)
        self.provider.assert_not_called()
        self.log.assert_called_once_with("race_image_quota_rejected", "app_quota")

    def test_provider_errors_are_degraded_and_logged(self):
        self.provider.return_value = provider_response(status=429)
        self.assertEqual(self.post().status_code, 429)
        self.assertEqual(self.log.call_args.args[-1], "provider_quota")
        self.provider.side_effect = Timeout
        self.assertEqual(self.post().status_code, 504)
        self.assertEqual(self.log.call_args.args[-1], "timeout")

    def test_minute_quota_returns_a_retry_delay_without_calling_gemini(self):
        self.reserve.side_effect = ImportLimitReached(retry_after_seconds=3)
        response = self.post()
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json["retry_after_seconds"], 3)
        self.provider.assert_not_called()

    def test_rejects_unknown_suggestions_and_invalid_positions(self):
        row = {"position": 12, "name": "Guest", "suggestions": [2]}
        self.assertIsNone(read_results(provider_response([row]).json(), ROSTER, 10)[0]["position"])
        for change in ({"suggestions": [3]}, {"position": True}):
            with self.assertRaises(InvalidGeminiResponse):
                read_results(provider_response([{**row, **change}]).json(), ROSTER, 10)


if __name__ == "__main__":
    unittest.main()
