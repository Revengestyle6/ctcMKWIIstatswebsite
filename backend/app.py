import logging
import os

# These imports remain public for compatibility with existing tests and maintenance tools.
import dashboard_stats as dashboards
import database_health as database_health_service
import stats_db as stats
from database import init_database
from extensions import cache
from flask import Flask
from flask_compress import Compress
from flask_cors import CORS
from routes.admin import admin_api
from routes.public import public_api

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

    CORS(application)
    Compress(application)
    cache.init_app(application)
    application.register_blueprint(public_api)
    application.register_blueprint(admin_api)
    return application


logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
init_database()
app = create_app()


if __name__ == "__main__":
    app.run(debug=True)
