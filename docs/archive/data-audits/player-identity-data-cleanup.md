# Player Identity Data Cleanup

> Historical Phase 0 investigation. Its SQLite commands are not supported
> operational workflows; retained source snapshots live in
> `docs/archive/sqlite-retired/`. Current identity data is rebuilt into PostgreSQL
> from the reviewed registries.

This note covers two related data quality issues in the analytics database:

- player lookups returning `Ambiguous player alias`
- ensuring a single friend code never belongs to multiple distinct players

The short version: friend-code identity is already protected in the current schema, but alias identity is not. The current importer creates players by friend code only, so when the same person appears later with a different friend code, the database creates a second `players` row. If both rows share the same lounge/table/Mii alias in the same season/division, the API correctly refuses to guess and returns `Ambiguous player alias`.

## Current Findings

Local database checked: `backend/data/ctc_stats.sqlite`.

Row counts at time of inspection:

```text
players 283
player_friend_codes 283
player_aliases 1306
player_season_entries 446
match_players 2188
```

Friend-code diagnostics found no current violations:

- no duplicated rows in `player_friend_codes.friend_code`
- no `match_players.friend_code_raw` value attached to multiple `player_id` values
- `player_friend_codes.friend_code` has a unique SQLite index from the schema constraint

Alias diagnostics did find scoped collisions. Examples include likely same-person code changes such as `Arthur Morgan`, `JakeUS`, `lord`, `Tectrox`, `ardux`, and `smu`, plus noisy aliases such as team-tag Mii names (`sts`, `cpfg`) or glyph-only Mii names that should not be auto-merged.

Current collision counts from the local DB:

```text
scoped alias collision groups 40
direct display collision groups 26
```

## Root Cause

The importer resolves identity here:

```python
def get_or_create_player(session, friend_code: str, player_data: dict[str, Any]) -> Player:
    friend_code_row = session.scalar(select(PlayerFriendCode).where(PlayerFriendCode.friend_code == friend_code))
    if friend_code_row:
        return session.get(Player, friend_code_row.player_id)

    player = Player(canonical_name=display_player_name(player_data), primary_friend_code=friend_code)
    ...
```

That is safe for friend-code consistency, but it intentionally does not merge by lounge name. This means a changed friend code creates a new player.

Player lookup later searches all scoped players by direct display fields and by aliases:

```python
select(PlayerAlias.player_id).where(func.lower(PlayerAlias.alias_value) == query)
```

If the same alias belongs to multiple player IDs in the requested season/division, `stats_db.py` raises `AmbiguousPlayerError`. That behavior is correct; the data needs review rather than a guessed player.

## Cleanup Approach

Use a two-level policy:

1. Friend code is a hard identity key.
   If the same friend code ever points at multiple player IDs, merge those player IDs immediately. This is safe based on the project rule that the same friend code means the same person.

2. Alias collisions are review candidates, not automatic merges.
   Same lounge/table/Mii text can mean one person changed friend codes, but it can also be shared or noisy. Only merge alias collisions after reviewing the match history, teams, flags, and names.

Recommended review priority:

- exact same `lounge_name` or `table_name` in the same season/division
- same display name and similar team continuity
- multiple friend codes but no overlapping appearances in the same match
- ignore or deprioritize Mii-only aliases that are just clan tags, decorative glyphs, or common short strings

## Display Policy

The app should display one row per player, not one row per friend code. After identity cleanup, a player with multiple friend codes should have one `players.player_id` and multiple rows in `player_friend_codes`.

The backend display fallback for each player is:

1. `players.canonical_name`
2. most recent `lounge_name` alias for the player
3. most common `table_name` alias
4. most common `mii_name` alias

When a player has changed friend codes, the dropdown should still show one option:

```text
ardux
```

The stricter ambiguity behavior should remain for noisy aliases that match multiple different players. For example, a clan-tag Mii alias such as `sts` can still be ambiguous if it points to several differently displayed players.

## Implemented Fix

The durable fix is now an identity-map and merge workflow. The schema already supported one player having many friend codes; the importer just needed a reviewed way to know which new friend codes belonged to existing players.

### Identity Map

Reviewed identity groups live in:

```text
backend/data/player_identities.csv
```

The file maps each seen friend code to a canonical friend code. This historical rebuild input
retains its original `canonical_lounge_name` header; the importer maps it to
`players.canonical_name`:

```csv
canonical_friend_code,friend_code,canonical_lounge_name,note
3227-2287-3933,3227-2287-3933,DASEIA,s2 d1 sσρ exact display/team match
3227-2287-3933,4773-4468-0050,DASEIA,s2 d1 sσρ exact display/team match
```

