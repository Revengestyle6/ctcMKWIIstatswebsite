import io
import json
import os
import re
import time

import requests
from admin_auth import SessionLocal, require_admin
from database import app_environment
from flask import Blueprint, g, jsonify, request
from race_results_image import (
    MAX_IMAGE_BYTES,
    MODEL,
    ImportLimitReached,
    InvalidGeminiResponse,
    parse_import,
    read_results,
    request_results,
    reserve_attempt,
)
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.formparser import parse_form_data

race_results_api = Blueprint("race_results", __name__)
PROVIDER_ERROR = "Image recognition is temporarily unavailable. You can enter placements manually."
QUOTA_ERROR = (
    "Image import has reached its usage limit. Try again later or enter placements manually."
)


def pilot_key():
    if (
        app_environment() in {"local", "test", "staging"}
        and os.getenv("RACE_IMAGE_IMPORT_ENABLED") == "true"
    ):
        return os.getenv("GEMINI_API_KEY", "").strip()
    return ""


@race_results_api.get("/api/admin/race-results-image")
@require_admin
def import_availability():
    return jsonify(enabled=bool(pilot_key()))


@race_results_api.post("/api/admin/race-results-image")
@require_admin
def import_race_results():
    key = pilot_key()
    if not key:
        return jsonify(error="Image import is unavailable."), 404
    if request.mimetype != "multipart/form-data":
        return jsonify(error="Choose a results image."), 400
    try:
        _, fields, files = parse_form_data(
            request.environ,
            stream_factory=lambda **_: io.BytesIO(),
            max_content_length=MAX_IMAGE_BYTES + 24_000,
            max_form_memory_size=128_000,
            max_form_parts=3,
        )
        try:
            image, roster, room_size = parse_import(
                files.get("image"), fields.get("roster"), fields.get("roomSize")
            )
        finally:
            for _, uploaded_file in files.items(multi=True):
                uploaded_file.close()
    except RequestEntityTooLarge:
        return jsonify(error="The prepared image is too large. Choose a smaller image."), 413
    except ValueError as error:
        return jsonify(error=str(error)), 400

    try:
        with SessionLocal.begin() as session:
            reserve_attempt(
                session,
                app_environment(),
                g.admin_actor.admin_user_id,
                max(1, int(os.getenv("RACE_IMAGE_REQUESTS_PER_MINUTE", "24"))),
                max(1, int(os.getenv("RACE_IMAGE_REQUESTS_PER_DAY", "200"))),
                max(1, int(os.getenv("RACE_IMAGE_REQUESTS_PER_USER_HOUR", "60"))),
            )
    except ImportLimitReached as error:
        log_event("race_image_quota_rejected", "app_quota")
        return jsonify(error=QUOTA_ERROR, retry_after_seconds=error.retry_after_seconds), 429

    started = time.monotonic()
    outcome = "error"
    status = None
    usage = {}
    try:
        response = request_results(key, image, roster, room_size)
        status = response.status_code
        if status == 429:
            outcome = "provider_quota"
            return jsonify(error=QUOTA_ERROR), 429
        if status != 200:
            outcome = "provider_error"
            return jsonify(error=PROVIDER_ERROR), 502
        data = response.json()
        if isinstance(data, dict) and isinstance(data.get("usageMetadata"), dict):
            usage = {
                key: data["usageMetadata"][key]
                for key in (
                    "promptTokenCount",
                    "candidatesTokenCount",
                    "thoughtsTokenCount",
                    "totalTokenCount",
                )
                if type(data["usageMetadata"].get(key)) is int
            }
        rows = read_results(data, roster, room_size)
        outcome = "ok" if rows else "no_rows"
        return jsonify(rows=rows)
    except requests.Timeout:
        outcome = "timeout"
        return jsonify(error=PROVIDER_ERROR), 504
    except (InvalidGeminiResponse, requests.exceptions.JSONDecodeError):
        outcome = "invalid_response"
        return jsonify(
            error="The image could not be read. Try a clearer image or enter placements manually."
        ), 502
    except requests.RequestException:
        outcome = "network_error"
        return jsonify(error=PROVIDER_ERROR), 502
    finally:
        log_event(
            "race_image_gemini_attempt",
            outcome,
            model=MODEL,
            provider_status=status,
            duration_ms=round((time.monotonic() - started) * 1000),
            **usage,
        )


def log_event(event, outcome, **metadata):
    entry = {"event": event, "outcome": outcome, **metadata}
    if re.fullmatch(r"[a-fA-F0-9-]{36}", g.request_id):
        entry["request_id"] = g.request_id
    trace = request.headers.get("X-Cloud-Trace-Context", "").partition("/")[0]
    project = os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("FIREBASE_PROJECT_ID")
    if project and re.fullmatch(r"[a-f0-9]{32}", trace):
        entry["logging.googleapis.com/trace"] = f"projects/{project}/traces/{trace}"
    print(json.dumps(entry), flush=True)
