# Data model and database reference

Source reference: [models.py](../../backend/models.py) and Alembic head
[`20260913_0017`](../../backend/migrations/versions/20260913_0017_team_entry_logos.py),
reviewed September 26, 2026. The root [glossary](../../CONTEXT.md) defines domain
terms; this document describes their persistence. For incoming document fields and
validation, use the [JSON format](../json-editor/json-format.md) and
[editor guide](../json-editor/README.md).

## Platform and ownership

PostgreSQL is the only supported database in local development, tests, staging,
and production. SQLAlchemy models in `backend/models.py` describe the application
schema; Alembic migrations in `backend/migrations/versions/` are the only supported
way to create or change deployed schemas. Application startup and archive imports
must never call `metadata.create_all()` outside disposable test schemas.

`backend/database.py` requires `DATABASE_URL`, normalizes `postgres://` and
`postgresql://` URLs to the Psycopg dialect, rejects non-PostgreSQL engines, enables
connection pre-ping, and uses bounded pools. Defaults are pool size 3, overflow 2,
recycle after 1,800 seconds, and application name `ctc-stats-api`.

## Local database

From the repository root:

```bash
docker compose up -d postgres
export APP_ENV=local
export DATABASE_URL=postgresql+psycopg://ctc_local:ctc_local@127.0.0.1:55432/ctc_dev
.venv/bin/alembic upgrade head
.venv/bin/python backend/import_json_to_db.py --database-url "$DATABASE_URL"
```

The Compose service publishes PostgreSQL on host port `55432` by default and stores
data in the named `ctc-postgres-data` volume. `docker compose stop` and ordinary
`docker compose down` preserve that volume.

## Relationship map

The diagrams group the schema by purpose. They show the main foreign-key
relationships, not every denormalized lookup key or provenance reference.
`models.py` remains the full column/constraint definition. There is no `leagues`
table: league ownership is represented by codes on seasons, tracks, and team league
identities.

```mermaid
flowchart TB
    Competition["Competition catalog<br/>seasons, divisions, conferences, playoffs"] --> Participation["Participation<br/>team and player season entries"]
    Identity["Identity catalog<br/>players, friend codes, aliases, teams, tracks"] --> Participation
    Participation --> Facts["Match and race facts<br/>appearances, results, penalties"]
    Source["Source files<br/>fingerprint and accepted object metadata"] --> Facts
    Review["Review queue and administrators"] --> Source
    Review --> Audit["Audit logs, addition logs, health reviews"]
    Facts --> Audit
```

SQL constraints enforce row-level invariants and uniqueness. Identity resolution,
case normalization, conference consistency, series progression, and acceptance
policy also require application checks. Similar-looking strings are not a
substitute for following foreign keys.

## Competition catalog

```mermaid
erDiagram
    seasons ||--o{ divisions : contains
    divisions ||--o{ division_conferences : groups
    divisions ||--o| division_playoff_configs : configures
    divisions ||--o{ playoff_series : contains
    playoff_series ||--o{ playoff_series_participants : names
    teams ||--o{ playoff_series_participants : participates
    seasons ||--o{ team_season_entries : scopes
    divisions ||--o{ team_season_entries : scopes
    division_conferences o|--o{ team_season_entries : groups
    teams ||--o{ team_season_entries : enters
    playoff_series o|--o{ matches : orders
```

### `seasons`

One row per league season. Columns: `season_id` primary key, `league_code`,
`season_code`, optional numeric `season_number`, display `name`, `status`, optional
`starts_on` and `ends_on`, and `created_at`. `(league_code, season_code)` is unique.

### `divisions`

A season-owned division. Columns: `division_id`, `season_id`, `division_code`,
`division_name`, and `is_conference_based`. `(season_id, division_code)` is unique.
A division owns its playoff format because formats may differ within one season.

### `division_conferences`

One named conference within a division, with `division_conference_id`,
`division_id`, `conference_code`, `conference_name`, and `sort_order`.
Both `(division_id, conference_code)` and `(division_id, sort_order)` are unique;
`sort_order` is restricted to 1 or 2. Conference setup and membership rules live in
[competition_setup.py](../../backend/competition_setup.py), and import-time matchup
checks live in [import_json_to_db.py](../../backend/import_json_to_db.py).

### `division_playoff_configs`

