# Frontend

## Technology

The frontend is a React app built with Vite and TypeScript.

Main dependencies:

- `react`
- `react-dom`
- `react-router-dom`
- `axios`
- `vite`
- `tailwindcss`

## Build And Dev Commands

From repo root:

```sh
npm run dev
npm run build
```

These delegate into `frontend`.

From `frontend/`:

```sh
npm run dev
npm run build
npm run preview
```

Vite dev server is configured for port `3000`.

## Routes

Routes are declared in `frontend/src/App.tsx`:

- `/`: home page
- `/stats`: player statistics
- `/top-team-players`: team/player and team/track rankings
- `/top-tracks`: top players and teams for a selected track
- `/best-matchups`: compares two teams by overlapping track averages

`BackgroundSlideshow` and `MusicPlayer` render globally on every route.

## API Base URL

Several components define:

```ts
const API_URL = import.meta.env.VITE_API_URL || 'https://ctcmkwiistatswebsite.onrender.com';
```

If `VITE_API_URL` is not supplied at build/dev time, the frontend uses the existing Render API URL.

During Vite local development, `frontend/vite.config.ts` also proxies `/api` to `http://127.0.0.1:5000`, but the current component code uses absolute `API_URL` strings. To benefit from the proxy, `VITE_API_URL` would need to be set to an empty same-origin base or the code would need to use relative `/api/...` URLs.

## Pages And Components

### `HomePage`

Displays:

- CTC logo from `/images/CTC_LOGO/ctclogo.webp`
- Season 1 title and creator credit
- Navigation buttons
- A Twitch embed for `customtrackcupmkwii`

The Twitch embed uses:

```ts
parent=${window.location.hostname}
```

No Twitch API key is used.

### `PlayerStats`

Fetches:

- `/api/players?division=...`
- `/api/player?name=...&division=...`
- `/api/player-avg?name=...&division=...`

Shows player overall average and best tracks.

### `TopTeamPlayers`

Fetches:

- `/api/teams?division=...`
- `/api/top-team-players?team=...&min_races=...&division=...`
- `/api/top-team-tracks?team=...&division=...`

Shows a selected team's top players and tracks.

### `TopTracks`

Fetches:

- `/api/tracks?division=...`
- `/api/top-tracks?track=...&min_races=...&division=...`
- `/api/top-teams-on-track?track=...&min_races=...&division=...`

Shows top players and teams for a selected track.

### `BestMatchups`

Fetches team lists and each team's top tracks. It parses strings like:

```text
Track - 62.5 pts (4 races)
```

Then compares overlapping tracks between Team 1 and Team 2.

This would be cleaner if the backend returned structured JSON objects.

## Static Assets

Important public assets:

- `frontend/public/images/CTC_LOGO/ctclogo.webp`
- `frontend/public/images/CT_BGS_WEBP/bg_(1).webp` through `bg_(343).webp`
- `frontend/public/music/track (1).mp3` through `track (17).mp3`

`BackgroundSlideshow` assumes exactly 343 background images exist.

`MusicPlayer` assumes exactly 17 MP3 files with the current names exist.

## Build Output

`frontend/vite.config.ts` sets:

```ts
build: {
  outDir: 'build'
}
```

This is why Docker and GitHub Pages both reference `frontend/build`.

## Known Frontend Issues And Risks

- `API_URL` is duplicated in multiple components.
- The app is labeled Season 1 throughout the UI.
- Division options are hardcoded as `1_2`, `3`, and `4`.
- No season selector exists.
- Some display text contains mojibake, for example corrupted arrows and en dashes.
- `BestMatchups` depends on parsing backend formatted strings.
- No upload/admin workflow exists.

