# Database Health Dashboard

## Purpose

The Database Health dashboard provides one place to monitor the
PostgreSQL analytics database, its JSON source archive, recent committed additions,
and records that deserve manual review.

The statistics checks are diagnostic. Similar names and alias collisions are
evidence for a reviewer, not permission to merge or rewrite records. The only
write available from this page records a review decision; it never changes a
track, player, match, race, or result.

## Route And API

- Frontend route: `/database-health`
- Backend endpoint: `GET /api/database-health`
- Review endpoint: `POST /api/database-health/reviews`
- Optional query: `include_archive=0` skips filesystem reconciliation.
- Server responses are cached for 30 seconds because archive hashing and fuzzy
  catalog comparisons are more expensive than ordinary analytics queries.

The home page links to the dashboard.

Review writes use the same local-or-bearer-token authorization as match
uploads. A dismissal includes an issue key, `dismissed` status, and required
reason. Restoring a finding writes `open` status.

## Implemented Dashboard Sections

### Health Summary

The summary reports:

- overall status: `healthy`, `warning`, or `critical`;
- total critical, warning, and informational findings;
- total records across application tables;
- matches marked `needs_review`;
- total durable addition events; and
- report generation time.

A critical finding makes the overall status critical. With no critical
findings, any warning makes it warning. Informational findings alone do not
degrade the overall status.

### Database Integrity

The card reports the engine, version, connection status,
database name, schema revision, database size, latest import, and latest durable
addition. Engine-specific checks are deliberately explicit:

- PostgreSQL obtains its real database size with
  `pg_database_size(current_database())` and inspects every application-schema
  foreign-key constraint in `pg_constraint`. Any unvalidated constraint is a
  critical finding.
- PostgreSQL physical table/index corruption scanning is shown as `Not Run`.
  It is not falsely reported as healthy and is not executed during an interactive
  dashboard refresh.

After Cloud SQL deployment, scheduled maintenance will run `amcheck`/`pg_amcheck`
with an appropriately privileged maintenance identity. The dashboard should show
the last completed scan time and result rather than launch that potentially
expensive operation from a web request.

### Record Counts

Every SQLAlchemy application table is counted. The UI groups counts into:

- competition metadata;
- player identity;
- matches;
- races and results; and
- audit records.

These are current counts, not historical trends. Count history requires the
snapshot work described under Next Steps.

### Addition Feed

The latest 100 `database_addition_logs` rows are returned with:

- commit timestamp;
- entity type and ID;
- match ID responsible for the addition;
- human-readable summary; and
- structured details in the API response.

The dashboard can filter the feed by entity type and shows lifetime totals per
logged entity type.

Addition timestamps have an important limitation: durable addition logs are
created for confirmed editor uploads. They do not reconstruct the historical
date on which every row from an archive rebuild originally entered the project.
Likewise, timestamps created during a rebuild describe that rebuild, not the
original match publication date.

### Issue Queue

Issue groups are filterable by severity, category, and text. Expanding an issue
shows example entity IDs and labels. Response payloads cap displayed examples
while retaining the full issue count.

Dismissed findings are excluded from the overall health status and warning
total. The issue-status toggle defaults to **Active**; switching it to
**Dismissed** shows the saved reason, reviewer, timestamp, and restore control.

Each expanded issue can be copied as structured JSON for investigation by an
LLM or another developer. The payload includes the stable issue key, source
report timestamp and health status, severity, category, details, review state,
available example entities, and an explicit flag when the API capped those
examples.

**Generate filtered report** downloads an LLM-ready Markdown file containing
only the issue groups visible under the selected severity, category, text, and
dismissal filters. The report records those filters, whether archive checks
were enabled, and embeds the structured JSON payload for every included issue.
It is generated entirely in the browser and does not alter the database or
source archive.

Implemented checks include:

#### Database And Relations

- foreign-key violations; and
- unvalidated PostgreSQL foreign-key constraints; and
- database/archive synchronization problems.

#### JSON Archive

The existing `match_upload.reconcile_archive()` logic checks for:

- source files recorded in the database but missing from disk;
- archive contents whose SHA-256 hash differs from `source_files`; and
- JSON/text archive files that are not represented in the database.

#### Tracks

- canonical names that normalize to the same case/spacing/punctuation form;
- high-similarity canonical track names that may be typos or missing aliases.

Fuzzy matching uses Unicode normalization and a conservative similarity
threshold. Results are warnings only and must be reviewed manually.

#### Players

- duplicate normalized canonical lounge names; and
- aliases of the same type and value that map to multiple player IDs within the
  same season/division. Findings identify whether the collision is a Mii name,
  lounge name, table name, or another stored alias type.

