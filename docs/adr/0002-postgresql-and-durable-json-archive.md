# ADR 0002: PostgreSQL And Durable JSON Archive

- Status: Accepted
- Date: July 19, 2026

## Context

Analytics are now SQL-backed, and future match entry will use the JSON editor. The
current SQLite database and archived JSON reside on the local filesystem. Cloud Run
filesystems are temporary, and the application needs concurrent reads, safe writes,
backups, migrations, and recovery.

The Phase 0 reproducibility baseline initially found that rebuilding the checked-in
data created 273 players while the working database had 268. Five historical
friend-code merges existed only in the working database. The owner confirmed those
groups, and they are now represented in the identity registry.

## Decision

- Use Cloud SQL for PostgreSQL as the production operational database.
- Use Alembic for all production schema changes.
- Store uploaded JSON as immutable objects in Cloud Storage.
- Treat archived JSON as the audit/input record and PostgreSQL as the operational
  source for application reads and analytics.
- Rebuild staging and production from the authoritative JSON and registries rather
  than copying SQLite directly.
- Use staged objects, stable fingerprints, explicit upload states, and reconciliation
  for the cross-system upload workflow.
- Retain SQLite only for lightweight local work and selected tests.
- Start with this lowest-cost Cloud SQL configuration:
  - Cloud SQL Enterprise edition in `us-central1`.
  - PostgreSQL 18.
  - One `db-f1-micro` shared-core instance with no Cloud SQL SLA.
  - Single-zone availability, disabled data cache, and 10 GB SSD storage.
  - Public IP reached from Cloud Run through the Cloud SQL connector; do not expose
    the database through unrestricted authorized networks.
  - Standard daily automated backups retaining seven backups.
  - Point-in-time recovery enabled with seven days of transaction logs.
- Revisit compute, memory, storage, networking, and availability only in response to
  measured capacity, latency, reliability, or recovery needs.

## Alternatives Considered

### Neon PostgreSQL

Potentially lower cost and capable of scaling to zero, but adds a provider, possible
database cold starts, cross-provider networking, and a shorter free recovery window.

### SQLite On A Persistent VM Disk

Simple and inexpensive, but couples database durability to one VM and leaves more
backup, concurrency, and failover responsibility with the team.

### PostgreSQL On A Compute Engine VM

Uses a standard database but requires self-managed patching, backup scheduling,
monitoring, and recovery.

## Consequences

- Cloud SQL becomes the main fixed monthly cost.
- Google documents `db-f1-micro` as a low-cost test/development tier and excludes it
  from the Cloud SQL SLA. Using it for the initial community deployment is an
  explicit cost-first exception; sustained memory pressure, connection exhaustion,
  or unacceptable latency should trigger an upgrade.
- SQLite-specific health queries must be made portable.
- A PostgreSQL driver, migrations, connection pooling, and integration tests are
  required.
- Upload code must abstract local and Cloud Storage archive implementations.
- Automated backups, point-in-time recovery, logical exports, and restore drills
  become required operations.
- The confirmed historical identity groups must remain in source registries and be
  checked during staging and production rebuilds.

## Acceptance

Accepted by the owner on July 19, 2026. All five historical identity groups were
confirmed and added to `backend/data/player_identities.csv`. A clean rebuild then
matched the working database at 268 players and 291 friend codes with identical
identity partitions.
