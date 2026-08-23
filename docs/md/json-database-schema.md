# JSON Structure And Analytics Database Schema

This document describes raw MKW Table Bot JSON and its import mapping. The fresh,
authoritative documentation for every implemented relational table is
[`database.md`](database.md); where older design discussion below differs from that
reference or `backend/models.py`, the database reference and models win.

Raw files are organized by league, season, and division:

```text
backend/JSON/{league}/{season}/{division}/
```

Examples:

- `backend/JSON/ctc/s1/d1_2/`
- `backend/JSON/ctc/s1/d3/`
- `backend/JSON/ctc/s1/d4/`

Future uploads should use the same structure, with one division number per folder unless the historical season truly combined divisions.

## Analysis Summary

The CTC match files are JSON objects even when the file extension is `.txt`. Most match files also have a `.json` copy. Across the current repo, the match-shaped files have a consistent structure:

- top-level match metadata
- an ordered track list
- one `teams` object keyed by team tag/name
- each team has a `players` object keyed by friend code
- each player has per-race scores and positions

One notable outlier is `backend/JSON/rt_gsc_s13/rt_gsc_s13.json`, which is a top-level list containing many match-like objects rather than one match object. The importer should support both single-match JSON objects and batch JSON arrays.

Observed match-shaped file facts:

- Top-level keys: `title_str`, `format`, `races_played`, `rxx`, `tracks`, `teams`
- Observed `format`: `5v5`
- Observed race counts: `7`, `10`, `11`, `12`, `13`, `17`
- Observed teams per match: `1`, `2`, `3`
- Observed players per team object: `1`, `4`, `5`, `6`, `7`
- Some team records have penalties.
- A smaller number of player records have penalties.
- Some players have `subbed_out: true`.
- Some `race_positions` arrays contain `null`.

Season and division are not present inside the JSON. They need to come from folder naming, filename metadata, an upload form, or a manual import manifest.

Editor-generated regular-season JSON includes `league`, `season`, `division`,
`match_type`, `week`, and `match_label`. Playoff JSON replaces `week` with
`playoff_format`, `playoff_stage`, `playoff_series_number`,
`series_match_number`, and odd `best_of` metadata. See
[`playoff-support-implementation.md`](playoff-support-implementation.md). On
confirmed upload, the backend archives the exact
validated JSON under `backend/JSON/{league}/{season}/{division}/` and stores its
path and SHA-256 in `source_files`.

CTC matches should be modeled as two-team matches. If an imported JSON object has a third team, treat that as a data-quality issue rather than a true three-team match. The likely explanation is that a sub was parsed as a separate team by mistake and should be manually assigned to one of the two actual teams during import review.

## Raw JSON Shape

Representative structure:

```json
{
  "title_str": "#title 12 races\n",
  "format": "5v5",
  "races_played": 12,
  "rxx": ["r10286270", "r10286376"],
  "tracks": ["Banished Keep", "Pipe Underworld"],
  "teams": {
    "TMNG": {
      "table_tag_str": "TMNG #FF0404",
      "table_penalty_str": "",
      "total_score": 334,
      "penalties": 0,
      "hex_color": "#FF0404",
      "players": {
        "5245-8888-2222": {
          "table_str": "Mossan [jp] 35|41|40",
          "mii_name": "TMNG shun",
          "lounge_name": "Mossan",
          "table_name": "Mossan",
          "tag": "TMNG",
          "total_score": 116,
          "had_penalties": false,
          "penalties": 0,
          "subbed_out": false,
          "race_scores": [10, 4],
          "race_positions": [3, 6],
          "gp_scores": [[10, 4]],
          "flag": "jp"
        }
      }
    }
  }
}
```

## Field Meaning

### Match-Level Fields

