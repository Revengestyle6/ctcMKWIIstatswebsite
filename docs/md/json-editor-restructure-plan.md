# Match JSON Editor Restructure Plan

## Goal

Restructure the match JSON editor around the way match data is actually entered:

1. Enter match metadata.
2. Define the teams and the players who may appear.
3. Enter each race by placing those players in finishing order and assigning a role.
4. Generate all deterministic scores, totals, GP groupings, and JSON output.
5. Validate player identity and match completeness before download or ingestion.

The editor should make placement, track, participation, and manually confirmed role the primary inputs. Derived fields should not require duplicate manual entry.

## Findings From The Existing JSONs And Database

- The current CTC JSON files generally use `format: "5v5"`, but the schema and editor should not assume every future match has ten racers or two teams.
- `race_positions[index]`, `race_scores[index]`, and `tracks[index]` describe the same race.
- Scores are deterministic from finishing position and the number of racers in that race. The room size can change during a match, so scoring must be calculated per race rather than once from the match format.
- Substitutions are represented by multiple players on one team. The outgoing and incoming players have `null` positions for races they did not play, although some historical files contain zeros or incomplete arrays that need review.
- A player can have more than one friend code. Friend code must resolve through `player_friend_codes` to one canonical `player_id`; display names alone are not sufficient identity evidence.
- The current `/api/players` endpoint returns display-name strings only. The editor needs a richer identity lookup endpoint before it can reliably confirm a player.
- Existing raw JSON does not contain an explicit race role. The importer currently infers `bagger` when a player scores exactly one point and otherwise infers `runner`. The editor can improve future data by recording a manual role.
- Existing JSONs contain team penalties and occasional historical player penalties. For team formats, new entries should expose team penalties only. Player penalties should remain readable when an old JSON is uploaded, but should be hidden or moved into a legacy-data warning unless the format is FFA.
- Derived fields currently stored in JSON include `race_scores`, `gp_scores`, `total_score`, `table_str`, `table_penalty_str`, and `had_penalties`. These should be generated from editor state at export time.
- Historical JSON includes irregular cases: shortened matches, substitutions, missing positions, malformed extra team objects, and occasional score/position disagreements. Uploaded files therefore need an import-review state rather than silent normalization.

## Proposed Editor Structure

### 1. Navigation And Document Controls

- Replace `Back home` with the site's existing `< Back` link styling and wording.
- Keep upload, new match, validation status, and download/export actions in a stable top toolbar.
- Add a clear dirty-state indicator after changes.
- Warn before replacing an edited document with an upload or blank match.

### 2. Additional Metadata

Keep metadata in its own top section. Fields should include:

- League
- Season
- Division
- Week
- Match label
- Format (`5v5`, `4v4`, FFA, and future supported formats)
- Planned race count
- Ordered Table Bot room references (`rxx`), added only for room resets or host changes
- Review notes

Season and division should use API-backed selectors when records exist, while still allowing a deliberate new value for a season not yet loaded into the database.

Changing race count after race data exists must require confirmation and explain which races would be removed.

### 3. Teams And Players

This section should contain descriptive and identity information only.

Team fields:

- Canonical/database team selection when available
- Raw/display tag, preserving exact capitalization and symbols
- Table color
- Team penalty points and penalty description

Player fields:

- Friend code
- Resolved canonical player and `player_id`
- Lounge name
- Table name
- Mii name
- Flag
- Team assignment

Player penalty fields should appear only for FFA. If a non-FFA upload contains historical player penalties, display a read-only legacy warning so data is not discarded accidentally.

Each player row should show one identity state:

- `Confirmed`: friend code maps to exactly one existing `player_id`.
- `New friend code`: no match; user may link it to an existing player or explicitly create a new player identity later.
- `Conflict`: friend code or selected identity disagrees with another configured player.
- `Incomplete`: friend code is missing or malformed.

The editor must not confirm identity from lounge, table, or Mii name alone. Names may be offered as ranked suggestions, but the user must select the person or mark the player as new.

