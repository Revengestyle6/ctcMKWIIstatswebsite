# Frontend Update Plan For Database Backend

This document lays out the frontend changes needed now that the Flask backend reads from the SQLAlchemy/SQLite analytics database instead of CSV files.

The backend still preserves the existing formatted analytics response strings, so this frontend update should focus on season/division compatibility first. A later pass can replace formatted strings with structured JSON once the backend response format is intentionally changed.

## Backend Changes The Frontend Can Use

Existing endpoints still work:

- `GET /api/players`
- `GET /api/player`
- `GET /api/player-avg`
- `GET /api/teams`
- `GET /api/top-team-players`
- `GET /api/top-team-tracks`
- `GET /api/tracks`
- `GET /api/top-tracks`
- `GET /api/top-teams-on-track`

These endpoints now accept:

- `season`, such as `s1` or `s2`
- `division`, such as `d1`, `d2`, `d3`, `d4`, `d5`, or historical `d1_2`

The backend also added metadata endpoints:

- `GET /api/seasons`
- `GET /api/divisions?season=s2`

## Current Frontend Issues

The current frontend is still Season 1-shaped:

- several components hardcode `["1_2", "3", "4"]`
- API calls send `division` but not `season`
- pages assume the same division list is valid for every season
- selected player/team/track state is not reset consistently when division changes
- some UI text contains mojibake characters like `â†`, `â€“`, and `â€”`
- `App.tsx` defines `API_URL` but does not use it

## Recommended UX Direction

Use a shared season/division selector across analytics pages.

The first frontend implementation should keep routes mostly unchanged:

- `/stats`
- `/top-team-players`
- `/top-tracks`
- `/best-matchups`

Each page should show:

- season selector
- division selector based on the selected season
- page-specific player/team/track controls

Later, we can add season-aware URLs if desired, but the first pass should prioritize correctness and low-risk integration.

## New Shared Types

Create shared frontend types for backend metadata responses:

```ts
export interface SeasonOption {
  season: string;
  season_number: number | null;
  name: string;
  status: string;
}

export interface DivisionOption {
  division: string;
  name: string;
}
```

## New Shared API Helper

Add a small API helper module, for example:

```text
frontend/src/api.ts
```

Recommended responsibilities:

- define `API_URL` once
- fetch seasons
- fetch divisions for a season
- centralize URL query building
- parse backend error messages consistently

Example helper functions:

```ts
fetchSeasons(): Promise<SeasonOption[]>
fetchDivisions(season: string): Promise<DivisionOption[]>
fetchPlayers(season: string, division: string): Promise<string[]>
fetchTeams(season: string, division: string): Promise<string[]>
fetchTracks(season: string, division: string): Promise<string[]>
```

## Shared Selector Component

Create a reusable component:

```text
frontend/src/components/SeasonDivisionSelector.tsx
```

Responsibilities:

- load seasons from `/api/seasons`
- default to the first season returned by the backend, which should be the newest season
- load divisions whenever season changes
- default to the first division for the selected season
- call the parent with `{ season, division }`
- handle loading and error states

Suggested props:

```ts
interface SeasonDivisionSelectorProps {
  season: string;
  division: string;
  seasons: SeasonOption[];
  divisions: DivisionOption[];
  disabled?: boolean;
  onSeasonChange: (season: string) => void;
  onDivisionChange: (division: string) => void;
}
```

The data loading can either live in this component or in a custom hook. A hook is cleaner if several pages need the same state.

## Optional Shared Hook

Consider adding:

```text
frontend/src/hooks/useSeasonDivision.ts
```

Responsibilities:

- load season list
- load divisions for selected season
- expose `season`, `division`, `seasons`, `divisions`
- expose setters
- expose loading/error state

This prevents duplicating the same `useEffect` logic in every analytics page.

## Component Updates

### `PlayerStats.tsx`

Current behavior:

- hardcodes default division `1_2`
- fetches `/api/players?division=${division}`
- fetches player stats with `name` and `division`

Needed changes:

- add selected `season`
- use shared season/division state
- fetch players with `season` and `division`
- reset selected player, results, and player average when season/division changes
- pass `season` to `/api/player`
- pass `season` to `/api/player-avg`

Updated request examples:

```text
/api/players?season=s2&division=d1
/api/player?season=s2&division=d1&name=Player
/api/player-avg?season=s2&division=d1&name=Player
```