| JSON field | Meaning | Notes |
| --- | --- | --- |
| `title_str` | Table title string | Often contains race count text. |
| `format` | Match format | Currently observed as `5v5`. |
| `races_played` | Number of races in this table | Should match `tracks.length` in normal cases. |
| `rxx` | Ordered Table Bot room references | Add a new value when the room resets or changes host. It is not one code per GP; array length is independent of race and GP count. |
| `tracks` | Ordered list of tracks | The array index maps to race number. |
| `teams` | Team result object | Keys are raw team tags/names. |
| `match_type` | Competition category | Optional; omitted means `regular`, or use `playoff`. |
| `week` | Regular-season week | Required for new regular uploads; omitted for playoffs. |
| `playoff_format` | Division bracket format | `three_team` or `four_team`; playoff only. |
| `playoff_stage` | Series stage | `semifinals` or `finals`; playoff only. |
| `playoff_series_number` | Series within the stage | Semifinals use 1 or 2 as allowed; finals use 1. |
| `series_match_number` | Match within the best-of series | Positive, sequential, and no greater than `best_of`. |
| `best_of` | Series length | Positive odd number; defaults to 3. |

### Team-Level Fields

| JSON field | Meaning | Notes |
| --- | --- | --- |
| object key | Raw team key | Example `TMNG`; may be clan tag or display tag. |
| `table_tag_str` | Tag plus color string | Example `TMNG #FF0404`. |
| `table_penalty_str` | Human-readable penalty string | Empty string if none. |
| `total_score` | Team total score shown by table bot | Store raw. Confirm later whether already net of penalties. |
| `penalties` | Team penalty points | Usually `0`, positive number when penalty exists. |
| `hex_color` | Team display color | Useful for frontend but not identity. |
| `missing_player_results` | Optional team-level race results | Editor extension. Each item contains `race_number`, `score`, and a reason: `short_roster`, `unreplaced_disconnect`, or `unknown`. |
| `missing_player_scores` | Optional ordered team-level scores | Legacy compatibility form. Each index maps to a race; prefer `missing_player_results` for new files. |
| `players` | Player result object | Keys are friend codes. |

### Player-Level Fields

| JSON field | Meaning | Notes |
| --- | --- | --- |
| object key | Friend code | Best available stable player identifier from JSON. |
| `table_str` | Rendered table row text | Useful for audit/debugging. |
| `mii_name` | Raw Mii name | Can include symbols and team tag styling. |
| `lounge_name` | Lounge name | Sometimes empty. |
| `table_name` | Displayed table name | Fallback when lounge name is empty. |
| `tag` | Team tag on player row | Usually matches team key. |
| `total_score` | Player total score | Store raw. |
| `had_penalties` | Whether player had penalties | Rare, but present. |
| `penalties` | Player penalty points | Usually `0`. |
| `subbed_out` | Whether player subbed out | Store for roster and race availability logic. |
| `race_scores` | Ordered per-race scores | Index maps to `tracks` index. |
| `race_positions` | Ordered per-race placements | May contain `null`. |
| `gp_scores` | Scores grouped by GP | Can be stored as JSON or normalized later. |
| `race_roles` | Optional ordered manual roles | New editor output; values are `runner`, `bagger`, or `null`. Historical files omit it. |
| `flag` | Country/region flag code | Optional profile attribute. |

Some manually edited tables preserve a nonzero `race_scores` value while the matching `race_positions` value is `null`. This represents a known player who disconnected, received disconnection points, and did not receive a placement. Importers and editors must preserve the score on that real player; they must not infer a placement, treat the player as absent, or discard the score.

Team-level missing-player results cover different cases: a team started with four players, or a player left and was not replaced so the team continued with four. Store these in `missing_player_results` instead of creating a fake player or friend code. These points contribute to team totals and race differentials, but never to an individual player's analytics.

```json
"missing_player_results": [
  { "race_number": 1, "score": 3, "reason": "short_roster" },
  { "race_number": 7, "score": 3, "reason": "unreplaced_disconnect" }
]
```

Room size controls the deterministic score table and the number of placement slots. Team-level missing-player points and known-player disconnection points with no placement are supplemental results; neither occupies a placement slot.

## Recommended Database Model

The main idea is to keep raw imported facts separate from normalized identities:

