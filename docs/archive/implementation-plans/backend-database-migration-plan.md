# Backend Database Migration Plan

This document describes how to migrate the Flask backend from CSV-backed analytics to the new SQLAlchemy/SQLite analytics database.

The goal of this phase is backend compatibility only. Frontend changes should come after these API changes are agreed on.

Key decisions:

- The first DB-backed API should preserve the current frontend-facing response shapes where possible.
- Internally, database analytics functions should return structured Python data first, then a thin formatter can convert that data into the current strings.
- Missing `season` should default to the most recent season in the database.
- Historical pages and filters should pass `season` explicitly.
- Ambiguous player aliases within the same season/division should return an error that displays every matched candidate player.
- Future upload/import endpoints should live in the Flask app as protected admin-only functionality.

## Current Backend Shape

The runtime backend currently reads `backend/CSV/ctc_d{division}.csv` files with pandas. Each CSV row is already flattened into:

- `team`
- `player`
- `track`
- `score`

That means the existing analytics code has no direct concept of season, match, race, player identity, aliases, friend codes, source files, penalties, or whether a low score was an actual bagging role versus just a low finish.

The new database already stores these concepts in normalized tables:

- seasons and divisions
- teams and team season entries
- players, player aliases, and player season entries
- matches, match teams, and match players
- tracks, races, race player results, and penalties
- source files for import/audit history

## Files That Need Backend Attention

### `backend/app.py`

This is the live Flask API entrypoint.

Current CSV dependencies:

- imports `pandas`
- defines `csv_directory`
- `/api/players` reads CSV directly
- `/api/teams` reads CSV directly
- `/api/tracks` reads CSV directly
- all analytics endpoints call `stats.py`, which reads CSV internally

Needed changes:

- add database/session access through `database.py`
- remove direct pandas CSV reads from runtime endpoints
- add request parsing for `season` and normalized `division`
- keep current response shapes where possible so the frontend does not break immediately
- update cache keys and cache invalidation assumptions so `season` is part of cached responses
- replace `stats.py` calls with database-backed analytics calls

### `backend/stats.py`

This module contains the current analytics logic.

Current CSV dependencies:

- imports `pandas`
- reads `backend/CSV/ctc_d{division}.csv`
- validates names through `find.py`
- treats `player + " (bag)"` as a display-name convention
- calculates team track averages using `len(scorelist) / 5`, which assumes five players per team per race

Needed changes:

- either rewrite this module to query SQLAlchemy tables, or create a new `stats_db.py` and have `app.py` call that instead
- add `season` to every analytics function
- normalize division inputs from the current API format into database codes
- replace CSV validation with database lookups
- use `race_player_results.role` for bag/run data instead of display-name suffixes
- calculate team race averages with actual race counts, not a fixed five-player assumption
- keep score filtering equivalent to current behavior: only include normal race scores, generally `score <= 15`

Recommended path: create a new `backend/stats_db.py` first, then remove or archive the CSV-backed `stats.py` after the API has been verified. This gives us a clean rollback path during the migration.

### `backend/find.py`

This is a CSV helper module used by `stats.py`.

Current CSV dependencies:

- imports `pandas`
- reads CSVs from `backend/CSV`
- returns lowercased unique values for tracks, players, and teams

Needed changes:

- retire this module from runtime use, or replace it with database-backed lookup helpers
- do not keep pandas in the request path after the migration

Recommended path: leave the file in place during the first migration, but stop importing it from runtime API code.

### `backend/main.py`

This appears to be a manual/dev scratch entrypoint.

Current behavior:

- imports `extract`, `stats`, and `find`
- defines CSV/JSON paths
- calls `stats.findplayeravg("zilla")`

Needed changes:

- either remove this file from active use, or update it to a small database smoke-test script
- make sure deployment does not use this as the app entrypoint

### `backend/extract.py`

This is the legacy JSON-to-CSV generator.

Current behavior:

- parses old JSON files
- emits flattened CSV rows
- marks low scores as `player (bag)` when `score <= 1`

Needed changes:

- keep only as historical reference, or archive it
- do not use it in the new data path
- future imports should use `convert_txt_json.py` and `import_json_to_db.py`

### `backend/database.py`

This is already the correct database access foundation.

Relevant behavior:

- default database path is `backend/data/ctc_stats.sqlite`
- creates SQLAlchemy engines and sessions
- enables SQLite foreign keys, WAL mode, and busy timeout

Needed changes:

- likely none for the first API migration
- optionally add a helper for app-level session handling if repeated boilerplate appears in `app.py`

### `backend/models.py`

This already defines the database schema.

Needed changes:

- likely none for the first API migration
- optional relationships can be added later if they make analytics queries easier, but they are not required

### `backend/import_json_to_db.py`

This is the offline importer and should remain separate from the request path.

Needed changes:

- no immediate runtime API changes
- later, upload/admin endpoints can call importer functions or a smaller service wrapper around them
- after upload support exists, successful imports should clear Flask cache

## Request Parameter Compatibility

The current frontend sends only `division`, for example:

- `division=1_2`
- `division=3`
- `division=4`

The database stores division codes as:

- `d1_2`
- `d1`
- `d2`
- `d3`
- `d4`
- `d5`

The backend should accept both formats.

Recommended normalizers:

- `season=1` becomes `s1`
- `season=s1` stays `s1`
- missing `season` defaults to the most recent season in the database
- `division=1_2` becomes `d1_2`
- `division=3` becomes `d3`
- `division=d3` stays `d3`

This preserves the existing frontend while allowing Season 2 and Season 3 requests. Because the default season will move as new seasons are added, frontend pages should eventually pass `season` explicitly when showing historical views.

Recommended frontend-facing behavior:

- The main/default analytics view should show the most recent season.
- Historical season pages or filters should pass an explicit `season` value.
- URLs should eventually preserve the selected season so users can link directly to Season 1, Season 2, or Season 3 analytics.

## Endpoint Migration Map

### `/api/players`

Current behavior:

- reads CSV
- returns sorted unique player display names for a division

Database behavior:

- query players with entries in the requested season/division
- return sorted names using canonical lounge names or the best available display name
- include aliases later only if the frontend needs search/autocomplete expansion

Initial response shape should remain:

```json
["Player A", "Player B"]
```

### `/api/teams`

Current behavior:

- reads CSV
- returns sorted unique team tags

Database behavior:

- query `team_season_entries` for requested season/division
- return canonical `clan_tag` values

Initial response shape should remain:

```json
["TMNG", "Mι"]
```

### `/api/tracks`

Current behavior:

- reads CSV
- returns sorted unique track names

Database behavior:

- join races to matches and tracks for requested season/division
- return tracks that were actually played in that scope

Initial response shape should remain:

```json
["Luigi Circuit", "Mushroom Gorge"]
```

### `/api/player-avg`

Current behavior:

- accepts `name`, `division`
- returns player average, player name, team name, and race count
- optional track/team filtering exists in `stats.py`, though the route currently only exposes player/division

Database behavior:

- resolve player by current lounge name or alias within requested season/division
- compute average as a 12-race average: `AVG(score) * 12`
- count included race results
- return the team from `player_season_entries`

Potential ambiguity:

- if the same display name or alias maps to multiple players in the same season/division, the API should return an error instead of guessing
- the error response should include all candidate players it matched so the bad alias mapping can be fixed

Initial response shape should remain:

```json
{
  "avg": 98.4,
  "player_name": "Player",
  "team_name": "TMNG",
  "races": 72
}
```

### `/api/player`

Current behavior:

- accepts `name`, `division`
- returns the player's best tracks as formatted strings
- defaults to `min_races=2`

Database behavior:

- resolve player within season/division
- group that player's race results by track
- filter groups by `min_races`
- sort by average score descending
- preserve the formatted string output initially