Collision scope comes from the raw alias on each `match_players` appearance and
the season/division of that actual match. Global `player_aliases` records are
not joined to every historical player season, which prevents a later alias from
being projected backward into seasons where it was never used.

Alias collisions are not automatic merge candidates. Clan tags, decorative Mii
names, shared display names, and legitimate name reuse can all create harmless
collisions. Friend codes and match history remain the primary review evidence.

#### Matches And Results

- matches that do not resolve to exactly two teams;
- stored race counts that disagree with `matches.races_played`;
- duplicate placements within one race;
- scores outside 0–15 or placements outside 1–12;
- inferred roles that disagree with the placement rule;
- matches marked `needs_review`; and
- scored results without placements, shown informationally because disconnect
  points can make this valid.

Result findings include the match label, race number, player, score, and/or
placement where applicable so the corresponding source JSON can be located
without querying several tables manually.

## Investigating And Resolving Findings

Use the following workflow for each active finding:

1. Expand the issue and note its entity IDs, match label, race, player, and raw
   values.
2. Decide whether the rule is a hard invariant or a review suggestion.
3. For match/result findings, locate the match through `source_files` or its
   archived JSON filename and compare the raw table data with the imported row.
4. Correct the durable source JSON or identity/alias configuration rather than
   patching generated analytics rows directly.
5. Re-import, run the relevant tests, and refresh the dashboard. A
   hard finding clears automatically when its source is corrected.
6. If a judgment-based warning is confirmed harmless, dismiss it with a concise
   reason rather than changing the similarity threshold for every record.

Recommended handling by finding type:

| Finding | Investigation | Resolution |
| --- | --- | --- |
| Invalid score/placement | Open the named match and race in its source JSON; verify whether a race score was confused with a GP or match total. | Correct the source when evidence exists. Reviewed, unrecoverable legacy blocks belong in the analytics exclusion registry. It cannot be dismissed. |
| Duplicate race placement | Compare all players in the named race, including disconnect/substitution fields. | Correct the source table or importer mapping. It cannot be dismissed. |
| Inferred-role mismatch | Check explicit role, placement, and `role_source`. | Correct source role data or rerun the role repair/import. It cannot be dismissed. |
| Similar tracks | Compare full names, console prefix, course number, aliases, and race history. | Register an alias/rename a typo, or dismiss that exact pair if both are real tracks. |
| Duplicate canonical player | Compare friend codes, aliases, seasons, teams, and match history. | Merge identities through the reviewed identity workflow, or dismiss if distinct people legitimately share a name. |
| Player alias collision | Check friend codes and whether the Mii/display name was reused in the same season/division. | Correct identity mapping, or dismiss that scoped collision with a reason. |
| Archive mismatch | Compare `source_files.source_path` and SHA-256 with the file on disk. | Restore the expected file or re-import the intended archive content. It cannot be dismissed. |

Invalid values outside the reviewed exclusion registry remain critical. The
known legacy aggregate-score rows are warnings because their complete blocks
are prevented from reaching race-derived analytics.

### Current High-Score Investigation

The 30 invalid score rows trace to seven aggregate-bearing race slots:

- `W8 6c O`, race 9;
- `W9 u vf`, race 9;
- `W5 Sf2 xv`, race 9;
- `W3 Cy Mi2`, races 1, 5, and 9; and
- `W9 vf Mi2`, race 9.

This is present in the archived source JSON, not introduced by the health
query. For example, `JSON/ctc/s1/d1_2/W8 6c O.json` stores GP totals such
as 34, 32, and 18 in the ninth entries of `race_scores`, followed by zero
placeholders, while `race_positions` still contains individual placements.
The importer faithfully copied those invalid per-race values.

The surrounding zero/unknown rows are also unreliable. Eighteen collapsed
aggregate values happen to fall at or below 15, so checking only the 30 invalid
values would not isolate the full corruption.

### Analytics Exclusion Policy

Reviewed exclusions are stored in
`backend/data/analytics_excluded_race_blocks.json`. The registry identifies a
source path, match index, one-based four-race block numbers, and a reason. It is
version-controlled and survives database rebuilds without altering the raw
JSON or PostgreSQL records.

The current registry excludes 26 races:

- `W8 6c O`: races 9–12;
- `W9 u vf`: races 9–12;
- `W5 Sf2 xv`: races 9–10, bounded by its declared 10-race match;
- `W3 Cy Mi2`: races 1–12; and
- `W9 vf Mi2`: races 9–12.

Excluded races do not contribute to:

- player overview, performance, role, pace, or track metrics;
- player and team rankings derived from race rows;
- team roster race metrics and bagger counterpart metrics;
- team-by-track scores, wins, or race counts; or
- legacy player, team, and track race averages.

