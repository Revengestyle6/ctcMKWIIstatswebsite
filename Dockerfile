FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Keep dependency installation in a cacheable layer.
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r ./backend/requirements.txt

COPY backend ./backend
COPY alembic.ini ./alembic.ini
COPY start.sh ./start.sh

# Schema migrations and seed imports are explicit deployment jobs. The API image
# never mutates a database while it is being built.
RUN addgroup --system app \
    && adduser --system --ingroup app app \
    && chown -R app:app /app \
    && chmod +x /app/start.sh

USER app
WORKDIR /app/backend

EXPOSE 8080
CMD ["/app/start.sh"]
