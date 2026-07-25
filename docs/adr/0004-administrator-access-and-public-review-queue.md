# ADR 0004: Administrator Access And Public Review Queue

- Status: Accepted
- Date: July 19, 2026

## Context

The public needs to validate and submit imperfect match JSON for human review, but
only trusted administrators may write analytics data. Administrators also need
read-only SQL access and repository collaboration without receiving general Google
Cloud administration. Container-local queue, archive, and review state would not
survive Cloud Run lifecycle events.

## Decision

- Public analytics and local JSON editing remain anonymous.
- Anonymous users may submit server-valid JSON, including acknowledged warnings,
  to a temporary administrator review queue.
- Validation errors block queue submission.
- Rejected, failed, and abandoned queue objects never enter the accepted archive
  and expire after 30 days.
- Only canonical cleaned JSON whose PostgreSQL match transaction committed is
  promoted to the immutable accepted archive.
- Administrators authenticate with verified Firebase Google identities and must be
  granted an active application role by the owner.
- All administrators may review/import JSON and view sensitive operational pages.
- The owner alone manages application administrators and cloud infrastructure.
- Administrators receive IAM-authenticated, read-only PostgreSQL access. Direct
  production writes remain confined to the application, reviewed migrations, and
  owner-controlled recovery procedures.
- Administrators receive GitHub Write access for feature branches and pull
  requests. Protected branches require passing checks and owner/code-owner
  approval.
- The application does not hold credentials capable of modifying Google Cloud IAM
  or GitHub collaborator access.
- Normal development uses local PostgreSQL. Staging and production initially use
  separate databases and roles on one cost-first Cloud SQL instance.
- Daily automated backups, seven retained backups, and seven-day point-in-time
  recovery remain enabled year-round.

## Consequences

- Public submissions require abuse controls, temporary storage lifecycle rules,
  server-side revalidation, and an administrator queue.
- Application, database, repository, and cloud permissions remain separate and can
  be revoked independently.
- Read-only SQL access supports investigation without bypassing the accepted JSON
  ingestion contract.
- A shared initial Cloud SQL instance minimizes fixed cost but staging load and
  destructive migration rehearsals require care.
- Provider access onboarding remains an owner-run checklist rather than a
  high-privilege application automation feature.

## Acceptance

Accepted by the owner on July 19, 2026. Detailed schema and workflow proposals are
recorded in `docs/md/phase-3-technical-specification.md`. The owner approved the
specification checkpoint before implementation began.
