FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Keep dependency installation in a cacheable layer.
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r ./backend/requirements.txt

COPY backend ./backend
COPY start.sh ./start.sh

# The checked-in archive is imported during the image build. The runtime user
# retains ownership because administrative uploads also update this directory.
RUN python ./backend/import_json_to_db.py --rebuild \
    && addgroup --system app \
    && adduser --system --ingroup app app \
    && chown -R app:app /app \
    && chmod +x /app/start.sh

USER app
WORKDIR /app/backend

EXPOSE 8080
CMD ["/app/start.sh"]