- `teams` and `players` represent canonical identities.
- `team_season_entries` and `player_season_entries` represent who they were in a specific season/division.
- `matches`, `match_teams`, and `match_players` preserve exactly what the table showed.
- `races` and `race_player_results` power analytics.
- `penalties` stores penalty facts without pretending all penalties are race-level when the JSON does not say that.

## Core Tables

### `seasons`

Stores CTC season metadata.

| Column | Type | Notes |
| --- | --- | --- |
| `season_id` | integer primary key | Internal ID. |
| `season_number` | integer | Example `1`, `2`, `3`. |
| `name` | text | Example `Custom Track Cup Season 3`. |
| `status` | text | Example `complete`, `ongoing`, `planned`. |
| `starts_on` | date nullable | Optional. |
| `ends_on` | date nullable | Optional. |

### `divisions`

Stores divisions within a season.

| Column | Type | Notes |
| --- | --- | --- |
| `division_id` | integer primary key | Internal ID. |
| `season_id` | foreign key to `seasons` | Required. |
| `division_code` | text | Example `1_2`, `3`, `4`. |
| `division_name` | text | Example `Division 1-2`. |

Recommended unique key: `(season_id, division_code)`.

### `source_files`

Tracks every imported raw file.

| Column | Type | Notes |
| --- | --- | --- |
| `source_file_id` | integer primary key | Internal ID. |
| `season_id` | foreign key to `seasons` | Placeholder/manual value at import. |
| `division_id` | foreign key to `divisions` | Placeholder/manual value at import. |
| `source_path` | text | Repo path or upload path. |
| `source_filename` | text | Original filename. |
| `file_sha256` | text | Deduplication and audit. |
| `json_shape` | text | Example `single_match` or `match_array`. |
| `imported_at` | timestamp | When processed. |

### `database_addition_logs`

Stores the durable live feed of catalog records created by confirmed editor
uploads. Rows are inserted in the same transaction as the match, so previews
and failed uploads never produce events.

| Column | Type | Notes |
| --- | --- | --- |
| `addition_log_id` | integer primary key | SSE event ID and ordering cursor. |
| `match_id` | foreign key to `matches`, nullable | Upload responsible for the addition. |
| `entity_type` | text | Example `team`, `player_friend_code`, or `track`. |
| `entity_id` | integer | Primary key of the added entity. |
| `summary` | text | Human-readable log message. |
| `details_json` | text JSON | Structured identifiers and context. |
| `created_at` | timestamp | Commit-time event timestamp. |

## Team Tables

### `teams`

Canonical team/clan identity.

| Column | Type | Notes |
| --- | --- | --- |
| `team_id` | integer primary key | Internal ID. |
| `canonical_name` | text | Human-friendly name if known. |
| `canonical_tag` | text | Stable clan tag if known. |
| `created_at` | timestamp | Audit. |

This table should not be overtrusted early. Clan tags and names can be messy, so start with raw imported tags and allow manual merges later.

### `team_season_entries`

Team identity within one season/division.

| Column | Type | Notes |
| --- | --- | --- |
| `team_season_entry_id` | integer primary key | Internal ID. |
| `team_id` | foreign key to `teams` | Canonical team. |
| `season_id` | foreign key to `seasons` | Required. |
| `division_id` | foreign key to `divisions` | Required. |
| `display_name` | text | Name to show for this season/division. |
| `clan_tag` | text | Raw or normalized tag. |
| `hex_color` | text nullable | Most recently seen table color. |

Recommended unique key: `(season_id, division_id, clan_tag)`, with manual override support if needed.

## Player Tables

### `players`

Canonical player/person identity.

| Column | Type | Notes |
| --- | --- | --- |
| `player_id` | integer primary key | Internal ID. |
| `canonical_name` | text nullable | Best display name. |
| `canonical_name_override` | boolean | When true, only manual edits determine the canonical name. Defaults to false. |
| `primary_friend_code` | text nullable | Friend codes can change, so keep aliases too. |
| `created_at` | timestamp | Audit. |

### `player_friend_codes`

Stores all friend codes seen for a player.