### 4. Race Entry

Create one race panel per planned race. Support two views:

- `One race`: focused editor with Previous/Next controls, race tabs or a race number stepper, and keyboard navigation.
- `All races`: expanded panels for scanning and correction.

Each race panel contains:

- Track selector with search, canonical track suggestions, and an explicit add-new-track path.
- Optional Table Bot room reference when a reference needs to be associated with a specific GP or race range.
- A player tray grouped by team.
- Ordered finishing-position slots from first through the number of racers in that race.
- A room-size control, defaulted from format but adjustable per race.
- Completion and validation status.

Each position slot shows:

- Position number
- Automatically calculated points
- Assigned player's Mii name
- Lounge name in parentheses only when two configured players have the same normalized Mii name
- Team color/accent
- A two-state `Runner` / `Bagger` segmented control

Players can be assigned by:

- Dragging from the player tray or another position slot.
- Selecting from a single-select dropdown containing only configured players who are not already placed in that race.

Dropping one occupied slot onto another should swap players. Moving a player back to the tray removes them from that race. No free-form player entry should exist inside a race.

### Substitutions And Missing Racers

The roster and the active room lineup are separate concepts. A team may configure more players than its normal format size because of substitutions.

- Each race begins with the previous race's active lineup and placements cleared.
- The first race defaults to the expected lineup size from the format.
- A player omitted from a race receives `null` position and score in generated arrays.
- A player who appears early and is absent later is generated with `subbed_out: true` when another teammate replaces them. The UI should allow an override for unusual cases.
- The editor should validate actual race participants separately from team-level missing-player awards.
- A team that starts or continues short uses the smaller actual room size. Team-level missing-player awards and known-player disconnection awards do not occupy placement slots.
- Team-level missing-player results can be applied to every race for a short-roster war or from the current race onward after an unreplaced disconnect.

## Scoring Engine

Create one shared, tested scoring function:

```ts
scoreForPosition(position: number, roomSize: number): number
```

Do not infer room size from the largest entered position alone. Use the race's explicit room size and require every slot from `1` through `roomSize` to be filled before the race is complete.

The initial scoring tables should be extracted from authoritative Table Bot/MKW rules and verified against the repository's existing JSON position/score pairs for each observed room size. Historical anomalies must be reported, not added as scoring rules. Tests should cover every position for every supported room size.

Changing room size after placements exist should preserve valid leading slots, return removed players to the tray, and require confirmation.

## Roles

The role control should not be free-form. Use exactly:

- `Runner`
- `Bagger`

For newly entered races, require a manual choice or provide an explicit default that remains visibly unconfirmed. A one-point score can be shown as a bagger suggestion, but should not silently decide the role because placement and role are different facts.

The current raw JSON shape has no standard role field, while the normalized database supports `role` and `role_source`. The implementation should settle the export contract before coding:

- Preferred: add a per-player `race_roles` array to JSON and update the importer to save those values with `role_source = "manual"`.
- Compatibility: if `race_roles` is absent in an uploaded historical file, show inferred suggestions and export them only after confirmation.

## Canonical Editor State And JSON Generation

Use a race-oriented internal state rather than editing the output JSON arrays directly:

```ts
type RaceDraft = {
  trackName: string;
  roomSize: number;
  placements: Array<{
    playerKey: string;
    role: "runner" | "bagger" | null;
  }>;
};
```

Teams and players remain normalized in editor state. On preview/download, compile the draft into the existing JSON shape:

- Build `tracks` from race panels.
- Build each player's `race_positions`, using `null` when absent.
- Build `race_scores` from position and room size.
- Build `race_roles` from manual race choices.
- Group `race_scores` into four-race `gp_scores`.
- Sum player `total_score` and team `total_score`.
- Generate `subbed_out`, `had_penalties`, `table_str`, `table_penalty_str`, and `title_str` consistently.
- Preserve unknown uploaded fields in a separate passthrough object so supported edits do not erase source data.

