# Database Reference

Last verified against `backend/models.py` and Alembic revision
`20260808_0006` on August 8, 2026.

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

```text
Season
└── Division
    ├── DivisionPlayoffConfig
    ├── TeamSeasonEntry ── Team ── TeamAlias / TeamLogo
    │   └── PlayerSeasonEntry ── Player ── FriendCode / PlayerAlias
    ├── PlayoffSeries ── PlayoffSeriesParticipant ── Team
    └── SourceFile ── Match ── MatchTeam ── MatchPlayer
                    │       └── Penalty
                    ├── MatchTableRef
                    └── Race ── Track / TrackAlias
                             ├── RacePlayerResult
                             └── RaceTeamResult

AdminUser ── ReviewSubmission / HealthIssueReview / AdminAuditLog
SubmissionRateLimit
DatabaseAdditionLog ── optional Match
```

## Competition catalog

### `seasons`

One row per league season. Columns: `season_id` primary key, `league_code`,
`season_code`, optional numeric `season_number`, display `name`, `status`, optional
`starts_on` and `ends_on`, and `created_at`. `(league_code, season_code)` is unique.

### `divisions`

A season-owned division. Columns: `division_id`, `season_id`, `division_code`, and
`division_name`. `(season_id, division_code)` is unique. A division, rather than a
season, owns its playoff format because formats may differ within one season.

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
indexed. Finals use series number 1; that convention is enforced in the service.

### `playoff_series_participants`

The two immutable team slots in a series. Columns:
`playoff_series_participant_id`, `playoff_series_id`, global `team_id`, and
`participant_slot` (1 or 2). A team and a slot may each occur only once per series.
Cross-series semifinal eligibility is enforced transactionally by the importer.

## Source and match facts

### `source_files`

One accepted archive document. It records season/division scope, unique source path,
unique SHA-256 fingerprint, filename, JSON shape, storage provider and object key,
archive state/generation/attempts/error, accepting administrator, optional review
submission, and import/archive timestamps. Storage provider is `local` or `gcs`;
archive status is `pending`, `complete`, or `repair_required`.

### `matches`

One independently scored match. Core columns are `match_id`, season/division/source
foreign keys, source-array index, label/title/format, races played, canonical raw
JSON, import status/review notes, and creation time.

Competition metadata is exclusive:

- A regular match has `match_type = regular`, no playoff series, no series match
  number, and normally a positive `week_number`. The database permits a null week
  for legacy/repair records; new editor uploads require one.
- A playoff match has `match_type = playoff`, a null week, a required
  `playoff_series_id`, and a positive `series_match_number`.

`(source_file_id, match_index_in_source)` and
`(playoff_series_id, series_match_number)` are unique. Import status is `imported`
or `needs_review`; `match_type` is indexed.

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

`tracks` stores a unique canonical name and creation time. `track_aliases` links
alternate values to a track; `(track_id, alias_value)` is unique. Editor detection
checks both canonical names and aliases case-insensitively.

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

### `teams`, `team_aliases`, and `team_logos`

`teams` is the global identity (`team_id`, unique canonical tag, canonical name,
created time). `team_aliases` maps a globally unique alternate tag to a team.
`team_logos` stores prioritized, active assets that may be global or season-specific;
`(team_id, season_id, asset_path)` is unique. Repository-managed records use paths
under `images/team-logos/`. Admin uploads use content-addressed object keys under
`team-logos/{team_id}/` and are served through the public team-logo content API.
Uploading a replacement deactivates the previous logo only in the same team/season
scope, preserving inactive history and every other season.

### `team_season_entries`

A global team's season/division membership with display name, clan tag, and color.
`(season_id, division_id, clan_tag)` is unique. Match facts link this scoped entry,
not just the global team. Administrators may edit the display name and clan tag;
imports therefore reuse entries by stable team, season, and division identity
before comparing mutable tags.

### `players`, `player_friend_codes`, and `player_aliases`

`players` is the global person identity with canonical name, primary friend code,
and creation time. `player_friend_codes` makes each friend code globally unique and
records optional first/last match sightings. `player_aliases` stores typed aliases
with first/last match sightings; `(player_id, alias_type, alias_value)` is unique.

### `player_season_entries`

A player's membership on a scoped team entry, including season/division, primary
lounge/Mii names, flag, and first/last match sightings. `(player_id,
team_season_entry_id)` is unique.

## Administration, review, and observability

### `admin_users`

Administrator identity and access state: Firebase UID, unique normalized email,
owner/admin role, invited/active/revoked status, optional GitHub identity, database
and repository provisioning status, creator, and lifecycle timestamps. All role and
status enumerations have database checks.

### `review_submissions`

Public submission queue metadata. It stores UUID receipt, fingerprint, unique queue
object key, filename/size/validation version, warnings and acknowledgement, review
state/claim/decision, accepted match link, and lifecycle timestamps. Status is one
of pending, in review, accepted, rejected, expired, or failed. Only one active
submission may use a fingerprint; status/submitted time and fingerprint are indexed.

### `submission_rate_limits`

Network-key/time-window counters for public submissions. The composite primary key
is `(network_key, window_started_at)` and expiration is indexed.

### `database_addition_logs`

Append-only descriptions of entities created during accepted imports. Each row has
entity type/id, optional match, human summary, JSON details, and timestamp. Playoff
format, series, and participant creation are included.

### `health_issue_reviews`

Administrator disposition for a stable database-health issue key. It records open
or dismissed status, note, reviewer, and timestamp.

### `admin_audit_logs`

Security/audit events with optional administrator, action, target type/id, request
ID, JSON details, and timestamp. Action, request ID, and creation time are indexed.

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

Every match-derived public statistics endpoint accepts `match_set`:

| Value | Included matches |
| --- | --- |
| `regular` | `matches.match_type = regular` (default) |
| `playoffs` | `matches.match_type = playoff` |
| `all` | both types |

The shared implementation is `backend/match_sets.py`. Defaulting at the backend
protects existing clients from accidentally mixing playoff and regular-season data.

## Archive and write lifecycle

Accepted match JSON remains the durable source artifact. The acceptance service
validates the editor document, detects additions requiring approval, stages the
archive object, imports relational facts in a transaction, writes addition/audit
records, and finalizes archive state. SHA-256 and source-path uniqueness make exact
replays idempotent. PostgreSQL is query state, not a replacement for the accepted
JSON archive.

## Migrations and verification

Current linear revisions are:

1. `20260719_0001_current_schema` — baseline analytics schema.
2. `20260719_0002_production_state` — admin, review, archive, and audit state.
3. `20260725_0003_runtime_grants` — runtime PostgreSQL privileges.
4. `20260726_0004_team_aliases` — managed team aliases.
5. `20260726_0005_player_canonical_name` — player canonical naming.
6. `20260808_0006_playoff_series` — division formats, series, participants, and
   match competition metadata.

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