| Column | Type | Notes |
| --- | --- | --- |
| `player_friend_code_id` | integer primary key | Internal ID. |
| `player_id` | foreign key to `players` | Required. |
| `friend_code` | text | Example `5245-8888-2222`. |
| `first_seen_match_id` | foreign key nullable | Optional audit. |
| `last_seen_match_id` | foreign key nullable | Optional audit. |

Recommended unique key: `friend_code`, unless you later discover recycled/shared codes.

### `player_aliases`

Stores lounge, Mii, table, MKCentral names and IDs, and displaced canonical names
seen for a player.

| Column | Type | Notes |
| --- | --- | --- |
| `player_alias_id` | integer primary key | Internal ID. |
| `player_id` | foreign key to `players` | Required. |
| `alias_type` | text | Includes `lounge_name`, `mii_name`, `table_name`, `mkc_name`, `mkc_id`, and `canonical_name`. |
| `alias_value` | text | Raw value. |
| `first_seen_match_id` | foreign key nullable | Optional audit. |
| `last_seen_match_id` | foreign key nullable | Optional audit. |
| `created_at` | timestamp | When this distinct alias was first entered. |
| `last_observed_at` | timestamp | Most recent observation; used to select the current MKCentral name. |

### `player_season_entries`

Connects players to teams for a specific season/division.

| Column | Type | Notes |
| --- | --- | --- |
| `player_season_entry_id` | integer primary key | Internal ID. |
| `player_id` | foreign key to `players` | Required. |
| `team_season_entry_id` | foreign key to `team_season_entries` | Required. |
| `season_id` | foreign key to `seasons` | Denormalized for easy filtering. |
| `division_id` | foreign key to `divisions` | Denormalized for easy filtering. |
| `primary_lounge_name` | text nullable | Best name in this season/division. |
| `primary_mii_name` | text nullable | Optional. |
| `flag` | text nullable | Latest seen flag code. |
| `first_seen_match_id` | foreign key nullable | Optional audit. |
| `last_seen_match_id` | foreign key nullable | Optional audit. |

This table handles the case where a player changes teams between seasons or divisions.

## Match Tables

### `matches`

One imported match/table.

| Column | Type | Notes |
| --- | --- | --- |
| `match_id` | integer primary key | Internal ID. |
| `season_id` | foreign key to `seasons` | Manual/import metadata. |
| `division_id` | foreign key to `divisions` | Manual/import metadata. |
| `source_file_id` | foreign key to `source_files` | Audit. |
| `match_type` | text | `regular` or `playoff`; defaults to regular. |
| `week_number` | integer nullable | Historical imports may omit it; editor uploads require a positive whole number. Multiple matches may share a week. |
| `playoff_series_id` | foreign key nullable | Required for playoff matches and absent for regular matches. |
| `series_match_number` | integer nullable | Positive and unique within a playoff series. |
| `match_label` | text | Filename or friendly label. |
| `title_str` | text nullable | Raw JSON title. |
| `format` | text | Example `5v5`. |
| `races_played` | integer | From JSON. |
| `raw_json` | json nullable | Optional full raw snapshot. |
| `created_at` | timestamp | Audit. |

Validation rule: a normal imported CTC match should resolve to exactly two `match_teams` rows. If the raw JSON contains one or three team objects, mark the match as needing review before analytics treat it as final.

### `match_table_refs`

Stores `rxx` values.

| Column | Type | Notes |
| --- | --- | --- |
| `match_table_ref_id` | integer primary key | Internal ID. |
| `match_id` | foreign key to `matches` | Required. |
| `ref_value` | text | Example `r10286270`. |
| `ref_order` | integer | Original order in `rxx`. |

### `match_teams`

One row per team in a match.

