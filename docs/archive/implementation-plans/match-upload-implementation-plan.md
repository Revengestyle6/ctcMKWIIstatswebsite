# Match Upload And JSON Archive Implementation Plan

## Objective

A confirmed editor upload must create two durable representations of the same
compiled match:

1. A canonical JSON source file in the match archive.
2. The normalized database records used by analytics and Match History.

The upload succeeds only when both representations correspond to the same JSON
bytes and all server-side validation and new-entry approvals pass.

## Implementation Status

Implemented:

- canonical UTF-8 JSON serialization and SHA-256 preview fingerprints
- safe league/season/division archive paths and generated filenames
- rollback-only preview metadata containing the expected archive destination
- server-side validation and approval rechecks at commit time
- `POST /api/matches/commit` with staged file publishing and one SQL transaction
- exact-retry idempotency plus source-path and room-reference duplicate checks
- automatic directory creation without overwriting an existing archive file
- committed database-addition audit rows, history API, and SSE stream
- archive/database reconciliation command
- a Validation-section `Review & Upload` entry point, followed by Discard
  Preview and Confirm Upload controls
- local-only write/log access by default, with optional bearer-token access via
  `MATCH_UPLOAD_TOKEN`

Still required before public production use:

- application user accounts and session-based authorization
- a shared persistent archive or storage adapter for multiple app instances
- an audited replacement/removal workflow for correcting committed matches
- a post-ingestion Git commit or pull-request job if archived JSON must be
  pushed automatically to a remote repository

## Archive Layout

Continue the existing directory convention:

```text
backend/JSON/{league}/{season}/{division}/{filename}.json
```

For example:

```text
backend/JSON/ctc/s3/d2/W1 sts Starfall.json
```

The uploader creates missing league, season, and division directories with
`mkdir(parents=True, exist_ok=True)`. Path components must be normalized codes
validated by the server, not arbitrary client paths. Reject absolute paths,
`..`, path separators, control characters, and empty components.

The default filename should be generated from the week and match label. Remove
filesystem-unsafe characters, retain useful team tags where possible, and use a
stable fallback such as `match-{content_hash_prefix}.json`. Never overwrite an
existing file automatically. An existing path with identical content is a
duplicate; an existing path with different content is a conflict requiring a
new filename or an explicit replacement workflow.

Write the exact compiled JSON that was validated and imported, using UTF-8,
two-space indentation, `ensure_ascii=False`, and one trailing newline. Compute
`source_files.file_sha256` from those exact bytes and store the archive-relative
path in `source_files.source_path`.

## Confirmation API

Add an authenticated endpoint:

```http
POST /api/matches/commit
```

Request body:

```json
{
  "match": {},
  "approved_new_entries": [],
  "expected_preview_fingerprint": "sha256-of-compiled-match"
}
```

The preview response should include the same fingerprint. The commit endpoint
recompiles or canonically serializes the submitted match and rejects it if the
fingerprint changed after preview. It must also redetect new entries and require
the complete current approval set, just as the preview endpoint does.

On success, return:

- committed `match_id`
- archive-relative JSON path and SHA-256
- created season/division/team/player/track records
- reused identities and teams
- final import status and review notes
- a URL for the committed Match History page

## Coordinating Database And Filesystem Writes

A SQL transaction cannot atomically commit a filesystem or Git operation. Use
a staged workflow and make every intermediate state recoverable:

1. Canonically serialize the compiled match and compute its SHA-256.
2. Reject duplicate file hashes, archive paths, and match signatures.
3. Write and `fsync` a uniquely named temporary file on the same filesystem as
   the JSON archive.
4. Begin one database transaction.
5. Redetect approvals, run all validation, and import through the normal shared
   importer using the final archive path and exact file hash.