Recommended later improvement:

- add a structured endpoint that returns `track`, `average`, and `races` as JSON fields instead of formatted strings

### `/api/top-team-players`

Current behavior:

- accepts `team`, `min_races`, `division`
- returns formatted player averages for a team

Database behavior:

- resolve team entry in season/division
- find players linked through match participation and/or player season entries
- group race results by player
- compute `AVG(score) * 12`
- filter by `min_races`
- sort descending

### `/api/top-team-tracks`

Current behavior:

- accepts `team`, `min_races`, `division`
- returns formatted team averages by track

Database behavior:

- resolve team entry in season/division
- group that team's race results by track
- calculate team points per race as `SUM(score) / COUNT(DISTINCT race_id)`
- filter by race count
- sort descending

This should replace the old `len(scorelist) / 5` calculation.

### `/api/top-tracks`

Current behavior:

- accepts `track`, `min_races`, `division`
- returns the top players on a track

Database behavior:

- resolve track by name
- group race results on that track by player within season/division
- compute `AVG(score) * 12`
- filter by `min_races`
- sort descending

### `/api/top-teams-on-track`

Current behavior:

- accepts `track`, `min_races`, `division`
- returns top teams on a track

Database behavior:

- resolve track by name
- group race results on that track by team within season/division
- calculate team points per race as `SUM(score) / COUNT(DISTINCT race_id)`
- filter by race count
- sort descending

## Suggested New Backend Structure

Recommended minimal structure:

```text
backend/
  app.py
  database.py
  models.py
  stats_db.py
  query_helpers.py
```

`stats_db.py` should contain analytics functions equivalent to the old `stats.py` public functions.

`query_helpers.py` can hold small reusable helpers:

- normalize season code
- normalize division code
- resolve season/division IDs
- resolve player by alias/name
- resolve team by tag/name
- resolve track by name
- format average strings

This keeps `app.py` mostly focused on HTTP request handling.

## Caching Plan

The current Flask cache uses `SimpleCache`.

Needed changes:

- make sure cache keys include `season`, `division`, and other query args
- cache list endpoints like teams, players, and tracks
- cache analytics endpoints if query performance needs it
- clear cache after any future upload/import endpoint successfully changes the database

For now, because the database is local and small, correctness matters more than aggressive caching.

## Alias Integrity Behavior

Player aliases should be unique within a season/division lookup scope. If an alias maps to multiple players in the same season/division, that is a data problem, not a normal user-choice scenario.

The API should respond with an error that includes the ambiguous candidates:

```json
{
  "error": "Ambiguous player alias",
  "query": "PlayerName",
  "season": "s2",
  "division": "d1",
  "candidates": [
    {
      "player_id": 123,
      "name": "PlayerName",
      "team": "TMNG",
      "friend_code": "0000-0000-0000"
    },
    {
      "player_id": 456,
      "name": "PlayerName",
      "team": "Mι",
      "friend_code": "1111-1111-1111"
    }
  ]
}
```

This makes the issue visible without silently assigning stats to the wrong player.

## Deployment And Runtime Plan

The SQLite file lives at:

```text
backend/data/ctc_stats.sqlite
```

That file is intentionally ignored by git. The backend therefore needs one of these deployment strategies:

1. Commit JSON source files and rebuild the SQLite DB during deployment.
2. Store the SQLite DB in persistent storage on the host.
3. Store the SQLite DB as a release artifact and restore it before app start.

Recommended for the next phase:

- local development: rebuild with `python backend/import_json_to_db.py --rebuild`
- hosted deployment: rebuild from committed JSON files during build or release
- future upload workflow: move to persistent storage, then back up the DB plus raw JSON files

The Flask app should not rebuild the full database on every startup unless we explicitly choose that behavior for a temporary deployment.

## Future Admin Upload And Import Flow

