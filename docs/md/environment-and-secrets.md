# Environment And Secrets

This repo does not appear to depend on any private API key for normal operation.

## Observed Environment Variables

### `VITE_API_URL`

Used in:

- `frontend/src/App.tsx`
- `frontend/src/components/PlayerStats.tsx`
- `frontend/src/components/TopTeamPlayers.tsx`
- `frontend/src/components/TopTracks.tsx`
- `frontend/src/components/BestMatchups.tsx`

Purpose: tells the frontend where the Flask API lives.

Fallback:

```text
https://ctcmkwiistatswebsite.onrender.com
```

For a new deployment, this should point to your new API base URL.

Example:

```text
VITE_API_URL=https://your-api.example.com
```

Because Vite embeds `VITE_` variables at build time, changing this for a static frontend requires rebuilding the frontend.

### `PORT`

Used in:

- `start.sh`

Purpose: hosting platforms often inject `PORT`; Gunicorn binds to it.

Fallback:

```text
5000
```

### `PYTHON_VERSION`

Used in:

- `render.yaml`

Purpose: tells Render to use Python 3.11.

Value:

```text
3.11
```

### `GITHUB_TOKEN`

Used in:

- `.github/workflows/deploy.yml`

Purpose: authorizes the GitHub Pages deploy action.

This is automatically provided by GitHub Actions as `${{ secrets.GITHUB_TOKEN }}`. You do not need the original creator's personal token.

## External Service URLs

### Render API fallback

Hardcoded frontend fallback:

```text
https://ctcmkwiistatswebsite.onrender.com
```

This is probably the original API deployment. If you deploy your own backend, set `VITE_API_URL` so the frontend stops depending on this.

### Twitch embed

Used in `HomePage`:

```text
https://player.twitch.tv/?channel=customtrackcupmkwii&parent=${window.location.hostname}
```

No Twitch API key is used. Twitch requires the `parent` query param to match the embedding hostname.

## Not Found

No references were found for:

- database URLs
- private API keys
- OAuth client secrets
- password variables
- custom creator-owned deployment tokens

## Recommended `.env` Files

For local frontend development:

```text
VITE_API_URL=http://127.0.0.1:5000
```

For production frontend builds:

```text
VITE_API_URL=https://your-production-api-host
```

For backend local development, no `.env` file is currently required.