That means both `3227-2287-3933` and `4773-4468-0050` should resolve to one `players.player_id`.

The initial identity map contains 30 friend-code rows across 14 reviewed player groups. It covers exact same-name/same-team split cases such as:

```text
DASEIA, mhs, ardux, smu, Tectrox, sog, Arthur Morgan, JakeUS, lord
```

### Import Behavior

`backend/import_json_to_db.py` now loads the identity map with `load_player_identities()`.

`get_or_create_player()` now resolves an incoming friend code like this:

1. Look for the exact friend code in `player_friend_codes`.
2. If not found, look for any friend code in the same identity-map group.
3. If any mapped friend code already exists, attach the new friend code to that same `player_id`.
4. If no mapped code exists yet, create one `players` row using the canonical friend code.

This makes rebuilds deterministic: the same JSON archive plus `player_identities.csv` recreates one player row with multiple friend-code rows.

Desired shape:

```text
players
player_id | canonical_name | primary_friend_code
186       | DASEIA                | 3227-2287-3933

player_friend_codes
player_id | friend_code
186       | 3227-2287-3933
186       | 4773-4468-0050
```

### One-Time Current DB Merge

The current SQLite DB was migrated with:

```bash
.venv-wsl/bin/python backend/scripts/merge_player_identities.py
```

The script created a backup first:

```text
backend/data/ctc_stats.sqlite.bak-20260708230801
```

It then merged 16 duplicate `players` rows into canonical player rows. Examples:

```text
188 -> 186 (3227-2287-3933) DASEIA
193 -> 181 (2883-6411-3991) mhs
261 -> 151 (3527-8828-8735) ardux
270 -> 172 (1595-1415-3310) smu
```

The merge script updates:

- `player_friend_codes.player_id`
- `player_aliases.player_id`
- `player_season_entries.player_id`
- `match_players.player_id`
- `match_players.player_season_entry_id` when duplicate season entries collapse
- `race_player_results.player_id`
- `players.primary_friend_code`
- `players.canonical_name`

Then it deletes now-unreferenced duplicate `players` rows.

### Stats Code Cleanup

Because identity is now fixed in the DB, the stats layer no longer needs to aggregate multiple raw player IDs for one selected player.

The previous query-time grouping helpers were removed:

```text
PlayerSelection
_selection_from_rows()
_player_ids()
_format_player_stat_groups()
```

`findplayeravg()` and `top_player_tracks()` now filter by one canonical `player_id` again:

```python
RacePlayerResult.player_id == player_row.player_id
```

`top_team_players()` and `top_track_players()` group by `Player.player_id`, so distinct players are not merged just because they share a display name.

### Display Name Selection

The helper `_display_names_for_players()` still computes display names for API output:

```text
canonical_name
else most recent lounge_name alias
else most common table_name alias
else most common mii_name alias
```

When a canonical name is missing, the `most recent lounge_name` fallback is chosen by highest
`player_aliases.last_seen_match_id`, with stable tie-breakers from alias usage count and alias row
ID. `table_name` and `mii_name` fallbacks use most common value first.

### Verification

After applying the merge, the exact same-name/same-team split query returned:

```text
0
```

The scratch rebuild also produced the merged shape:

```bash
.venv-wsl/bin/python backend/import_json_to_db.py --db /tmp/ctc_identity_rebuild.sqlite --rebuild
```

The rebuilt DB had:

```text
players: 267
```

The previous DB had 283 players, so the rebuild reflects the 16 merged duplicate player rows.

Smoke checks:

```text
s2/d1 DASEIA -> 104.2 avg, 96 races
s2/d1 mhs    -> 103.2 avg, 60 races
s2/d5 ardux  -> 67.5 avg, 96 races
s2/d5 smu    -> 73.3 avg, 36 races
```

API examples:

```bash
curl -sS 'http://127.0.0.1:5001/api/players?season=s2&division=d1'
curl -sS 'http://127.0.0.1:5001/api/player-avg?name=DASEIA&season=s2&division=d1'
curl -sS 'http://127.0.0.1:5001/api/player-avg?name=ardux&season=s2&division=d5'
```

## Diagnostic SQL

These queries are written for SQLite. They can be run with `sqlite3 backend/data/ctc_stats.sqlite` or via Python's `sqlite3` module.

### Friend Code Duplicates

This should return zero rows.

```sql
SELECT
  friend_code,
  COUNT(*) AS rows,
  COUNT(DISTINCT player_id) AS players,
  GROUP_CONCAT(DISTINCT player_id) AS player_ids
FROM player_friend_codes
GROUP BY friend_code
HAVING COUNT(*) > 1 OR COUNT(DISTINCT player_id) > 1
ORDER BY friend_code;
```