Raw match detail and history still return the original scores and placements
for audit. Published match-level team totals and win/loss records remain
available because the defect affects the distribution across races, not the
published match total.

The health report labels invalid rows inside a registered block as mitigated
warnings. Any impossible result outside the registry remains a critical error,
so future unrelated corruption cannot be silently excluded.

## Review Decisions And Dismissals

Only judgment-based catalog checks are dismissible. Foreign-key failures,
archive mismatches, and impossible match/result values
must be corrected at their source. This prevents a dismissal from hiding future
data corruption.

Historical review decisions are seeded from
`backend/data/database_health_reviews.json`; active decisions are stored in PostgreSQL. They are:

- version-controlled and shareable with collaborators;
- preserved independently from archive re-imports;
- keyed to a specific normalized pair or scoped collision; and
- auditable through its reason, reviewer label, and timestamp.

`GBA Bowser Castle 2` and `GBA Bowser Castle 4` are pre-reviewed as distinct
tracks. Their pair remains available under **Show dismissed**, but it no longer
contributes to the warning count. A different Bowser Castle typo would receive
a different key and still be reported.

## Operational And Security Notes

- The dashboard only writes review metadata after explicit local/authenticated
  action; it never modifies statistics records.
- Health checks run inside ordinary short-lived database sessions.
- The frontend does not calculate data-quality rules; backend and future CLI
  tooling should consume the same `database_health.py` definitions.
- Archive checks read and hash source files, so they can be disabled from the UI
  for a faster database-only refresh.
- Before corrective actions are added, the dashboard should be placed behind
  administrator authentication in any deployment where database metadata or
  player identity details should not be public.

## Potential Next Steps

### 1. Expand Issue State

The version-controlled registry now persists dismissals. A future
`database_health_issues` table could additionally contain:

- stable issue fingerprint/check key;
- severity and category;
- entity type and ID;
- first-seen and last-seen timestamps;
- status: open, acknowledged, ignored, or resolved;
- reviewer identity and notes; and
- resolution timestamp.

This would support richer multi-user assignment and resolution history while
the registry remains the rebuild-safe source for accepted false positives.

### 2. Store Count Snapshots

Add a small `database_count_snapshots` table populated after each confirmed
upload and rebuild. This enables:

- change since the previous import;
- daily and weekly growth;
- unexpected row-count drops;
- charts by table; and
- per-upload row deltas.

### 3. Add Per-Upload Batch Metrics

High-volume child rows should not each generate an activity event. Record one
upload summary with counts such as:

```text
2 match teams
10 match players
12 races
120 race-player results
1 penalty
```

This complements the catalog-oriented addition log without flooding it.

### 4. Expand Consistency Checks

Useful next checks include:

- player totals versus valid race-score sums;
- team totals versus players, team-result points, and penalties;
- placement-to-score mapping based on actual race participant count;
- expected result count based on match format and substitutions;
- duplicate room/table references across matches;
- teams with no matches and tracks with no races;
- missing or suspicious canonical player identities;
- aliases attached to multiple canonical tracks;
- raw team tags that closely resemble existing teams; and
- role coverage trends and unknown-role hotspots.

Each check must distinguish hard invariants from reviewable historical data so
legitimate disconnects and incomplete archives do not become false critical
errors.

### 5. Add Safe Review Actions

After authentication and issue persistence exist, add audited workflows for:

- registering a track alias;
- updating a canonical track name;
- adding a reviewed player identity mapping;
- registering team aliases;
- resolving match review notes; and
- rerunning a specific check.

Never auto-merge fuzzy matches. Every corrective action should preview affected
rows, require confirmation, update the JSON/source-of-truth workflow where
appropriate, and write an audit event.

### 6. Background And Deployment Monitoring

- Run comprehensive health checks after uploads and scheduled rebuilds.
- Cache the most recent report rather than hashing the archive per viewer.
- Alert on new critical findings or archive hash mismatches.
- Record schema/application version, last successful backup, WAL size, and last
  successful rebuild.
- Add endpoint latency and failed-query monitoring separately from data health.

### 7. Additional Export Formats And Drill-Down

- Add whole-queue JSON and CSV formats alongside the current filtered Markdown
  report.
- Link player issues to Player Dashboard and match issues to Match History.
- Provide focused track/player/team review pages with aliases, friend codes,
  appearances, and source matches side by side.

## Testing Strategy

Backend unit tests should seed small in-memory databases and verify each check
independently, including clean control cases. API tests should verify report
serialization and archive-check options. Frontend validation should include the
production TypeScript build plus browser-level tests for filters, refresh,
empty states, and issue expansion.
