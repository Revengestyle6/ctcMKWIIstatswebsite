# Build stage for frontend
FROM node:22 AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

# Runtime stage with Python and Node
FROM python:3.11-slim
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs

WORKDIR /app

# Copy backend first to install dependencies
COPY backend ./backend
RUN pip install --no-cache-dir -r ./backend/requirements.txt

# Copy frontend build
COPY --from=frontend-build /app/frontend/build ./frontend/build
COPY --from=frontend-build /app/frontend/package*.json ./frontend/

EXPOSE 5000
CMD ["sh", "-c", "cd backend && gunicorn app:app --bind 0.0.0.0:5000"]
