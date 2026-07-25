#!/bin/sh
set -e
cd /app/backend
exec gunicorn app:app \
  --bind "0.0.0.0:${PORT:-5000}" \
  --workers "${GUNICORN_WORKERS:-1}" \
  --threads "${GUNICORN_THREADS:-8}" \
  --timeout "${GUNICORN_TIMEOUT_SECONDS:-60}"