Check the raw imported match rows too. This should also return zero rows.

```sql
SELECT
  friend_code_raw AS friend_code,
  COUNT(DISTINCT player_id) AS players,
  GROUP_CONCAT(DISTINCT player_id) AS player_ids,
  COUNT(*) AS appearances
FROM match_players
GROUP BY friend_code_raw
HAVING COUNT(DISTINCT player_id) > 1
ORDER BY players DESC, friend_code;
```

Verify the unique constraint/index exists.

```sql
PRAGMA index_list(player_friend_codes);
```

### Scoped Alias Collisions

This finds aliases that map to multiple players inside the same season/division lookup scope.

```sql
SELECT
  s.season_code,
  d.division_code,
  LOWER(pa.alias_value) AS alias_key,
  pa.alias_type,
  COUNT(DISTINCT pse.player_id) AS players,
  GROUP_CONCAT(DISTINCT pse.player_id) AS player_ids,
  GROUP_CONCAT(DISTINCT COALESCE(
    pse.primary_lounge_name,
    p.canonical_name,
    pse.primary_mii_name,
    ''
  )) AS names
FROM player_aliases pa
JOIN player_season_entries pse ON pse.player_id = pa.player_id
JOIN players p ON p.player_id = pse.player_id
JOIN seasons s ON s.season_id = pse.season_id
JOIN divisions d ON d.division_id = pse.division_id
GROUP BY
  s.season_code,
  d.division_code,
  LOWER(pa.alias_value),
  pa.alias_type
HAVING COUNT(DISTINCT pse.player_id) > 1
ORDER BY
  s.season_code,
  d.division_code,
  players DESC,
  alias_key;
```

This version groups across alias types, which better matches the API's current lookup behavior.

```sql
WITH scoped_aliases AS (
  SELECT
    s.season_code,
    d.division_code,
    LOWER(pa.alias_value) AS alias_key,
    pa.alias_type,
    pse.player_id
  FROM player_aliases pa
  JOIN player_season_entries pse ON pse.player_id = pa.player_id
  JOIN seasons s ON s.season_id = pse.season_id
  JOIN divisions d ON d.division_id = pse.division_id
)
SELECT
  season_code,
  division_code,
  alias_key,
  COUNT(DISTINCT player_id) AS players,
  GROUP_CONCAT(DISTINCT alias_type) AS alias_types,
  GROUP_CONCAT(DISTINCT player_id) AS player_ids
FROM scoped_aliases
GROUP BY season_code, division_code, alias_key
HAVING COUNT(DISTINCT player_id) > 1
ORDER BY season_code, division_code, players DESC, alias_key;
```

### Direct Display Collisions

This finds collisions in the exact fields that `_resolve_player` checks before aliases.

```sql
WITH names AS (
  SELECT
    pse.player_id,
    pse.season_id,
    pse.division_id,
    LOWER(pse.primary_lounge_name) AS name_key,
    pse.primary_lounge_name AS display
  FROM player_season_entries pse
  WHERE pse.primary_lounge_name IS NOT NULL

  UNION ALL

  SELECT
    pse.player_id,
    pse.season_id,
    pse.division_id,
    LOWER(pse.primary_mii_name) AS name_key,
    pse.primary_mii_name AS display
  FROM player_season_entries pse
  WHERE pse.primary_mii_name IS NOT NULL

  UNION ALL

  SELECT
    pse.player_id,
    pse.season_id,
    pse.division_id,
    LOWER(p.canonical_name) AS name_key,
    p.canonical_name AS display
  FROM player_season_entries pse
  JOIN players p ON p.player_id = pse.player_id
  WHERE p.canonical_name IS NOT NULL
)
SELECT
  s.season_code,
  d.division_code,
  name_key,
  COUNT(DISTINCT player_id) AS players,
  GROUP_CONCAT(DISTINCT player_id) AS player_ids,
  GROUP_CONCAT(DISTINCT display) AS displays
FROM names
JOIN seasons s ON s.season_id = names.season_id
JOIN divisions d ON d.division_id = names.division_id
WHERE name_key IS NOT NULL AND TRIM(name_key) <> ''
GROUP BY s.season_code, d.division_code, name_key
HAVING COUNT(DISTINCT player_id) > 1
ORDER BY s.season_code, d.division_code, players DESC, name_key;
```

### Candidate Merge Detail

Use this after selecting a suspicious `player_id` group from the previous queries.

