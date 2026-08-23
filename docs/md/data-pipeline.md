# Data Pipeline

## Authoritative Inputs

The repository's historical bootstrap documents live under:

```text
backend/JSON/{league}/{season}/{division}/{match}.json
```

For deployed staging and production, newly submitted match documents do not
create Git commits. PostgreSQL owns normalized/queryable state, and Cloud Storage
owns the durable original bytes:

```text
gs://{environment-archive}/accepted/{league}/{season}/{division}/{match}--{sha256-prefix}.json
```

The 12-character suffix is the beginning of the SHA-256 fingerprint of the exact
canonical JSON bytes. It makes an accepted object content-addressable enough for
human-readable storage paths, prevents two different documents with the same
match label from sharing a key, and lets reconciliation connect the object to the
full fingerprint stored in PostgreSQL. The complete hash, not only the filename
prefix, is verified before promotion.

This separation avoids giving the public API a GitHub write credential and keeps
runtime data durability independent from application deployments. A future
audited export may copy accepted sources elsewhere for backup, but repository
synchronization is not part of the acceptance transaction.

Reviewed registries under `backend/data/` preserve decisions that raw match files
cannot express reliably:

- `player_identities.csv`
- `team_aliases.csv` (historical parser corrections used only during archive rebuilds)
- `analytics_excluded_race_blocks.json`

Database-health reviews now live in `health_issue_reviews`; the historical JSON
file is retained only as legacy evidence until any reviewed entries are explicitly
migrated.

The archived source and registries must be preserved during every rebuild. Live
team aliases are stored in the `team_aliases` database table and managed through
the admin alias page; preview, validation, and editor uploads do not consult the
historical CSV correction manifest.

## Rebuild Flow

```text
archived JSON + reviewed registries
              |
              v
     import_json_to_db.py
              |
              v
 SQLAlchemy operational database
              |
              v
 Flask analytics and dashboard APIs
```

Load the archive into an already migrated PostgreSQL schema from `backend/`:

```bash
../.venv/bin/python import_json_to_db.py
```

The importer prefers `.json` over a same-stem legacy `.txt`, fingerprints source
files, resolves identities, applies historical team parsing corrections plus
database aliases, stores raw audit fields, expands races and results, preserves
explicit roles, and records findings that require review.

## Editor And Review Flow

1. The browser compiles deterministic scores, totals, and canonical JSON.
2. The preview endpoint validates the document and proposes new catalog entries.
   For a valid league/season/division/team scope, the editor can load the existing
   `player_season_entries` roster and prefill a lineup from its stored names, flag,
   and the player's most recently seen friend code.
3. An anonymous user can submit the canonical bytes to temporary queue storage;
   this does not call the importer or change analytics.
4. An authenticated admin claims, edits if necessary, and approves new catalog
   entries in the existing editor. The first season for a league requires separate
   league and season approvals. If a team tag exists only in another league, the
   admin must explicitly link the new league identity to that global team or choose
   to create an entirely separate team entity. An unknown friend code can either
   create a new player or be explicitly mapped to an existing player found by
   canonical name or player ID. For a genuinely new player, validation also reports
   whether the friend code resolves to an MKCentral profile and its current name.
   Selected identity decisions and MKCentral results are revalidated during acceptance.
5. The acceptance service repeats validation and duplicate checks, commits all
   normalized rows and audit records in PostgreSQL, then promotes the exact bytes
   into the immutable accepted archive.
6. Analytics can query the committed match immediately. Interrupted storage
   promotion is marked `repair_required` and maintenance repairs it idempotently.

When a reviewed friend code is mapped to an existing player, the importer adds the
friend-code and name aliases to that player. It reuses an existing
`player_season_entries` row for the same team-season entry, or creates one when the
player has not previously appeared in that scope. It never creates a second player
or duplicate player-season/team record for an approved link.

An approved new player with a resolved MKCentral profile receives `mkc_name` and
`mkc_id` aliases and normally uses that name as the initial canonical name. A
shared MKCentral name falls back to the player's lounge name. A successful empty
MKCentral response is reported as no profile; transport and service failures are
reported separately. Bulk and individual synchronization are documented in
[MKCentral Player Names](mkcentral-player-names.md).

An approved cross-league team link creates a `team_league_identities` row for the
new league and reuses the existing `teams` row. Match analytics remain scoped by
league, season, and division. Choosing the separate-team action instead creates a
new global `teams` row even though another league uses the same tag.

## Regression Checks

The Phase 0 evidence contains table counts, archive and registry fingerprints, 17
API fixtures, identity comparisons, and UI screenshots. The retired capture and
comparison sources are preserved in `docs/archive/sqlite-retired/`; the active CI
suite verifies behavior directly on PostgreSQL. Never replace approved evidence
merely to make a changed response pass.

The old flattened `backend/CSV/` analytics pipeline was removed in Phase 1 after
tests and every API fixture matched the SQL-backed implementation.