The locked playoff format for one division. `division_id` is both primary key and
foreign key. `format_code` currently accepts application-supported values
`three_team` and `four_team`; the table deliberately stores structural values
(`playoff_team_count`, `semifinal_series_count`, `finals_bye_count`) so a future
format can be added without reshaping existing series. Counts are non-negative and
the playoff team count must be at least two. `created_at` and `updated_at` record the
configuration lifecycle.

### `playoff_series`

A best-of series within a division. Columns: `playoff_series_id`, `season_id`,
`division_id`, `stage`, `series_number`, odd positive `best_of`, optional
`display_label`, and `created_at`. Stage is currently `semifinals` or `finals`.
`(division_id, stage, series_number)` is unique and `(season_id, division_id)` is
indexed. Finals use series number 1; that convention is enforced in the playoff module.

### `playoff_series_participants`

The two immutable team slots in a series. Columns:
`playoff_series_participant_id`, `playoff_series_id`, global `team_id`, and
`participant_slot` (1 or 2). A team and a slot may each occur only once per series.
Cross-series semifinal eligibility is enforced transactionally by the importer.

## Source and match facts

```mermaid
erDiagram
    source_files ||--o{ matches : records
    matches ||--o{ match_table_refs : references
    matches ||--o{ match_teams : contains
    team_season_entries ||--o{ match_teams : appears
    match_teams ||--o{ match_players : fields
    players ||--o{ match_players : appears
    player_season_entries o|--o{ match_players : attributes
    matches ||--o{ races : orders
    tracks ||--o{ races : played
    races ||--o{ race_player_results : records
    match_players ||--o{ race_player_results : earns
    races ||--o{ race_team_results : credits
    match_teams ||--o{ race_team_results : receives
    matches ||--o{ penalties : records
```

`race_player_results` also carries player, match-team, and team-season-entry
foreign keys for analytics. `penalties` may optionally refer to a specific race,
match team, or match player. These additional links are omitted above for clarity.

### `source_files`

One accepted archive document. It records season/division scope, unique source path,
unique SHA-256 fingerprint, filename, preserved `original_source_path`, JSON shape,
storage provider and object key, archive state/generation/attempts/error, accepting
administrator, optional review
submission, and import/archive timestamps. Storage provider is `local` or `gcs`;
archive status is `pending`, `complete`, or `repair_required`.

### `matches`

One independently scored match. Core columns are `match_id`, season/division/source
foreign keys, source-array index, label/title/format, races played, raw JSON,
import status/review notes, and creation/update time. `raw_json` stores a compact
serialization of the imported match object. Its whitespace/key ordering need not
match the archived bytes; archive repair explicitly regenerates canonical bytes
before comparing the fingerprint.

Competition metadata is exclusive:

- A regular match has `match_type = regular`, no playoff series, no series match
  number, and normally a positive `match_number`. The database permits a null match number
  for legacy/repair records; new editor uploads require one.
- A playoff match has `match_type = playoff`, a null regular-season match number, a required
  `playoff_series_id`, and a positive `series_match_number`.

`(source_file_id, match_index_in_source)` and
`(playoff_series_id, series_match_number)` are unique. Import status is `imported`
or `needs_review`; `match_type` is indexed.

`result_type` is `played`, `free_win`, or `mutual_tie`. Non-played results must
be regular matches with zero races; application validation additionally requires
exactly two teams, no player/race/penalty payload, and the expected team scores.
These recorded outcomes influence standings without inventing race facts.

### `match_table_refs`

Ordered source table references (`ref_value`, `ref_order`) for a match. Reference
order is unique within the match.

### `match_teams`

The team side of a match. It links a match to a scoped team entry and stores raw tag,
table presentation, color, raw score, team penalty points/text, and final score.
`(match_id, raw_team_key)` is unique.

### `match_players`

A player's appearance on a match team. It links the global player and optional
season entry and stores raw friend code/names/tag/flag/table text, raw total,
penalties, sub status, and serialized GP scores. A raw friend code is unique within
one match team.

### `penalties`

Normalized team, player, race, or unknown-scope penalties. Each row identifies its
match and may identify a race, match team, or match player. It preserves points,
raw text, and the source field.

## Race facts and tracks

### `tracks` and `track_aliases`

`tracks` stores a league code, canonical name, and creation time.
`(league_code, canonical_name)` is unique. All tracks that predate GSC support are
backfilled as `ctc`; newly approved tracks inherit the league of their match.
`track_aliases` links alternate values to a track; `(track_id, alias_value)` is
unique. Editor detection checks canonical names and aliases case-insensitively and
rejects a name already owned by another league rather than allowing it to be
approved as a new track.

