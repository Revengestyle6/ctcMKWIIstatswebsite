import logging
import os
import time
import uuid

# These imports remain public for compatibility with existing tests and maintenance tools.
import dashboard_stats as dashboards
import database_health as database_health_service
import stats_db as stats
from database import app_environment
from extensions import cache
from flask import Flask, g, request
from flask_compress import Compress
from flask_cors import CORS
from routes.access import access_api
from routes.admin import admin_api
from routes.operations import operations_api
from routes.public import public_api
from routes.reviews import reviews_api

__all__ = ["app", "cache", "create_app", "dashboards", "database_health_service", "stats"]


def create_app(config=None):
    """Create and configure the Flask application."""
    application = Flask(__name__)
    application.config.from_mapping(
        JSON_SORT_KEYS=False,
        CACHE_TYPE="simple",
        CACHE_DEFAULT_TIMEOUT=3600,
    )
    if config:
        application.config.update(config)

    if app_environment() in {"local", "test"}:
        CORS(application)
    Compress(application)
    cache.init_app(application)
    application.register_blueprint(public_api)
    application.register_blueprint(admin_api)
    application.register_blueprint(access_api)
    application.register_blueprint(reviews_api)
    application.register_blueprint(operations_api)

    @application.before_request
    def start_request():
        supplied_id = request.headers.get("X-Request-ID", "").strip()
        g.request_id = supplied_id[:128] if supplied_id else str(uuid.uuid4())
        g.request_started_at = time.monotonic()

    @application.after_request
    def finish_request(response):
        response.headers["X-Request-ID"] = g.request_id
        actor = getattr(g, "admin_actor", None)
        logging.getLogger("request").info(
            "request_id=%s method=%s path=%s status=%s duration_ms=%.1f actor=%s",
            g.request_id,
            request.method,
            request.path,
            response.status_code,
            (time.monotonic() - g.request_started_at) * 1000,
            actor.email if actor else "anonymous",
        )
        return response

    return application


logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
app = create_app()


if __name__ == "__main__":
    app.run(debug=True)