6. Flush and serialize the newly imported match to verify it is readable.
7. Publish the staged file with an atomic no-overwrite operation. On the local
   same-filesystem archive, an exclusive hard-link publish is one practical
   implementation; it must fail cleanly if the destination appeared after the
   duplicate check. Do not use `os.replace`, which could overwrite a concurrent
   upload.
8. Commit the database transaction.
9. If any ordinary error occurs before commit, roll back the database and remove
   the staged or newly moved file.

A process can still crash between the file move and database commit. Add a
reconciliation command that reports archive files without `source_files` rows,
database source rows whose files are missing, and hash mismatches. Run it at
startup in development and as a scheduled production check. Never silently
delete a mismatch.

For a production deployment with multiple app instances, do not rely on an
instance-local checkout. Put the JSON archive on a shared persistent volume or
behind a storage adapter. If the repository itself must receive each JSON,
perform the Git commit or pull request as an audited post-ingestion job; a Git
provider cannot participate in the database transaction.

## Duplicate Protection

Check all of the following before writing:

- identical canonical JSON SHA-256
- identical final archive path
- same external room/table references when present
- an existing `source_files` row for the selected archive path

Exact duplicates should return the existing `match_id`. Conflicting matches
should block commit and show links to the existing match and source file.
Week is required, but it is not a uniqueness boundary: multiple matches,
including repeat team pairings, may be uploaded within the same week.

## Editor Confirmation Flow

After a successful preview, show a confirmation panel containing:

- final teams, score, season, division, week, and race count
- archive destination path
- every new database record that will be created
- every existing team/player identity that will be reused
- warnings and review notes
- `Discard preview` and `Confirm upload` actions

`Discard preview` only clears client preview state because preview has already
rolled back. `Confirm upload` sends the compiled match, current approvals, and
preview fingerprint to the commit endpoint. Disable it whenever the editor has
changed since preview.

The workflow begins with `Review & Upload` beside the Validation status rather
than a generic preview button in the page header. It is disabled while any red
validation errors remain. Unknown catalog values that can be handled by the
approval dialog are amber warnings and therefore do not deadlock this action.

After commit, replace the confirmation controls with the committed match ID,
archive path, and a link to Match History. A committed upload must not expose a
general-purpose rollback button; corrections should use a separate audited
replace/remove workflow so existing analytics are not deleted accidentally.

## Recommended Next Implementation

Implement the permanent upload in this order:

1. Extract canonical JSON serialization, fingerprints, archive path generation,
   and safe filename validation into tested backend helpers.
2. Add duplicate-match detection and database constraints/indexes needed to
   enforce it under concurrent requests.
3. Refactor preview and commit to share one server-side validation and approval
   function so their behavior cannot drift.
4. Add the staged archive writer and reconciliation command, tested with forced
   failures before move, after move, and before database commit.
5. Add `POST /api/matches/commit` with an atomic database transaction and an
   idempotency key so retries cannot create a second match.
6. Add the editor confirmation panel, stale-preview detection, success summary,
   and Match History link.
7. Add authentication, authorization, upload-size limits, audit records, and
   production storage configuration before enabling the endpoint publicly.

These upload foundations and the Confirm Upload button are now implemented.
The next recommended work is session-based admin authentication, followed by a
safe correction workflow that can replace or remove a committed match with an
audit trail. Production deployment should then configure shared persistent
archive storage and an optional Git synchronization job.

## Database Addition Stream

Every successful editor commit records additions in
`database_addition_logs` inside the same transaction as the match. Events cover
catalog and audit entities such as seasons, divisions, source files, teams,
team season entries, players, friend codes, aliases, player season entries,
tracks, and the match itself. Previewed or failed uploads generate no events.

Endpoints:

```http
GET /api/database-additions?limit=100
GET /api/database-additions/stream?after_id=123
```

The stream uses Server-Sent Events with event name `addition`, persistent event
IDs, reconnect support, and keep-alive comments. The JSON editor displays the
latest 100 events. Like permanent upload, these endpoints allow loopback access
by default and otherwise require configured authentication.
