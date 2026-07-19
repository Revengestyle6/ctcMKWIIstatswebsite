# CTC MKWII Stats Website Documentation

This directory documents how the current Season 1 stats website is built, how data moves through it, where configuration lives, and what should change to support Season 2 historical analytics plus ongoing Season 3 updates.

## Document Map

- [Architecture](architecture.md): high-level app structure and request/data flow.
- [Backend](backend.md): Flask app, API endpoints, stats helper behavior, and known backend issues.
- [Frontend](frontend.md): React/Vite UI routes, components, assets, and API usage.
- [Data Pipeline](data-pipeline.md): MKW Table Bot JSON input format, extraction process, CSV schema, and current maintenance workflow.
- [JSON Database Schema](json-database-schema.md): raw JSON structure analysis and a proposed analytics-ready relational schema.
- [Analytics Database](database.md): SQLAlchemy/SQLite implementation, rebuild command, and current import summary.
- [Database Health Dashboard](database-health-dashboard.md): implemented monitoring checks, UI behavior, limitations, and potential next steps.
- [Backend Database Migration Plan](backend-database-migration-plan.md): plan for moving Flask analytics endpoints from CSV files to SQLite/SQLAlchemy.
- [Frontend Backend Update Plan](frontend-backend-update-plan.md): plan for updating React pages to use season/division-aware database-backed API calls.
- [Deployment](deployment.md): Render, Railway, Docker, GitHub Pages, and local development notes.
- [Environment And Secrets](environment-and-secrets.md): every observed environment variable, external service URL, and secret-like dependency.
- [Vision](vision.md): proposed direction for Season 2 and live Season 3 maintainability.

## One-Sentence Summary

The website is a React/Vite frontend that calls a Flask API; the Flask API reads pre-generated CSV files created from MKW Table Bot JSON match files and returns rankings, averages, and comparison lists.

## Current State

The codebase is centered on Season 1. Data is split by division:

- `backend/CSV/ctc_d1_2.csv`
- `backend/CSV/ctc_d3.csv`
- `backend/CSV/ctc_d4.csv`

The original JSON/text match files live under the league/season/division hierarchy:

- `backend/JSON/ctc/s1/d1_2/`
- `backend/JSON/ctc/s1/d3/`
- `backend/JSON/ctc/s1/d4/`

The current app has no upload UI, no database, and no automatic pipeline trigger. New data must currently be added to the repo and converted into CSV manually or with a script call.
