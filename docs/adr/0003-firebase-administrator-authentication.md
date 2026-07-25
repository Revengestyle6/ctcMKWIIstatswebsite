# ADR 0003: Firebase Administrator Authentication

- Status: Accepted
- Date: July 19, 2026

## Context

Public analytics should remain publicly readable. JSON ingestion, health review
actions, database addition details, and sensitive operational information require
administrator authorization. The current application optionally accepts one static
bearer token and otherwise permits local writes. A static token must not be embedded
in a production frontend bundle.

## Decision

- Use Firebase Authentication with Google sign-in for administrator sessions.
- Send short-lived Firebase ID tokens to Flask.
- Verify ID tokens server-side and authorize against an explicit administrator
  allowlist or role claim.
- Keep public read endpoints unauthenticated.
- Require authorization for mutation endpoints and sensitive operational endpoints.
- Store transitional secrets in Secret Manager, never in Git or frontend assets.
- Keep only a non-sensitive health status summary public. Require administrator
  authorization for record-level findings, review state, archive reconciliation,
  database-addition details, and all health mutations.
- Configure administrator email addresses as deployment settings rather than source
  code. The initial owner email is supplied when staging authentication is
  configured.

## Alternatives Considered

### Continue With One Bearer Token

Simple, but difficult to rotate safely, provides no individual accountability, and
encourages copying a privileged credential between collaborators.

### Protect The Entire Cloud Run Service With IAM

Strong for a private service, but incompatible with the requirement for public
analytics unless the public and administrator APIs are separated.

### Build Local Username/Password Authentication

Adds password storage, recovery, session security, and account-management work that
is unnecessary for a small Google-account administrator group.

## Consequences

- Administrator actions can be attributed to an individual account.
- The frontend gains a login/session integration, which is a reviewed production
  behavior change rather than part of the no-change refactor.
- The Flask service needs Firebase token verification and authorization middleware.
- Staging and production need separate authorized-domain and administrator settings.

## Acceptance

Accepted by the owner on July 19, 2026. Google accounts are the required
administrator identity. The concrete allowlist remains deployment configuration and
is not recorded in the repository.
