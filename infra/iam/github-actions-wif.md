# GitHub Actions Workload Identity Federation

## What It Is And Why It Exists

GitHub Actions is the repository automation runner. It executes tests and
deployments from a reviewed workflow. GitHub OpenID Connect (OIDC) gives each
eligible job a short-lived, signed identity token describing the repository,
event, branch, workflow, and run.

Google Workload Identity Federation (WIF) validates that OIDC token and exchanges
it for short-lived Google credentials. The job then impersonates the dedicated
`ctc-github-deployer` service account. No downloadable Google key or deprecated
Firebase CI token is stored in GitHub.

This matters because a long-lived service-account key remains usable until someone
finds and revokes it. The GitHub OIDC token is tied to one run and expires quickly,
while Google also checks the repository and branch claims before issuing access.

## Configured Trust

Created July 25, 2026:

| Resource | Value |
| --- | --- |
| Google Cloud project | `mkw-stats` (`1054134490602`) |
| Workload Identity Pool | `github-actions` |
| OIDC provider | `ctc-main` |
| Issuer | `https://token.actions.githubusercontent.com` |
| GitHub repository | `Revengestyle6/ctcMKWIIstatswebsite` |
| Immutable repository ID | `1138772443` |
| Immutable owner ID | `149913565` |
| Allowed ref | `refs/heads/main` |
| Allowed events | `push`, `workflow_dispatch` |
| Impersonated service account | `ctc-github-deployer@mkw-stats.iam.gserviceaccount.com` |

The provider checks immutable numeric repository and owner IDs in addition to the
`main` ref. Numeric IDs prevent a repository rename or later name reuse from
silently inheriting this trust. Pull-request jobs can run CI but cannot obtain a
deploy credential.

The service account permits impersonation only to this pool's
`attribute.repository_id/1138772443` principal set. Both the provider admission
condition and the service-account binding therefore have to pass.

## Deployer Permissions

| Grant | Scope | Why |
| --- | --- | --- |
| `roles/cloudbuild.builds.editor` | Project | Submit and observe the managed backend build |
| `roles/artifactregistry.reader` | Repository `ctc-backend` | Resolve and deploy the image produced by Cloud Build |
| `roles/run.developer` | Service `ctc-stats-api-staging` | Update only the existing staging API revision |
| `roles/run.developer` | Job `ctc-staging-migrate` | Update and execute only the existing staging migration job |
| `roles/iam.serviceAccountUser` | `ctc-api-staging` | Attach the staging runtime identity without receiving its secrets |
| `roles/iam.serviceAccountUser` | `ctc-db-migrator` | Attach the migrator identity without receiving its database credential |
| `roles/firebasehosting.admin` | Project | Create and release Firebase Hosting versions |
| `roles/serviceusage.apiKeysViewer` | Project | Let Firebase CLI read the public registered web-app configuration |

The deployer has no Cloud SQL Client, Secret Manager accessor, archive-bucket
access, production Cloud Run role, or ability to act as `ctc-api-prod`. Cloud Run
injects existing secret references into the runtime identities; the deployment
workflow never reads their values.

## Workflow And Deployment Order

`.github/workflows/ci-staging.yml` runs PostgreSQL-backed tests and frontend checks
for pull requests and `main`. Only a successful `main` push or an explicit manual
run on `main` can continue to the `staging` deployment job.

The deployment:

1. Exchanges GitHub OIDC for a short-lived deployer credential.
2. Uses Cloud Build to create a unique immutable Artifact Registry tag.
3. Resolves that tag to a content digest.
4. Updates and executes `ctc-staging-migrate` with the digest.
5. Updates `ctc-stats-api-staging` with the same digest.
6. Verifies the direct Cloud Run readiness endpoint.
7. Fetches the public Firebase web-app config from the registered app.
8. Builds React and releases Firebase Hosting.
9. Verifies readiness, data health, and the SPA through the Hosting origin.

The bootstrap job is intentionally absent. A normal code deployment must never
rebuild or reseed a populated database.

The workflow uses a deployment concurrency group so two staging migrations cannot
run at once. External GitHub Actions are pinned to complete commit SHAs. The
Firebase CLI is pinned exactly in `package-lock.json` and receives a disposable
runner configuration directory. The Cloud Build context is an allowlist in
`.gcloudignore`, and generated
`gha-creds-*.json` files are excluded from Git, Docker, and Cloud Build.

## GitHub Environments And Production

The staging job references the GitHub `staging` environment so GitHub records a
deployment and links it to `https://mkw-stats.web.app`. Google independently
enforces the `main` branch restriction even if the GitHub environment has no
protection rule.

There is intentionally no production deployment job or production WIF provider in
Phase 4. Before Phase 5, create a separate `production` GitHub environment with a
required reviewer and protected-branch policy, then create a separately scoped
Google provider/service account that can reach only production resources. Do not
expand `ctc-main` or the staging deployer to cover production.

## Verification And Revocation

After the workflow first runs from `main`, verify:

- the OIDC authentication step succeeds without a GitHub secret;
- tests finish before deployment starts;
- the migration execution succeeds;
- the service and migration job reference the same `sha256` digest;
- Firebase Hosting creates a new release;
- all final health checks return HTTP 200; and
- the deployer still has no service-account keys.

Emergency revocation has two independent controls:

1. Disable provider `ctc-main` to stop new GitHub token exchanges.
2. Remove the `roles/iam.workloadIdentityUser` binding from
   `ctc-github-deployer` to stop impersonation.

Disabling federation does not stop an already-running Cloud Run revision. It only
prevents future workflow credentials and deployments.