Future JSON upload/import endpoints should live in the Flask app because the intended workflow is website-driven: an authorized user uploads a JSON file, the backend validates it, stores the raw file, ingests it into SQLite, and the analytics update from there.

The importer logic should still remain separate from the route functions. The Flask endpoint should orchestrate the upload, validation, permission checks, and response, while a reusable import service handles database writes. That keeps the same import code usable from both the website and command-line maintenance scripts.

Recommended future flow:

1. Admin user signs in.
2. Frontend upload form collects the JSON file plus metadata such as league, season, division, week, and match notes if needed.
3. Flask verifies the user has an admin permission.
4. Flask validates that the uploaded file is valid JSON and matches the expected MKW Table Bot structure.
5. Flask stores the raw JSON in the organized source directory or a future object-storage equivalent.
6. Flask calls the import service to insert or update database records.
7. Flask clears analytics cache after a successful import.
8. Flask returns an import summary with inserted/updated match, race, player, team, penalty, and warning counts.

The endpoint should reject uploads from users without admin permission. It should also reject ambiguous or malformed data rather than silently importing questionable records.

Recommended first admin endpoints:

- `POST /api/admin/import/json`
- `GET /api/admin/import/history`
- `GET /api/admin/import/source-files`

Authentication and authorization can be designed later, but the backend should assume upload/import is a protected admin action.

## Verification Plan

After migration, compare CSV-backed Season 1 outputs against database-backed Season 1 outputs for the same requests.

Smoke-test endpoints:

- `/api/teams?season=s1&division=1_2`
- `/api/players?season=s1&division=1_2`
- `/api/tracks?season=s1&division=1_2`
- `/api/player-avg?season=s1&division=1_2&name=zilla`
- `/api/top-team-players?season=s1&division=1_2&team=TMNG`
- `/api/top-team-tracks?season=s1&division=1_2&team=TMNG`
- `/api/top-tracks?season=s1&division=1_2&track=Luigi Circuit`
- `/api/top-teams-on-track?season=s1&division=1_2&track=Luigi Circuit`

Also test Season 2 examples:

- `/api/teams?season=s2&division=d1`
- `/api/teams?season=s2&division=d5`
- `/api/players?season=s2&division=d2`

Expected checks:

- no endpoint reads `backend/CSV`
- no endpoint imports pandas for request-time analytics
- old Season 1 division values still work
- Season 2 divisions work
- missing `season` returns the latest season
- explicit historical `season` values still return that season
- response shapes remain compatible with the current frontend
- invalid season/division/player/team/track inputs produce clear JSON errors

## Future Structured JSON API

After the backend has been migrated safely and the frontend is ready for a larger update, the API should stop returning preformatted analytics strings and return structured JSON objects instead.

The current string format is useful for compatibility, but it mixes data with presentation. For example, a response like this:

```json
"Luigi Circuit - 102.4 pts (5 races)"
```

should eventually become:

```json
{
  "track": "Luigi Circuit",
  "average": 102.4,
  "races": 5
}
```

Recommended migration strategy:

1. Keep existing endpoints stable during the first database migration.
2. Update the existing endpoints to return structured JSON once the frontend is ready.
3. Update the frontend to consume the structured responses.
4. Remove the formatted string response layer after the frontend no longer needs it.
5. Keep all numeric values as numbers, not strings, so the frontend can sort, filter, chart, and format them freely.

## Recommended Implementation Order

1. Add normalization and database lookup helpers.
2. Build `stats_db.py` with database-backed equivalents of the current stats functions.
3. Update `app.py` routes to call database functions.
4. Replace direct CSV list endpoints with database queries.
5. Run local endpoint smoke tests for Season 1 and Season 2.
6. Compare a few Season 1 responses against the old CSV behavior.
7. Remove runtime imports of `pandas`, `find`, and CSV paths from `app.py`.
8. Decide whether to archive or keep legacy CSV modules for reference.

## Open Decisions Before Coding

There are no remaining open backend migration decisions at this time.
