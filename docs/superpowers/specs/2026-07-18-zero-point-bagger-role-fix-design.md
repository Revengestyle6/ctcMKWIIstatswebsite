# Zero-Point Bagger Role Fix Design

## Problem

The JSON importer currently infers a bagger only when a player scores exactly
one point. A valid ten-player race awards zero points for tenth place, so a
bagger finishing tenth is incorrectly persisted as an inferred runner.

Analytics treat stored runner and bagger roles as authoritative. The bad
stored role therefore moves zero-point bagger races into runner statistics
across player dashboards, team rosters, track rankings, and legacy player
analytics. A bagger page shows the player's one-point races but omits their
zero-point races.

## Approved Behavior

For automatically inferred roles with both a valid score and placement:

- placements 1 through 8 are runners;
- placements 9 and 10 are baggers;
- missing or invalid score or placement data remains unknown; and
- an explicit `race_roles` value remains authoritative and is never
  overwritten by automatic inference or repair.

Consequently, both ninth-place/one-point and tenth-place/zero-point results
appear in bagger analytics. Zero is a valid scored bagger race and continues
to contribute to `zero_points` and `zero_point_rate`.

## Implementation Design

### Import-time inference

Update the importer's role inference helper to classify by placement rather
than treating a score of one as the only bagger signal. The helper will retain
its existing requirement that both score and placement be present, validate
the expected race result ranges, and return unknown for incomplete or invalid
inputs.

The manual-role branch in `import_match` remains unchanged, so source data
that explicitly identifies a runner or bagger still wins over inference.

### Existing-data repair

Add an explicit, idempotent importer maintenance command for the current
SQLite database. The repair updates a row from runner to bagger only when all
of the following are true:

- `role = 'runner'`;
- `role_source = 'inferred'`;
- `score = 0`; and
- `position = 10`.

The command does not modify manual roles, unknown rows, one-point bagger rows,
or any other result. It runs in one transaction, prints the number of updated
rows, and rolls back on failure. Re-running it updates zero rows after the
first successful repair.

The repair will be exposed as a dedicated CLI option on
`backend/import_json_to_db.py` rather than run implicitly during every normal
import. The normal import and destructive `--rebuild` workflows remain
unchanged.

### Analytics and frontend

No frontend or endpoint-specific workaround is needed. The affected analytics
already consume the shared stored/classified role and already count a score of
zero as a valid bagger result. Correcting import-time and existing stored data
therefore fixes every current role-aware consumer consistently.

## Error Handling and Safety

- The maintenance command initializes/checks the existing schema using the
  project's normal database setup before running.
- The update predicate is deliberately narrow and includes `role_source` so
  manually assigned runner rows cannot be changed.
- The command reports its target database and affected-row count.
- Database errors fail the command without committing a partial repair.
- The repair option is mutually exclusive with import/rebuild actions to keep
  operator intent unambiguous.

## Testing

Importer unit tests will cover:

- ninth place with one point infers bagger;
- tenth place with zero points infers bagger;
- placements 1 through 8 infer runner;
- missing and invalid score/placement combinations remain unknown; and
- manual roles continue to override inferred roles during import.

Backfill tests will use a temporary SQLite database and verify that:

- only inferred runner rows with score zero and position ten are repaired;
- manual runner rows and nonmatching inferred rows are untouched;
- the reported update count is correct; and
- a second run makes no changes.

Analytics regression coverage will verify that a player's zero-point race is
included in bagger races and zero-point metrics and excluded from runner
metrics after correct classification.

## Acceptance Criteria

- Newly imported tenth-place/zero-point results are stored as inferred bagger
  rows.
- Existing affected inferred rows can be repaired without a full database
  rebuild.
- A bagger's dashboard includes both one-point and zero-point bagger races.
- The same corrected separation is visible in every role-aware backend view.
- Manual roles and unrelated database rows are unchanged.