| Column | Type | Notes |
| --- | --- | --- |
| `match_team_id` | integer primary key | Internal ID. |
| `match_id` | foreign key to `matches` | Required. |
| `team_season_entry_id` | foreign key to `team_season_entries` | Required after identity resolution. |
| `raw_team_key` | text | Key from the `teams` object. |
| `table_tag_str` | text nullable | Raw JSON. |
| `hex_color` | text nullable | Raw JSON. |
| `raw_total_score` | integer | From JSON. |
| `team_penalty_points` | integer default `0` | From JSON `penalties`. |
| `table_penalty_str` | text nullable | Raw penalty text. |
| `final_score` | integer nullable | Optional computed/confirmed score. |

### `match_players`

One row per player as listed on a match table.

| Column | Type | Notes |
| --- | --- | --- |
| `match_player_id` | integer primary key | Internal ID. |
| `match_team_id` | foreign key to `match_teams` | Required. |
| `player_id` | foreign key to `players` | Required after identity resolution. |
| `player_season_entry_id` | foreign key nullable | Useful when roster is known. |
| `friend_code_raw` | text | Object key from JSON. |
| `lounge_name_raw` | text nullable | Raw JSON. |
| `mii_name_raw` | text nullable | Raw JSON. |
| `table_name_raw` | text nullable | Raw JSON. |
| `tag_raw` | text nullable | Raw JSON. |
| `flag` | text nullable | Raw JSON. |
| `table_str` | text nullable | Raw rendered table row. |
| `raw_total_score` | integer | From JSON. |
| `player_penalty_points` | integer default `0` | From JSON. |
| `had_penalties` | boolean | From JSON. |
| `subbed_out` | boolean | From JSON. |
| `gp_scores_json` | json nullable | Preserve GP grouping. |

## Race And Result Tables

### `tracks`

Canonical track identity.

| Column | Type | Notes |
| --- | --- | --- |
| `track_id` | integer primary key | Internal ID. |
| `canonical_name` | text | Normalized track name. |
| `created_at` | timestamp | Audit. |

Recommended unique key: `canonical_name`.

### `track_aliases`

Stores raw spellings or future renamed tracks.

| Column | Type | Notes |
| --- | --- | --- |
| `track_alias_id` | integer primary key | Internal ID. |
| `track_id` | foreign key to `tracks` | Required. |
| `alias_value` | text | Raw imported value. |

### `races`

One row per race in a match.

| Column | Type | Notes |
| --- | --- | --- |
| `race_id` | integer primary key | Internal ID. |
| `match_id` | foreign key to `matches` | Required. |
| `race_number` | integer | 1-based index from `tracks`. |
| `track_id` | foreign key to `tracks` | Required after track resolution. |
| `track_name_raw` | text | Raw value from JSON `tracks`. |
| `has_penalty` | boolean default `false` | Derived from penalties linked to this race, if known. |

Recommended unique key: `(match_id, race_number)`.

Important caveat: the current JSON usually does not identify which race a penalty belongs to. Most penalties are team-level or player-level match penalties. For that reason, detailed penalty data should live in a separate `penalties` table where `race_id` can be nullable.

### `race_player_results`

One row per player's result in one race.

| Column | Type | Notes |
| --- | --- | --- |
| `race_player_result_id` | integer primary key | Internal ID. |
| `race_id` | foreign key to `races` | Required. |
| `match_player_id` | foreign key to `match_players` | Required. |
| `player_id` | foreign key to `players` | Denormalized for fast queries. |
| `match_team_id` | foreign key to `match_teams` | Denormalized for fast queries. |
| `team_season_entry_id` | foreign key to `team_season_entries` | Denormalized for fast queries. |
| `score` | integer nullable | From `race_scores[race_number - 1]`. |
| `position` | integer nullable | From `race_positions[race_number - 1]`; can be null. |
| `role` | text | `runner`, `bagger`, or `unknown`. |
| `role_source` | text | `manual`, `inferred`, or `unknown`. |
| `is_subbed_out_result` | boolean | Useful when score/position is missing or null. |

Historical JSON usually does not explicitly say "bagger" or "runner". Newer editor output can provide a manual role in `race_roles`; that value is authoritative. Otherwise, store a role inferred from placement so it can still be audited or manually corrected.

Suggested initial inference:

