# ADR 0001: Google-Managed Production Platform

- Status: Accepted
- Date: July 19, 2026

## Context

The application has a static React frontend, a Flask API, a small SQL database, and
roughly 60 MB of static media. The project has $150 of Google Cloud credits and seeks
low cost, good response times, minimal infrastructure maintenance, custom-domain
support, and reproducible deployments.

The current repository contains GitHub Pages, Render, Railway, and Docker deployment
artifacts, but no single configuration deploys the complete durable application.

## Decision

Use:

- Firebase Hosting for the React application, media, CDN, custom domain, and TLS.
- A Firebase Hosting `/api/**` rewrite to a Flask service on Cloud Run.
- Request-based Cloud Run billing with zero minimum instances initially.
- One compatible US region for Cloud Run, Cloud SQL, and archive storage.
- GitHub Actions authenticated through Google Workload Identity Federation.
- Use `us-central1` for the initial Cloud Run, Cloud SQL, and Cloud Storage
  resources.
- Use request-based Cloud Run billing with zero minimum instances. Cold starts are
  acceptable at launch in exchange for the lowest idle cost.
- Use a Firebase-provided subdomain for staging. Select and connect a custom domain
  before production cutover.
- Treat the initial service as best-effort availability without a formal SLA and
  improve availability only when usage or operational evidence justifies the cost.

## Alternatives Considered

### Existing GitHub Pages And Render Split

Low initial effort, but it preserves a hard-coded cross-origin dependency and does
not solve durable uploads, unified operations, or deployment inconsistency.

### Railway

Simple application deployment and volumes, but it would leave database operations
more self-managed and would not use the available Google Cloud credits.

### Single Compute Engine VM

Potentially the lowest bill, but the team would own patching, TLS, process
supervision, database maintenance, and recovery.

### Firebase App Hosting

More automation than this Vite single-page application needs. Firebase Hosting plus
Cloud Run keeps the frontend static and the backend boundary explicit.

## Consequences

- Static delivery is fast and globally cached.
- The frontend and API can share one browser origin.
- The API can scale to zero, accepting occasional cold-start latency.
- The repository needs separate frontend and API deployment artifacts.
- Container-local files cannot be treated as durable.
- Firebase Hosting bandwidth, especially media transfer, must be monitored.
- Superseded Render, Railway, and GitHub Pages definitions can be retired after a
  successful cutover.

## Acceptance

Accepted by the owner on July 19, 2026. The owner explicitly prioritized the lowest
initial operating cost, with capacity and availability improvements to follow when
they are justified by measured usage.