```sql
SELECT
  p.player_id,
  p.canonical_name,
  p.primary_friend_code,
  pfc.friend_code,
  s.season_code,
  d.division_code,
  tse.clan_tag,
  pse.primary_lounge_name,
  pse.primary_mii_name,
  pse.flag,
  pse.first_seen_match_id,
  pse.last_seen_match_id
FROM players p
LEFT JOIN player_friend_codes pfc ON pfc.player_id = p.player_id
LEFT JOIN player_season_entries pse ON pse.player_id = p.player_id
LEFT JOIN seasons s ON s.season_id = pse.season_id
LEFT JOIN divisions d ON d.division_id = pse.division_id
LEFT JOIN team_season_entries tse
  ON tse.team_season_entry_id = pse.team_season_entry_id
WHERE p.player_id IN (122, 134)
ORDER BY p.player_id, s.season_code, d.division_code, tse.clan_tag;
```

Check whether candidate players ever appear in the same match. If they do, do not merge without deeper review.

```sql
SELECT
  m.match_id,
  m.match_label,
  GROUP_CONCAT(DISTINCT mp.player_id) AS player_ids,
  COUNT(DISTINCT mp.player_id) AS players_in_match
FROM match_players mp
JOIN match_teams mt ON mt.match_team_id = mp.match_team_id
JOIN matches m ON m.match_id = mt.match_id
WHERE mp.player_id IN (122, 134)
GROUP BY m.match_id, m.match_label
HAVING COUNT(DISTINCT mp.player_id) > 1
ORDER BY m.match_id;
```

## Merge SQL Template

Only run this inside a transaction after manual review. Replace `:keep_player_id` and `:merge_player_id`.

```sql
BEGIN;

UPDATE OR IGNORE player_friend_codes
SET player_id = :keep_player_id
WHERE player_id = :merge_player_id;

UPDATE OR IGNORE player_aliases
SET player_id = :keep_player_id
WHERE player_id = :merge_player_id;

UPDATE OR IGNORE player_season_entries
SET player_id = :keep_player_id
WHERE player_id = :merge_player_id;

UPDATE match_players
SET player_id = :keep_player_id
WHERE player_id = :merge_player_id;

UPDATE race_player_results
SET player_id = :keep_player_id
WHERE player_id = :merge_player_id;

UPDATE players
SET primary_friend_code = COALESCE(primary_friend_code, (
  SELECT friend_code
  FROM player_friend_codes
  WHERE player_id = :keep_player_id
  ORDER BY last_seen_match_id DESC
  LIMIT 1
))
WHERE player_id = :keep_player_id;

DELETE FROM players
WHERE player_id = :merge_player_id
  AND NOT EXISTS (
    SELECT 1 FROM player_friend_codes WHERE player_id = :merge_player_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM player_aliases WHERE player_id = :merge_player_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM player_season_entries WHERE player_id = :merge_player_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM match_players WHERE player_id = :merge_player_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM race_player_results WHERE player_id = :merge_player_id
  );

COMMIT;
```

After each merge, rerun the friend-code and alias diagnostics. If `UPDATE OR IGNORE` skipped an alias or season entry because the kept player already has an equivalent row, inspect the remaining `merge_player_id` references before deleting anything.

## Prevention

### Keep the hard friend-code invariant

The current schema already has:

```python
UniqueConstraint("friend_code", name="uq_player_friend_code")
```

Do not remove this. It is the main guardrail that prevents the same friend code from becoming two players.

### Add import-time alias collision reporting

After import, run the scoped alias collision query and fail or warn in CI/local rebuilds if new collisions appear. The importer should not automatically merge these, but it should make the problem visible immediately.

Suggested behavior:

- zero friend-code duplicate tolerance: fail the import
- alias collisions: print a review report and mark the import as needing data review
- direct display collisions: print higher-priority review report because these are likely to affect `/api/player` and `/api/player-avg`

### Add a manual identity map for known code changes

Create a reviewed mapping file such as:

```csv
league_code,season_code,division_code,alias_value,friend_code,canonical_player_id,note
ctc,s1,d3,Arthur Morgan,2067-6136-4216,122,Same lounge/table name and team continuity
```

Then teach the importer to consult that map before creating a new `Player`. This prevents known changed friend codes from re-splitting after a database rebuild.

The identity map should be explicit because alias-only automatic merging would incorrectly merge noisy shared names in the current data.

## Verification Checklist

Before considering the cleanup done:

- friend-code duplicate query returns zero rows
- raw match friend-code query returns zero rows
- high-confidence direct display collisions have either been merged or documented as distinct people
- noisy alias collisions remain documented but do not block friend-code identity
- `/api/player?name=...&season=...&division=...` succeeds for reviewed merged players
- rebuilding the database from JSON plus the manual identity map reproduces the same player IDs/relationships