### `TopTeamPlayers.tsx`

Current behavior:

- hardcodes `const divisions = ["1_2", "3", "4"]`
- fetches teams by division only
- fetches team rankings by division only

Needed changes:

- remove hardcoded divisions
- add selected `season`
- fetch teams with `season` and `division`
- reset selected team, top players, and top tracks when season/division changes
- pass `season` to `/api/top-team-players`
- pass `season` to `/api/top-team-tracks`

Updated request examples:

```text
/api/teams?season=s2&division=d2
/api/top-team-players?season=s2&division=d2&team=sts&min_races=12
/api/top-team-tracks?season=s2&division=d2&team=sts
```

### `TopTracks.tsx`

Current behavior:

- hardcodes `const divisions = ["1_2", "3", "4"]`
- fetches tracks by division only
- fetches player/team track rankings by division only

Needed changes:

- remove hardcoded divisions
- add selected `season`
- fetch tracks with `season` and `division`
- reset selected track, top players, and top teams when season/division changes
- pass `season` to `/api/top-tracks`
- pass `season` to `/api/top-teams-on-track`

Updated request examples:

```text
/api/tracks?season=s2&division=d2
/api/top-tracks?season=s2&division=d2&track=Color%20Wonderland&min_races=2
/api/top-teams-on-track?season=s2&division=d2&track=Color%20Wonderland&min_races=2
```

### `BestMatchups.tsx`

Current behavior:

- hardcodes `const divisions = ["1_2", "3", "4"]`
- fetches teams by division only
- fetches both teams' top tracks by division only
- parses formatted strings from `/api/top-team-tracks`

Needed changes:

- remove hardcoded divisions
- add selected `season`
- fetch teams with `season` and `division`
- reset selected teams and track comparison rows when season/division changes
- pass `season` to `/api/top-team-tracks`
- keep the string parser for now because backend compatibility responses are still formatted strings

Updated request examples:

```text
/api/teams?season=s2&division=d2
/api/top-team-tracks?season=s2&division=d2&team=sts
```

## State Reset Rules

When `season` changes:

- clear selected division until new divisions load
- clear selected player/team/track
- clear analytics results
- clear stale error messages

When `division` changes:

- clear selected player/team/track
- clear analytics results
- reload the relevant list for that page

When a selected player/team/track no longer exists in the new scope:

- select the first available option if the list is non-empty
- otherwise show an empty-state message

## Error Handling

The backend may now return structured ambiguous alias errors:

```json
{
  "error": "Ambiguous player alias",
  "query": "PlayerName",
  "season": "s2",
  "division": "d1",
  "candidates": []
}
```

Initial frontend behavior can show the `error` string. A later admin/data-cleaning UI can render candidates in a table.

For normal failures, show concise page-level messages:

- `Failed to load seasons.`
- `Failed to load divisions.`
- `Failed to load players.`
- `Failed to load teams.`
- `Failed to load tracks.`
- `Failed to fetch analytics for this selection.`

## Text Encoding Cleanup

Several frontend files show mojibake text:

- `â† Back`
- `Division 1â€“2`
- `â€”`

These should be replaced with proper ASCII-safe text for now:

- `< Back`
- `Division 1-2`
- `-`

This avoids accidental encoding problems while editing on Windows.

## Styling Notes

Keep the first update visually consistent with the current site.

Recommended minor improvements:

- place season and division controls together
- disable page-specific selectors while season/division data is loading
- keep dropdown widths stable so layout does not shift
- avoid adding a new landing page or large redesign during this compatibility update

## Verification Plan

Run the frontend against the migrated backend and verify:

- `/stats` loads latest season/division by default
- `/stats` can switch to Season 1 Division 1-2
- `/stats` can switch to Season 2 divisions
- `/top-team-players` loads teams and rankings for Season 2
- `/top-tracks` loads tracks and rankings for Season 2
- `/best-matchups` compares two teams within the selected season/division
- all API requests include both `season` and `division`
- no component still hardcodes `["1_2", "3", "4"]`
- existing formatted analytics tables still render correctly

Recommended search after implementation:

```text
rg -n "division=|const divisions|1_2|api/" frontend/src
```

## Future Follow-Up

After this compatibility update is working, the next frontend/backend pair of changes should replace formatted analytics strings with structured JSON responses from the existing endpoint paths.