This makes the editor's source of truth unambiguous and prevents scores, positions, GP totals, and final totals from disagreeing.

## Backend/API Work

Add a purpose-built player identity endpoint, for example:

```http
GET /api/player-identities?friend_code=1234-5678-9012
GET /api/player-identities?query=daseia&season=s3&division=d1
```

Responses should include:

- `player_id`
- canonical lounge name
- primary friend code
- all known friend codes
- relevant aliases
- season/division team entries when available
- match confidence/reason (`exact_friend_code`, `alias_suggestion`, or `none`)

Exact friend-code lookup may auto-confirm. Alias results are suggestions only. A second endpoint or later ingestion workflow will be needed to attach a new friend code to an existing player or create a new player; the editor should not mutate identity records merely by searching.

Add a track-search endpoint returning canonical names and aliases so race entry avoids spelling variants.

## Validation And Review

Block final ingestion, and strongly warn before download, when any of these are true:

- A configured player has unresolved identity status.
- The same friend code is assigned twice.
- Two configured entries resolve to the same `player_id` unintentionally.
- A race has duplicate players, empty slots, or more placements than room size.
- A player is assigned to the wrong team.
- A race has an unknown track without explicit confirmation.
- A role is unconfirmed.
- Derived totals do not match a loaded file's raw totals.
- A non-FFA match contains player penalties.
- A team-format race has unexpected team counts without an acknowledged disconnect/substitution condition.

Validation messages should link or scroll to the exact field or race that needs attention.

## Workflow Improvements

The following additions should materially speed up Season 3 entry:

- Autosave drafts to browser storage, keyed by uploaded filename or match label.
- Copy the previous race's active lineup while clearing placements.
- Keyboard entry: choose a slot, type to search a player, press Enter, then advance.
- A compact race navigator showing complete, warning, and incomplete states.
- Undo/redo for drag, swap, room-size, and substitution actions.
- Track autocomplete with recent tracks and duplicate-name warnings.
- A live score summary by team and player beside the race editor.
- JSON preview as a read-only advanced panel, with a download enabled only after compilation succeeds.
- An import comparison for uploaded JSON: show what the editor corrected or regenerated before export.
- A `Duplicate previous match setup` action that copies metadata structure, teams, and roster but clears race results.

## Implementation Phases

### Phase 1: Contracts And Tests

- Finalize explicit `race_roles` JSON compatibility.
- Implement and test scoring by room size against repository examples.
- Define race-oriented draft types and JSON compile/decompile functions.
- Add fixture tests for a normal 5v5, a substitution, a disconnect, a shortened match, and malformed historical data.

### Phase 2: Identity And Reference APIs

- Add exact friend-code identity lookup and alias suggestions.
- Add canonical track search.
- Add frontend hooks with loading, confirmed, unresolved, and conflict states.

### Phase 3: Metadata, Teams, And Roster UI

- Match the shared back-link style.
- Separate metadata from teams and players.
- Remove result editing from player rows.
- Add identity confirmation and non-FFA penalty behavior.

### Phase 4: Race Editor

- Build focused and expanded race views.
- Add drag-and-drop plus accessible dropdown assignment.
- Add room-size-aware score display and role controls.
- Add substitution/disconnect behavior and race-level validation.

### Phase 5: Compilation And Export

- Generate all arrays, totals, GP data, and rendered compatibility fields.
- Add JSON preview, comparison, and download.
- Preserve unknown uploaded fields and visibly report corrections.

### Phase 6: Ingestion Preparation

- Add draft autosave and recovery.
- Add server-side validation using the same rules.
- Later, add authenticated repo/database ingestion with duplicate source detection, transaction boundaries, and an audit trail.

## Recommended First Implementation Boundary

Build through Phase 5 without direct database writes. The editor can use read-only identity and track APIs, produce a validated JSON file, and make Season 3 cleanup substantially faster while keeping ingestion reversible. Direct upload into the repository and analytics database should follow after the generated files have been tested through the existing importer.