- explicit `race_roles` value: preserve it with `role_source = manual`
- position 9 or 10: `role = bagger`, `role_source = inferred`
- position 1 through 8: `role = runner`, `role_source = inferred`
- missing or invalid position: `role = unknown`, `role_source = unknown`

If CTC has a better official rule, encode that rule in the importer and keep `role_source` so future audits are possible.

### `race_team_results`

Stores race points that belong to a team but not to a player identity.

| Column | Type | Notes |
| --- | --- | --- |
| `race_team_result_id` | integer primary key | Internal ID. |
| `race_id` | foreign key to `races` | Required. |
| `match_team_id` | foreign key to `match_teams` | Team receiving the points. |
| `score` | integer | Missing-player points for this race. |
| `result_type` | text | Currently `missing_player`. |
| `reason` | text | `short_roster`, `unreplaced_disconnect`, or `unknown`. |

These rows are included in team totals and race differential charts, but excluded from player averages, race counts, rankings, and identity data.

## Penalty Tables

### `penalties`

Stores team-level, player-level, and optionally race-level penalties.

| Column | Type | Notes |
| --- | --- | --- |
| `penalty_id` | integer primary key | Internal ID. |
| `match_id` | foreign key to `matches` | Required. |
| `race_id` | foreign key nullable | Null when JSON does not identify a race. |
| `match_team_id` | foreign key nullable | Set for team penalties. |
| `match_player_id` | foreign key nullable | Set for player penalties. |
| `penalty_scope` | text | `team`, `player`, `race`, `unknown`. |
| `penalty_points` | integer | Positive points deducted, matching JSON style. |
| `raw_penalty_text` | text nullable | Example `Penalty -5`. |
| `source_field` | text | Example `team.penalties`, `player.penalties`. |

This table keeps the `races.has_penalty` flag simple while preserving the true source detail.

## Import Mapping

For each match object:

1. Create or find `season` and `division` from provided import metadata.
2. Create `source_files` row using file path and hash.
3. For a playoff, validate/lock the division format and resolve or create the series
   and immutable participants.
4. Create `matches` row with exclusive regular-week or playoff-series metadata.
5. Insert each `rxx` value into `match_table_refs`.
6. Insert or resolve each raw team into `teams` and `team_season_entries`.
7. Insert `match_teams`, but require the match to resolve to exactly two real teams.
8. Insert team penalties into `penalties`.
9. Insert or resolve each player by friend code into `players`.
10. Store lounge, Mii, table, and any resolved MKCentral names and profile IDs in
    `player_aliases`.
11. Connect player to team/season/division in `player_season_entries`.
12. Insert `match_players`.
13. Insert player penalties into `penalties`.
14. Insert tracks into `tracks` and `track_aliases`.
15. Insert one `races` row per track index.
16. Expand `race_scores` and `race_positions` into `race_player_results`.
17. Expand team `missing_player_results` into `race_team_results`.

## Suggested Minimum Viable Schema

If you want to move quickly, start with these tables:

- `seasons`
- `divisions`
- `source_files`
- `teams`
- `team_season_entries`
- `players`
- `player_aliases`
- `player_season_entries`
- `matches`
- `match_teams`
- `match_players`
- `tracks`
- `races`
- `race_player_results`
- `penalties`

This is enough to power the existing website analytics and unlock season/division filtering, match-level auditability, player/team history, and race-level analytics.

## Design Notes

- Do not use team tag alone as a permanent team ID.
- Model CTC matches as two-team matches; third raw team objects should enter a review queue and usually represent a sub attached to the wrong team.
- Do not use lounge name alone as a permanent player ID.
- Friend code is the best player identity signal in the current JSON, but keep alias tables because names and codes can change.
- Keep raw names and raw table strings so imports are auditable.
- Keep `raw_json` or at least `source_files.file_sha256` so every derived row can be traced back to a source.
- Keep season and division as explicit database fields even if they are manually supplied at first.
- Store penalties separately from races because the JSON does not generally locate penalties by race.
- Store bagger/runner role as a value with a source, not as a destructive rename like `player (bag)`.
