# Architecture Decision Records

Architecture decision records preserve the context, options, and consequences of
production-impacting choices. They are not implementation plans.

Statuses:

- `Proposed`: Recommended but awaiting explicit approval.
- `Accepted`: Approved for implementation.
- `Superseded`: Replaced by a later ADR.
- `Rejected`: Considered and deliberately not selected.

Do not rewrite an accepted decision to hide changed reasoning. Add a new ADR that
supersedes it.

## Records

- [ADR 0001: Google-managed production platform](0001-google-managed-production-platform.md)
- [ADR 0002: PostgreSQL and durable JSON archive](0002-postgresql-and-durable-json-archive.md)
- [ADR 0003: Firebase administrator authentication](0003-firebase-administrator-authentication.md)
- [ADR 0004: Administrator access and public review queue](0004-administrator-access-and-public-review-queue.md)

## Reading historical decisions against current code

ADR 0002 originally allowed selected SQLite development/tests. The subsequent
PostgreSQL-only implementation retired those adapters and tools; current setup and
tests require PostgreSQL. Preserve that ADR's historical reasoning and consult the
[data model](../architecture/data-model.md) and [local setup](../development/local-development-startup.md)
for the implemented state. Likewise, accepted production direction does not mean
production cutover has occurred; see the [staging roadmap](../roadmap/README.md).
