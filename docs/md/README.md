# Project Documentation

## Current System

- [Architecture](architecture.md): application boundaries and request/data flow.
- [Backend](backend.md): Flask modules, API groups, and supported commands.
- [Frontend](frontend.md): React routes, assets, API client, build, and browser tests.
- [Data Pipeline](data-pipeline.md): archived JSON, registries, ingestion, and analytics flow.
- [Analytics Database](database.md): PostgreSQL, SQLAlchemy, Alembic, and ingestion workflow.
- [JSON Database Schema](json-database-schema.md): source JSON and relational schema.
- [Database Health Dashboard](database-health-dashboard.md): integrity and review checks.
- [Dashboard Analytics Methodology](dashboard-analytics-methodology.md): runner/bagger metrics and exclusions.
- [Environment And Secrets](environment-and-secrets.md): supported local and runtime configuration.
- [Local Development Startup](local-development-startup.md): start PostgreSQL, Flask, Vite, and real Firebase Google sign-in.
- [Deployment](deployment.md): current transitional artifacts and accepted target platform.
- [Legacy Deployment Integration Cleanup](legacy-deployment-cleanup.md): disconnect obsolete Vercel and GitHub Pages automation and correct GitHub deployment metadata.
- [Cloud SQL Read-Only Access](cloud-sql-read-access.md): grant, verify, use, and revoke human database access.

## Production Readiness

- [Production Readiness Plan](production-readiness-plan.md)
- [Phase 0 Baseline](phase-0-production-baseline.md)
- [Phase 1 Cleanup Inventory](repository-cleanup-inventory.md)
- [Phase 2 No-Change Refactor](phase-2-no-change-refactor.md)
- [Phase 3 Technical Specification](phase-3-technical-specification.md)
- [Phase 3 Local Implementation](phase-3-local-implementation.md)
- [Phase 4 Resource Inventory](phase-4-resource-inventory.md)
- [Architecture Decision Records](../adr/README.md)
- [Regression Baselines](../baselines/README.md)

Completed implementation plans, old prototypes, and superseded reports live under
[`docs/archive/`](../archive/README.md). They are historical context, not current
operating instructions.