### `races`

One numbered race in a match, with canonical track, raw track name, and penalty
flag. `(match_id, race_number)` is unique.

### `race_player_results`

The primary analytics fact table. Each row links race, match player, global player,
match team, and scoped team entry and stores nullable score/position, role, role
source, and subbed-out state. `(race_id, match_player_id)` is unique. Role is
`runner`, `bagger`, or `unknown`; source is `manual`, `inferred`, or `unknown`.

### `race_team_results`

Team-owned race points that cannot be assigned to a player, currently only missing
player results. Columns identify race and match team plus score, `result_type`, and
reason. Result type is `missing_player`; reason is `short_roster`,
`unreplaced_disconnect`, or `unknown`.

## Team and player identity

```mermaid
erDiagram
    teams ||--o{ team_league_identities : resolves
    teams ||--o{ team_aliases : recognized_as
    teams ||--o{ team_logos : displays
    teams ||--o{ team_season_entries : enters
    team_season_entries o|--o{ team_logos : scopes
    team_season_entries ||--o{ player_season_entries : rosters
    players ||--o{ player_season_entries : participates
    players ||--o{ player_friend_codes : uses
    players ||--o{ player_aliases : recognized_as
    players o|--o{ mkc_refresh_previews : targets
    tracks ||--o{ track_aliases : recognized_as
```

A player season entry is known participation, not a static roster guarantee. A
match player captures an actual appearance and its raw names/friend code. Changing
canonical presentation does not erase those raw observations.

### `teams`, `team_aliases`, `team_league_identities`, and `team_logos`

`teams` is the global identity (`team_id`, canonical tag, canonical name, automatic
league preference, manual-override flag, and creation time). Unless overridden,
the canonical name and tag follow the newest season entry, optionally restricted
to CTC or GSC. Canonical tags are presentation metadata and may match across
otherwise unlinked teams. `team_aliases` maps a globally unique
administrator-managed alternate tag to a team. Duplicate global teams can be
merged while their season entries and league links remain distinct.

`team_league_identities` is the authoritative team-identity seam for imports. Each row explicitly
maps `(league_code, tag)` to a global team, with a case-insensitive unique index on
that pair. A team may own multiple tags in a league and may be linked to both CTC
and GSC. Matching text across two leagues never establishes identity on its own.

`team_logos` stores prioritized, active assets with optional season and team season
entry scope. Its unique constraint covers `(team_id, season_id,
team_season_entry_id, asset_path)`; PostgreSQL's ordinary null semantics still
apply. New managed logo operations use the entry to distinguish divisions within
one season. An entry deletion cascades its entry-scoped logo rows.
Repository-managed assets and fallback media coexist with content-addressed admin
uploads under `team-logos/{team_id}/`, served by the public logo-content route.
Replacement deactivates other active logos in the same resolved scope, preserving
inactive history and other entries. See
[team logo management](../features/team-logo-management.md) for lookup priority
and compatibility with older global/season records.

### `team_season_entries`

A global team's season/division membership with display name, clan tag, color,
optional `conference_id`, and competition status (`active`, `dropped`, or
`disqualified`) with optional note/change timestamp.
`(season_id, division_id, clan_tag)` is unique. Match facts link this scoped entry,
not just the global team. Administrators may edit the display name and clan tag;
imports therefore reuse entries by stable team, season, and division identity
before comparing mutable tags.

### `players`, `player_friend_codes`, and `player_aliases`

`players` is the global person identity with canonical name, primary friend code,
canonical-name override flag, and creation time. `player_friend_codes` makes each
friend code globally unique and records optional first/last match sightings.
Friend codes and player aliases also record `origin` (`match_import` or `admin`),
so replacement cleanup can distinguish imported observations from deliberately
managed identity records.
`player_aliases` stores typed aliases with first-entry and last-observed timestamps
and optional first/last match sightings; `(player_id, alias_type, alias_value)` is unique. The
`mkc_name`, `mkc_id`, and displaced `canonical_name` types preserve MKCentral
identity and naming history. See
[MKCentral Player Names](../features/mkcentral-player-names.md) for automatic priority and the
review/apply workflow. Administrators can add or remove friend codes from player
details; `player_friend_codes.friend_code` remains globally unique.

