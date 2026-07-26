# Local Development Startup

This runbook starts the complete local application with PostgreSQL, Flask, Vite,
and real Firebase Google sign-in.

## Why Each Service Is Required

| Service or tool | Purpose |
| --- | --- |
| Docker Desktop and Compose | Run the local PostgreSQL database without installing PostgreSQL directly on the host |
| PostgreSQL | Store the application, match, identity, roster, and administrator data used by Flask |
| Flask | Serve `/api/**`, verify Firebase ID tokens, enforce administrator access, and read or write PostgreSQL |
| Vite | Serve the React development site with fast refresh and proxy local `/api/**` requests to Flask |
| Firebase Authentication | Let an administrator prove ownership of an allowlisted Google account |

Firebase Authentication has two separate configurations:

- The React build needs the four public `VITE_FIREBASE_*` web identifiers so it
  can open Google sign-in.
- Flask needs `FIREBASE_PROJECT_ID=mkw-stats` so it can verify that the resulting
  ID token was issued for this Firebase project.

Configuring only one side is insufficient.

## One-Time Setup

### 1. Install dependencies

From the repository root:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements-dev.txt
npm ci
npm ci --prefix frontend
```

The root npm dependencies provide the Firebase CLI. The frontend dependencies
provide React, Vite, and the Firebase browser SDK.

### 2. Create the local Firebase web configuration

Authenticate the Firebase CLI if necessary:

```bash
node_modules/.bin/firebase login
```

Retrieve the registered web configuration:

```bash
NO_UPDATE_NOTIFIER=1 node_modules/.bin/firebase apps:sdkconfig web \
  1:1054134490602:web:6e5f37e3beccd7d4b28e93 \
  --project=mkw-stats \
  --json
```

Create `frontend/.env.development.local` and copy these four values from
`result.sdkConfig`:

```text
VITE_FIREBASE_API_KEY=<apiKey>
VITE_FIREBASE_AUTH_DOMAIN=<authDomain>
VITE_FIREBASE_PROJECT_ID=<projectId>
VITE_FIREBASE_APP_ID=<appId>
```

These are public Firebase web identifiers, not administrator credentials or
server secrets. The file is nevertheless ignored so local environment
configuration does not create noisy repository changes.

Vite reads environment variables only when it starts. Stop and restart Vite
after creating or changing this file.

### 3. Confirm Firebase and application authorization

Firebase Authentication must have the Google provider enabled and `localhost`
listed as an authorized domain. Separately, the Google email used for testing
must exist as an active administrator in this application's `admin_users`
database table. Firebase proves who the user is; the database allowlist decides
what that user may do.

## Start the Application

Run each long-lived application process in its own terminal.

### Terminal 1: PostgreSQL

Start Docker Desktop first, then run from the repository root:

```bash
docker compose up -d postgres
docker compose ps postgres
```

The database should report healthy on host port `55432`.

Apply new migrations when first setting up the database or after pulling schema
changes:

```bash
export APP_ENV=local
export DATABASE_URL=postgresql+psycopg://ctc_local:ctc_local@127.0.0.1:55432/ctc_dev
.venv/bin/alembic upgrade head
```

Historical data import is a setup/rebuild operation, not a normal startup step:

```bash
.venv/bin/python backend/import_json_to_db.py --database-url "$DATABASE_URL"
```

### Terminal 2: Flask API

From `backend/`:

```bash
export APP_ENV=local
export DATABASE_URL=postgresql+psycopg://ctc_local:ctc_local@127.0.0.1:55432/ctc_dev
export FIREBASE_PROJECT_ID=mkw-stats
../.venv/bin/python -m flask --app app run --host 0.0.0.0 --port 5000 --no-reload
```

`FIREBASE_PROJECT_ID` is required for real Google sign-in. If it is absent,
authenticated API requests fail with `Firebase authentication is not
configured.`

### Terminal 3: React and Vite

From `frontend/`:

```bash
npm run dev -- --host 0.0.0.0 --port 3000
```

Open `http://localhost:3000`. Do not set `VITE_API_URL` for this normal local
setup; the checked-in Vite proxy sends `/api/**` to
`http://127.0.0.1:5000`.

## Verify Authentication

1. Open `http://localhost:3000/admin/access`.
2. Click **Sign in with Google**.
3. Use an active administrator email from the local database.
4. Confirm the page shows the signed-in email and application role.
5. Open `http://localhost:3000/admin/aliases` and confirm its API data loads.

Error meanings:

| Message | Cause |
| --- | --- |
| `Firebase sign-in is not configured for this build.` | Vite did not load all required `VITE_FIREBASE_*` values; create the local file and restart Vite |
| `Firebase authentication is not configured.` | Flask was started without `FIREBASE_PROJECT_ID` |
| `This Google account is not an authorized administrator` | Google sign-in worked, but the email is absent, disabled, or unapproved in `admin_users` |
| Firebase `auth/unauthorized-domain` | The hostname is not listed in Firebase Authentication authorized domains |

## Stop and Restart

Stop Vite and Flask with `Ctrl+C` in their terminals. Preserve the local database
while stopping its container:

```bash
docker compose stop postgres
```

Use `docker compose down` only when the entire Compose stack should be removed.
The named database volume remains unless it is explicitly deleted.
