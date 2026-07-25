# Cloud SQL Read-Only Access

## Purpose

This runbook grants a person direct, read-only SQL access to the project's
staging and production databases. It does not grant application administration,
Firebase administration, database writes, migrations, secret access, deployment
access, or general Google Cloud administration.

The access model has three independent layers:

1. `roles/cloudsql.client` permits a Google identity to connect to the Cloud SQL
   instance through the Cloud SQL Auth Proxy.
2. `roles/cloudsql.instanceUser` permits that identity to use Cloud SQL IAM
   database authentication.
3. Membership in the PostgreSQL role `ctc_readonly` permits `CONNECT`, schema
   usage, and table/sequence reads inside `ctc_staging` and `ctc_prod`.

All three are required. A Cloud SQL IAM database user has no useful application
database privileges unless it also inherits `ctc_readonly`.

## Current Resources

| Setting | Value |
| --- | --- |
| Google Cloud project | `mkw-stats` |
| Cloud SQL instance | `mkw-stats-prod-pg18` |
| Instance connection name | `mkw-stats:us-central1:mkw-stats-prod-pg18` |
| Databases | `ctc_staging`, `ctc_prod` |
| PostgreSQL group role | `ctc_readonly` |
| Authentication | Automatic Cloud SQL IAM database authentication |

The IAM grants below are project-level. They therefore apply to every Cloud SQL
instance in `mkw-stats`, not just the current instance. The Cloud SQL database
identity and PostgreSQL grants remain instance-specific. Before adding another
instance to this project, review whether the readers should also reach it and
replace the broad binding with an instance-restricted IAM design if necessary.

## Individual Reader Onboarding

Use a verified Google Account email, written entirely in lowercase. The operator
must be allowed to update project IAM and manage Cloud SQL users.

Record the reader's email, approver, purpose, grant date, and intended review or
removal date before making the change. Also record whether each IAM role was
already present; offboarding must not remove access the person needs for an
unrelated responsibility.

Replace `reader@example.com` in every command:

```bash
gcloud projects add-iam-policy-binding mkw-stats \
  --member="user:reader@example.com" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding mkw-stats \
  --member="user:reader@example.com" \
  --role="roles/cloudsql.instanceUser"

gcloud sql users create reader@example.com \
  --instance=mkw-stats-prod-pg18 \
  --type=cloud_iam_user \
  --database-roles=ctc_readonly \
  --project=mkw-stats
```

Do not grant `cloudsqlsuperuser`, `ctc_migrator`, `ctc_app_prod`, or
`ctc_app_staging`. Do not create or distribute a database password or service
account key for a human reader.

If the Cloud SQL IAM user already exists, do not recreate it. Add the database
role to the existing account:

```bash
gcloud sql users assign-roles reader@example.com \
  --instance=mkw-stats-prod-pg18 \
  --type=cloud_iam_user \
  --database-roles=ctc_readonly \
  --project=mkw-stats
```

## Reader Connection

The reader needs the Google Cloud CLI, Cloud SQL Auth Proxy v2, and PostgreSQL's
`psql` client. Authenticate the CLI and Application Default Credentials with the
same Google identity that was onboarded:

```bash
gcloud config set project mkw-stats
gcloud auth login reader@example.com
gcloud config set account reader@example.com
gcloud auth application-default login
```

Start the proxy in one terminal. Port `55433` is an arbitrary local port and can
be changed if it is already occupied:

```bash
cloud-sql-proxy \
  --auto-iam-authn \
  --address=127.0.0.1 \
  --port=55433 \
  mkw-stats:us-central1:mkw-stats-prod-pg18
```

Connect from a second terminal:

```bash
psql \
  --host=127.0.0.1 \
  --port=55433 \
  --username=reader@example.com \
  --dbname=ctc_prod
```

Use `ctc_staging` instead of `ctc_prod` to inspect staging. Automatic IAM
authentication supplies the temporary login token; the reader should not enter
or store a database password.

## Verification

Run these checks after connecting to each database:

```sql
SELECT current_user, current_database();

SELECT
  pg_has_role(current_user, 'ctc_readonly', 'member') AS is_readonly_member,
  has_database_privilege(
    current_user, current_database(), 'CONNECT'
  ) AS can_connect,
  has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_schema,
  has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_schema;
```

Expected results are `true`, `true`, `true`, and `false`, respectively. Verify
that a representative application table can be selected once migrations have
created tables. Do not use a production write as a permission test.

The operator can also confirm the Cloud SQL identity and IAM bindings:

```bash
gcloud sql users list \
  --instance=mkw-stats-prod-pg18 \
  --project=mkw-stats \
  --filter="name=reader@example.com"

gcloud projects get-iam-policy mkw-stats \
  --flatten="bindings[].members" \
  --filter="bindings.members=user:reader@example.com AND (bindings.role=roles/cloudsql.client OR bindings.role=roles/cloudsql.instanceUser)" \
  --format="table(bindings.role,bindings.members)"
```

## Revocation

First confirm whether the two IAM bindings were created solely for this database
access. If either role supports another approved responsibility, retain that
binding and document why.

Delete the Cloud SQL IAM database user to remove its PostgreSQL role membership:

```bash
gcloud sql users delete reader@example.com \
  --instance=mkw-stats-prod-pg18 \
  --project=mkw-stats
```

Remove the IAM bindings that were added during onboarding:

```bash
gcloud projects remove-iam-policy-binding mkw-stats \
  --member="user:reader@example.com" \
  --role="roles/cloudsql.client"

gcloud projects remove-iam-policy-binding mkw-stats \
  --member="user:reader@example.com" \
  --role="roles/cloudsql.instanceUser"
```

Repeat the identity and IAM listing commands from the verification section; they
should return no matching entries. Record the removal date and operator. IAM
revocation prevents new authenticated connections after propagation, but it does
not guarantee that an already-open database session ends immediately. For urgent
revocation, a database administrator must also terminate that user's active
PostgreSQL sessions.

## Group-Based Access

For several recurring readers, prefer a managed Google Group rather than
maintaining individual grants. Grant the two IAM roles to
`group:ctc-db-readers@example.com`, create a `CLOUD_IAM_GROUP` Cloud SQL user for
that lowercase group email, and assign it `ctc_readonly`. Thereafter, adding or
removing group members manages access while Cloud SQL continues to audit members
as individual identities.

Do not add someone to both an individual Cloud SQL IAM user and an IAM group user
on the same instance. An existing individual IAM database user must be removed
before migrating that person to group authentication. Group creation and
membership should follow the organization's normal approval and ownership
process.

## Review Checklist

- Review the reader roster at least quarterly and remove stale access.
- Keep all reader identities on `ctc_readonly`; grant exceptions only through a
  separately reviewed, time-limited process.
- Reassess project-level IAM bindings whenever another Cloud SQL instance is
  created.
- Never place user credentials, IAM tokens, database passwords, or service
  account keys in this repository.

## Google Cloud References

- [Log in using IAM database authentication](https://docs.cloud.google.com/sql/docs/postgres/iam-logins)
- [Manage users with IAM database authentication](https://docs.cloud.google.com/sql/docs/postgres/add-manage-iam-users)
- [Connect using the Cloud SQL Auth Proxy](https://docs.cloud.google.com/sql/docs/postgres/connect-auth-proxy)
- [Cloud SQL IAM authentication concepts](https://docs.cloud.google.com/sql/docs/postgres/iam-authentication)