### `player_season_entries`

A player's membership on a scoped team entry, including season/division, primary
lounge/Mii names, flag, and first/last match sightings. `(player_id,
team_season_entry_id)` is unique.

## Administration, review, and observability

```mermaid
erDiagram
    admin_users o|--o{ review_submissions : claims_or_reviews
    admin_users o|--o{ source_files : accepts
    review_submissions o|--o{ source_files : produces
    matches o|--o{ review_submissions : accepted_as
    admin_users o|--o{ admin_audit_logs : acts
    admin_users ||--o{ health_issue_reviews : reviews
    admin_users o|--o{ database_addition_logs : attributes
    matches o|--o{ database_addition_logs : attributes
    admin_users o|--o{ mkc_refresh_previews : requests_or_applies
```

`submission_rate_limits` is independent of administrator identity: it keys an
anonymized network identifier and a time window. There is an intentional cycle
between submissions, source files, and accepted matches; the accepted-match
foreign key is added separately during table creation (`use_alter=True`).
That setting does not make the constraint deferrable within a transaction.
The workflows explicitly maintain these links.

### `admin_users`

Administrator identity and access state: Firebase UID, unique normalized email,
owner/admin role, invited/active/revoked status, optional GitHub identity, database
and repository provisioning status, creator, and lifecycle timestamps. All role and
status enumerations have database checks.

### `review_submissions`

Public submission queue metadata. It stores UUID receipt, fingerprint, unique queue
object key, filename/match label/size/validation version, warnings and
acknowledgement, review state/claim/decision, accepted match link, and lifecycle
timestamps. Status is one
of pending, in review, accepted, rejected, expired, or failed. Only one active
submission may use a fingerprint; status/submitted time and fingerprint are indexed.

### `submission_rate_limits`

Network-key/time-window counters for public submissions. The composite primary key
is `(network_key, window_started_at)` and expiration is indexed.

### `database_addition_logs`

Descriptions of accepted additions and edits. Each row has `operation_type`
(`addition` or `edit`), entity type/id, optional match, administrator ID/email,
human summary, JSON details, and timestamp. Playoff format, series, and participant
creation are included. Match replacement/deletion explicitly preserves historical
logs while adjusting match references; the logs are not cascading match-owned facts.

### `health_issue_reviews`

Administrator disposition for a stable database-health issue key. It records open
or dismissed status, note, reviewer, and timestamp.

### `admin_audit_logs`

Security/audit events with optional administrator, action, target type/id, request
ID, JSON details, and timestamp. Action, request ID, and creation time are indexed.

### `mkc_refresh_previews`

A proposed bulk or individual external-name refresh, with UUID `preview_id`,
optional target player, requesting/applying administrator, serialized lookup
results/summary, creation/expiry/decision timestamps, and `pending`, `applied`, or
`rejected` status. These are administrator naming decisions, separate from match
review submissions and their lifecycle.

### Update timestamps and serialized details

Most mutable fact/catalog/operational tables have `last_update_at` maintained by
SQLAlchemy's column default and `onupdate`. This is not a database-wide update
trigger. Creation, observation, and decision timestamps retain their distinct
meanings. Log timestamps describe events, while `SubmissionRateLimit` uses window
and expiry timestamps.

Fields named `*_json` and `matches.raw_json` are stored as text, not PostgreSQL
JSONB. Their owning modules perform serialization and validation; schema checks do
not validate every nested field. Audit `target_type`/`target_id` and addition-log
`entity_type`/`entity_id` describe polymorphic references without foreign keys to
every possible target table.

## Playoff invariants beyond SQL constraints

`backend/playoff_service.py` enforces rules that require reading multiple rows:

- the first playoff upload locks the division format;
- a series' participant set and best-of value cannot change;
- a team cannot enter two semifinal series in one division;
- match numbers are sequential and unique;
- playoff matches cannot tie;
- no match may be added after either team clinches;
- four-team finals contain both semifinal winners;
- three-team finals contain the semifinal winner and a team that did not play in
  that semifinal (the bye team); and
- all configured semifinals must be complete before finals are established.

These checks execute again during the acceptance transaction, not only during UI
preview. Row locking on an existing series prevents concurrent uploads from passing
the same series-state check.

## Match-set analytics contract

The catalog, match history, legacy statistics, and player/team dashboard
interfaces that accept `match_set` use the shared selection below:

