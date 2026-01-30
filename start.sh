#!/bin/sh
set -e
cd /app/backend
exec gunicorn app:app --bind 0.0.0.0:${PORT:-5000}