| Value | Included matches |
| --- | --- |
| `regular` | `matches.match_type = regular` (default) |
| `playoffs` | `matches.match_type = playoff` |
| `all` | both types |

The shared implementation is `backend/match_sets.py`. Defaulting at the backend
protects existing clients from accidentally mixing playoff and regular-season data.
The newer [track analytics](../../backend/track_analytics.py) queries explicitly
select regular, played matches. [Standings](../../backend/standings_service.py)
calculates regular-season results and returns separate playoff context. Neither
should be documented as a generic match-set query.

Race-derived metrics also apply role rules and the reviewed historical exclusion
registry; a raw source record can remain available for auditing while its corrupt
race block is excluded from analytics. Team-owned missing-player points contribute
to team race totals without being attributed to an invented player.

## Archive and write lifecycle

Accepted match JSON remains the durable source artifact. The route/queue stages
the archive object; the acceptance module
validates the editor document, rechecks entry approvals, imports relational facts
in a transaction, writes addition/audit records, commits, and then promotes the
accepted object. A failed promotion leaves a committed match with repair metadata;
[maintenance](../../backend/phase3_maintenance.py) reconstructs and retries the
canonical archive bytes. SHA-256 and source-path uniqueness make exact
replays idempotent. PostgreSQL is query state, not a replacement for the accepted
JSON archive.

## Migrations and verification

The linear revision chain ends at `20260913_0017`. Each filename below links to
the migration; Alembic's `revision` field is the date/number portion.

| Revision | Change |
| --- | --- |
| [0001](../../backend/migrations/versions/20260719_0001_current_schema.py) | Baseline analytics schema. |
| [0002](../../backend/migrations/versions/20260719_0002_production_state.py) | Administration, queue, archive and audit state. |
| [0003](../../backend/migrations/versions/20260725_0003_runtime_grants.py) | Runtime PostgreSQL privileges. |
| [0004](../../backend/migrations/versions/20260726_0004_team_aliases.py) | Managed team aliases. |
| [0005](../../backend/migrations/versions/20260726_0005_player_canonical_name.py) | Canonical player names. |
| [0006](../../backend/migrations/versions/20260808_0006_playoff_series.py) | Playoff format, series, participants and match metadata. |
| [0007](../../backend/migrations/versions/20260809_0007_team_league_identities.py) | Explicit team league identities. |
| [0008](../../backend/migrations/versions/20260809_0008_track_leagues.py) | League-owned tracks. |
| [0009](../../backend/migrations/versions/20260822_0009_mkc_player_names.py) | MKCentral naming and refresh previews. |
| [0010](../../backend/migrations/versions/20260822_0010_alias_last_observed.py) | Alias observation timestamps. |
| [0011](../../backend/migrations/versions/20260823_0011_team_identity_priority.py) | Automatic/manual canonical team identity priority. |
| [0012](../../backend/migrations/versions/20260823_0012_match_number.py) | Regular match number. |
| [0013](../../backend/migrations/versions/20260830_0013_divisional_standings.py) | Competition status and special result types. |
| [0014](../../backend/migrations/versions/20260830_0014_review_submission_match_label.py) | Review queue match labels. |
| [0015](../../backend/migrations/versions/20260905_0015_match_edit_hardening.py) | Provenance, attribution and update timestamps for match editing. |
| [0016](../../backend/migrations/versions/20260912_0016_division_conferences.py) | Two-conference divisions and entry membership. |
| [0017](../../backend/migrations/versions/20260913_0017_team_entry_logos.py) | Team season entry logo scope. |

Useful checks:

```bash
alembic current
alembic upgrade head
alembic check
.venv/bin/python backend/scripts/inspect_db.py
.venv/bin/python -m unittest discover -s backend -p 'test_*.py'
```

The test suite creates isolated PostgreSQL schemas and may use
`Base.metadata.create_all()` only inside those disposable schemas.

The future production database must be migrated and rebuilt using the same
versioned contracts. Separate database roles/environment configuration and durable
object storage remain necessary even when staging and production initially share
a Cloud SQL instance. Historical SQLite utilities are archived reference material;
the active configuration rejects SQLite. See [ADR 0002](../adr/0002-postgresql-and-durable-json-archive.md)
for the storage decision and [ADR 0004](../adr/0004-administrator-access-and-public-review-queue.md)
for environment/access separation. ADR 0002's original SQLite allowance is
historical; the current runtime does not support SQLite.
