# Replacing rollback-based JSON editor previews

Investigation date: November 15, 2026. Research only: no application code,
configuration, tests, migrations, infrastructure, or database records changed.
This report combines independent validation and renderer audits of the current
source with the earlier live timing checks and PostgreSQL's primary documentation.
No implementation of the proposed preview was benchmarked.

## Decision

A JSON-derived table is a sound direction. The preferred target is **compiled
editor JSON plus resolved reference data → the existing table renderers**, with a
**shared read-only server preflight** for authoritative validation and the existing
atomic importer/acceptance process at save. A second independent table or a second
complete rules engine in TypeScript is unnecessary and undesirable.

The literal combination of raw-JSON-only rendering, instant authoritative
validation, and every current database-derived detail is not achievable: names,
identity relationships, catalogs, scheduling, and current edit state are not all
contained in the document. The table can appear immediately once the needed
lookup context is present; current-data validation still needs server reads.
The normal known-player lookup phase measured 0.33–0.84 seconds, while the current
preview phase measured about 34–35 seconds. Those figures establish the current
experience, not the proposed design's performance.
[Live measurements](2026-11-15-live-preview-timings.md).

Removing preview writes does not inherently weaken final acceptance: upload
already revalidates and performs the real import independently. It does remove
an early rehearsal of ORM/database writes. Equivalent semantic checks can be
shared with read-only preflight, but a no-write path cannot literally execute
insertion/flush constraints before save. Persistence failures must remain atomic
and visible at save. This distinction must be explicit if “same validations” is
an absolute requirement.

I would stop making the temporary import a prerequisite for displaying a normal
new-match table. I would **not** approve a blanket deletion of the dry-run paths
with a browser-only replacement. Existing-match edits need a separate migration
because they currently project provenance, inventories, and references by
actually replacing rows temporarily. Keep those dry runs until equivalent
planning and exclusion-aware validation are demonstrated.

The lower-cost alternative remains credible: profile and batch repeated importer
queries while retaining rollback. This can improve both preview and real upload,
whereas local table rendering alone leaves actual save cost. There is a concrete
repeated global-player name-query pattern to measure before justifying a large
rewrite solely for performance. No stage profile currently proves that ROLLBACK
itself, rather than the import/readback work, accounts for the measured latency.

## Why rollback was chosen

The original restructuring plan explicitly chose the normal importer and ordinary
match-detail serializer in one session so the editor and Match History could use
the exact same Traditional and Vertical renderers. It also required rollback of
shared player/team/alias/provenance changes and independent atomic final ingestion.
That design minimized separate implementations of what imported data looks like.
This is documented rationale, rather than a claim about an author's unstated intent.
[Original plan](../../archive/implementation-plans/json-editor-restructure-plan.md#transactional-table-preview).
Current behavior is authoritative where that older plan differs from the code.

The new-match flow is: parse → placement/award drafts → compile current upload
JSON → local validation and lookups → entry approvals → canonical document and
committable validation → temporary full import and flush → ordinary match-detail
query → rollback → existing tables. Final upload independently performs validation,
identity/approval resolution, duplicate/conflict handling, import/flush, real commit,
and accepted-archive promotion.
[Preview route](../../../backend/routes/admin.py:1090),
[preview importer](../../../backend/import_json_to_db.py:1152),
[final acceptance](../../../backend/acceptance_service.py:74).

The strengths were real importer reuse, early ORM/database constraint failures,
projection of proposed new identities and alias effects, and an ordinary
match-detail result for existing renderers. The preview is still not a reservation
or guarantee of later acceptance: database state can change after rollback, and
real source conflicts, queue ownership, commit, and archive behavior are checked
elsewhere. The random preview source path/hash also means new-match preview does
not rehearse the actual accepted archive source's uniqueness.

Rollback discards transaction updates; it does not undo the CPU/query/lock work
already performed. PostgreSQL documents that sequence allocations are not rolled
back, so temporary inserted rows can consume IDs without persisting matches.
Normal write locks can remain until transaction end. Read-only preview would avoid
those temporary writes and their lock/sequence effects; this does not imply that
all normal SELECTs are lock-free or that every rollback is expensive.
[ROLLBACK](https://www.postgresql.org/docs/18/sql-rollback.html),
[sequences](https://www.postgresql.org/docs/18/functions-sequence.html),
[locking](https://www.postgresql.org/docs/18/explicit-locking.html).

## What each approach gives up

| Approach | First table | Import rehearsal before save | Main advantage | Main cost or limitation |
| --- | --- | --- | --- | --- |
| Keep and optimize synchronous rollback | Waits for optimized import | Yes | Lowest semantic migration risk; improvements also help save | Still does temporary persistence on every preview; achievable latency unmeasured |
| Draw compiled-JSON table; run old dry run in background | Immediate/progressive | Yes, once background completes | Useful transitional path with existing validation coverage | Same database work and full-readiness wait; does not accomplish complete rollback removal |
| Compiled-JSON table + shared read-only preflight + real save | Immediate/progressive; exact resolved fields after context | No actual SQL-write rehearsal; semantic preflight retained | Best long-term separation of display, validation, persistence | Requires extraction of policy/projection logic and extensive parity tests |
| Browser JSON table and defer all other checks to save | Immediate | No | Smallest apparent display implementation | Cannot satisfy same early validation/data requirement; later errors and review mismatches |

For the stated requirements, the third design is preferable to the fourth. The
first may be the best near-term engineering value if profiling identifies a small
query fix that makes dry runs fast enough. The second is a rollout bridge, not an
end-state reduction in database work.

## Data and rendering parity

The contract is in `matchHistoryViews.tsx:28` (track), `:34` (player), `:47` (team), `:70` (match).

| View field | Reproducible from compiled JSON? | Additional requirement |
| --- | --- | --- |
| Match scope, format, count, result type, match number, notes | Mostly | Current importer lowercases/trims scope codes (`import_json_to_db.py:1189`) and combines explicit and generated review notes (`:917`). |
| Race order, raw track names | Yes | Use ordered compiled tracks, not stale source. |
| Canonical track names | No | Read league catalog/aliases; detail uses `Track.canonical_name`, not submitted spelling (`stats_queries.py:1028`, `:1248`). Existing `TrackOption` already includes name, league, aliases (`frontend/src/api.ts:220`). |
| Player friend code, score/position arrays, penalties, substitution, aggregate scores | Yes, with importer semantics | Retain null versus zero; strip placeholder awards from player rows; unresolved roles become inferred/unknown on import (`import_json_to_db.py:1042`, `:1111`). |
| Player display name | Not exactly | Database canonical name takes precedence, then recent lounge alias, common table alias, common Mii alias (`player_display_names.py:39`); detail then falls back lounge → table → Mii (`stats_queries.py:1151`). This differs from the editor’s Mii-first `playerLabel` (`matchJsonEditorModel.ts:242`). |
| New player display name | Not always | Import prefers successful MKCentral name, then identity registry, then JSON lounge/table/Mii (`import_json_to_db.py:605`). That MKCentral result is outside match JSON. |
| Team tag/name/status/note | No | Season entry wins, including aliases and historical rename; current view joins `TeamSeasonEntry` (`stats_queries.py:1037`). `TeamScope` already contains these fields (`api.ts:292`), but complete resolution must match importer rules. |
| Team color | Yes | Preserve current JSON color and fallback `#3b82f6` (`stats_queries.py:1182`) rather than introducing a different fallback. |
| Player/team final totals | Yes | Compiled player `total_score` already subtracts player penalty; compiled team `total_score` already subtracts team penalty. Import stores that same team total as both raw and final (`import_json_to_db.py:989`). **Do not subtract penalties twice.** |
| Missing-player scores/reasons/total | Yes, with normalization | Multiple awards in a race are summed, reasons preserved; explicit results supersede legacy arrays (`import_json_to_db.py:1013`, `stats_queries.py:1120`). |
| Cumulative differential | Yes | Sum both teams’ player race scores plus missing awards; order teams first, then build differential (`stats_queries.py:1200`). Do not include final team penalties in raw differential; the chart adds the team penalty offset (`matchHistoryViews.tsx:320`, `:517`). |
| Team/player ordering | Yes, if specified | Team final score descending, tie in match-team insertion order (`stats_queries.py:1058`); players total descending, then Python lowercase display name (`:1169`). Names thus affect row order, rank coloring, counterpart differences and chart orientation. JS localeCompare is not automatically the same ordering. |
| Playoff labels/configuration/series IDs | Partly | Existing division playoff context supplies semifinal count, locked participants, sequencing; backend label formatting resolves it (`stats_queries.py:1233`). |
| Import status and generated review notes | No, unless extracted | Import produces needs-review for resolved-team/count inconsistencies and notes for team alias corrections (`import_json_to_db.py:829`, `:869`, `:939`). |
| Persisted IDs | No for new entities | Do not create plausible database URLs for new draft entities. |

Alias naming is more subtle than picking `identity.canonical_name || JSON name`: importer adds the proposed aliases **before** detail display naming (`import_json_to_db.py:1060`). If canonical name is absent, a proposed lounge alias can become the most recent alias and affect the preview; importer also applies shared MKCentral name priorities. Existing identity API returns alias type/value but not usage/recency ranking metadata (`api.ts:153`). A backend read-only preparation model can overlay proposed alias changes on the identity snapshot; duplicating that in TypeScript would be complex and prone to drift.

There is also a credible optimization alternative before a redesign: `players_sharing_latest_mkc_name` loads every aliased player ID and calls `latest_mkc_name` individually (`backend/player_naming.py:95`); importer calls shared priority for each match player with an MKCentral name (`import_json_to_db.py:1061`). This creates query growth proportional to match players times global player count, before considering shared-name group recursion (`player_naming.py:112`). It is a code-confirmed scalability concern, **not a profiled explanation of the measured 34-second preview**. A read-only projection cannot simply skip the hypothetical name updates and still promise exact parity; either share/batch the naming calculation or explicitly alter the name contract. Optimizing these bulk lookups and flushes while retaining rollback is a legitimate lower-change alternative, and would also speed real saves, which a client-only table does not do.

## Validation guarantees and ownership

| Guarantee/data | Current owner | Can happen without writes? | Impact if only JSON renderer is added |
| --- | --- | --- | --- |
| Required league/season/division, valid regular/playoff metadata, special-result shape, unaccounted aggregates | `match_upload.validate_committable_match`; `playoff_service.validate_competition_metadata`; `match_results`; `unaccounted_matches` | Yes, server pure functions; browser mirrors many rules | Preserve server validation. Browser checks alone are bypassable and not identical. |
| Race tracks/count, per-player position/score array lengths, FC syntax/duplication, position range/duplication, presence of players | `match_upload.py:118–190` | Yes | Preserve authoritative function; do not treat successful rendering as validation. |
| Room sizes, assignment completeness, disconnected awards, missing-player awards, unresolved track identifiers, pending lookups/warnings | `matchJsonEditorValidation.ts:386–843` | Already largely browser-local | Preserve editor issue state and acknowledgement UX; don't create preview metadata that bypasses pending/error gates. |
| League/team/season/division/track/player entry proposals, cross-league team decisions, canonical player links, duplicate resolved identities | `detect_new_entries`; `match_review.unapproved_entries`; `_validated_player_identity_links` | Yes, database reads plus optional MKCentral lookup | Must remain server-side; stale catalogs and different Unicode normalization can disagree with browser. |
| Two distinct resolved team-season entries, exact season entry selection | `detect_new_entries`; `get_or_create_team_entry`; importer | Yes, shared resolver plus hypothetical new-entry representation | Don't just use raw team object keys as identities; aliases can collapse teams. |
| Conference assignment and allowed matchup count | `get_or_create_team_entry`; `validate_conference_matchup` | Yes, query registration/conference/played-match state | Currently NOT covered by just retaining `detect_new_entries`; must extract/read-only-check. |
| Playoff format/config, participants, sequence/duplicate number, series already clinched, final qualification | `validate_playoff_against_existing`; `resolve_playoff_series` | Yes, database queries and pure policy | Current entry check is near-duplicate but not complete; see seeding below. |
| New-semifinal seeding according to standings | `_validate_semifinal_seeding` called in `resolve_playoff_series` | Yes, read-only standings resolution | Currently only importer resolver calls it; current read-only `validate_playoff_against_existing` omits it. |
| ORM column serialization/types/defaults, unique/FK/CHECK constraints | Models and actual flush | Most expected failures can be validated in pure/read-only plan; exact ORM/DB execution cannot be rehearsed without executing it | Some errors move to actual save; meaningful parity/negative tests on disposable PostgreSQL needed. |
| Actual archive path/hash conflict and duplicate table references | `accept_match` + `find_duplicate_source/find_match_conflict` | Yes, read-only query with final recheck | These are already save-only for new preview; read-only preflight could improve early feedback. |
| Queue claim/status, current-admin authorization, stale source version | Routes/auth + `accept_match` + `replace_match` | Yes as preflight, but locks/atomic final checks belong to save | Retain final rechecks, do not trust rendered preview. |
| Durable commit and archive promotion | `accept_match`, storage | No, necessarily actual save | Rollback preview never guaranteed these either. |

Specific source locations: [backend/match_upload.py:118](/home/zgentile/ctcMKWIIstatswebsite/backend/match_upload.py:118), [frontend/src/features/match-editor/matchJsonEditorValidation.ts:386](/home/zgentile/ctcMKWIIstatswebsite/frontend/src/features/match-editor/matchJsonEditorValidation.ts:386), [backend/match_review.py:14](/home/zgentile/ctcMKWIIstatswebsite/backend/match_review.py:14), [backend/import_json_to_db.py:1246](/home/zgentile/ctcMKWIIstatswebsite/backend/import_json_to_db.py:1246), [backend/import_json_to_db.py:373](/home/zgentile/ctcMKWIIstatswebsite/backend/import_json_to_db.py:373), [backend/import_json_to_db.py:454](/home/zgentile/ctcMKWIIstatswebsite/backend/import_json_to_db.py:454), [backend/playoff_service.py:282](/home/zgentile/ctcMKWIIstatswebsite/backend/playoff_service.py:282), [backend/playoff_service.py:402](/home/zgentile/ctcMKWIIstatswebsite/backend/playoff_service.py:402).

## What the implementation would look like

### 1. Use the document the editor will actually upload

Use `compileMatch(match, races)` and its existing unaccounted/special-result paths,
not the originally uploaded file and not a stale preview response. The compiler
already regenerates score-table points, positions, roles, GP arrays, substitutions,
penalties, missing-player awards, labels, and final totals. The projection should
not become a second score calculator. Preserve unknown supported passthrough
fields in the upload JSON; presentation must not rewrite the archive input just
to choose a canonical display name.
[Compiler](../../../frontend/src/features/match-editor/matchJsonEditorModel.ts:366),
[unaccounted compiler](../../../frontend/src/features/match-editor/unaccountedMatchModel.ts:44).

### 2. Define a table presentation contract separate from persistence IDs

The editor already uses `TraditionalTable`, `VerticalScorecard`, and `TrackList`;
both main tables delegate unaccounted results to `UnaccountedScorecard`. Keep
those layouts, styling, GP switches, charts, and formatting. A projection adapter
assembles the data they need. The saved match-detail contract can share that
presentation subset without changing the public match JSON/archive format.
[Editor render call](../../../frontend/src/features/match-editor/MatchJsonEditor.tsx:3826),
[table types/renderers](../../../frontend/src/features/match-history/matchHistoryViews.tsx:28).

Use a stable draft key for each player/team and an optional real database ID for
navigation. Existing entities retain their links; proposed new entities render
as text until accepted. Do not use fake zero/negative IDs as persisted URLs or
React keys. Rollback-generated IDs for new entities are temporary too and should
not be treated as genuine saved destinations.

### 3. Obtain exact display context with reads

Reuse current batched identities, team scopes, track aliases, membership, and
playoff context wherever their contents suffice. Exact name fallback/recency and
hypothetical alias changes require extra resolved facts: existing identity APIs
expose alias type/value but not all ranking metadata. Prefer a shared read-only
preparation module to rebuilding canonical naming rules in the browser.

Its small interface would take the current compiled document, explicit player
links and team resolutions, approvals, and optionally the edited match ID/source
fingerprint. It would return resolved display facts, errors, warnings/proposals,
canonical fingerprint/archive destination, and enough context/version identity to
associate the answer with that exact review. No get-or-create or importer helper
that mutates catalogs belongs in this read-only implementation.

### 4. Share semantic validation with real persistence

Retain structural validators and entry resolution. Extract importer-only policy
checks into shared functions called by preflight and save: conference registration
and matchup frequency, distinct resolved season entries, complete playoff/seeding
rules, and any required normalization. Side-effecting resolvers currently combine
these checks with creation; simply calling them in preflight would retain writes.
No-write preflight should be enforceable by a read-only PostgreSQL transaction in
tests, rather than assumed because a function is named validation.

The preparer should support an explicit hypothetical/exclusion context for an
existing-match replacement. Save recomputes mutable facts inside the real
transaction and applies locks where needed. Prepared/cached data is not authority
for identity ownership, current schedule state, or permissions.

### 5. Separate visible table, validated review, and accepted match

Today `previewMetadata` simultaneously supplies fingerprint, destination,
proposals/edit report, and permission for final actions. Split those concerns.
Drawing a local table must not fabricate server validation or automatically enable
upload/submission. Keep local errors, pending catalog/identity checks, server
errors, new-entry decisions, and warning acknowledgement as independent gates.
Warn clearly while validation is pending; existing error messages should still
point to the relevant input. Additional server warnings must reset the required
acknowledgement. Avoid enabling submission after an old response arrives.
[Current final-action gate](../../../frontend/src/features/match-editor/MatchJsonEditor.tsx:1693).

Associate validation results with document revision, identity choices, team
resolutions, and approvals. Source fingerprint still protects existing-match
edits. The current fingerprint covers canonical JSON, not all sidecar decisions
or a database snapshot; it is not proof that a rollback was run. Keep server
canonicalization rather than hashing arbitrary browser `JSON.stringify` bytes.
Adding a signed preview receipt or new permission system is not required to
preserve today's acceptance security.

### 6. Preserve the actual upload path

Final actions continue sending compiled JSON and explicit resolution/approval
choices, never table rows or fake IDs. Preserve administrator authentication,
queue claim rules, source version checks, current-state revalidation, actual
import/flush/constraints, atomic database commit, accepted-archive promotion,
audit/provenance logs, idempotency and archive-repair handling. Replace local
draft data with the real returned match detail after successful save.
[Acceptance](../../../backend/acceptance_service.py:74),
[review acceptance](../../../backend/routes/reviews.py:197),
[edit save](../../../backend/routes/admin.py:1278).

A read-only preflight cannot rehearse actual ORM writes. Most expected type and
relationship errors can be checked explicitly, but unforeseen persistence/schema
errors remain real-save failures. A rollback rehearsal already cannot guarantee
concurrent uniqueness, final commit, deferred-constraint outcomes, or archive
success. PostgreSQL documents deferred constraints as commit-time checks; this
is a general limit, not a claim that the present schema uses deferred constraints.
[Constraint timing](https://www.postgresql.org/docs/18/sql-set-constraints.html).

## Public submission and accepted-match editing

Anonymous submission is already allowed without proving a rollback preview happened: `create_submission` runs `validate_submission`, which runs structural validation, entry detection, size limits, warning generation/acknowledgement, rate limits, duplicate queue detection, and writes queue/archive metadata. It does not import match rows or require a preview fingerprint. [backend/review_queue.py:24](/home/zgentile/ctcMKWIIstatswebsite/backend/review_queue.py:24), [backend/review_queue.py:86](/home/zgentile/ctcMKWIIstatswebsite/backend/review_queue.py:86), [backend/routes/reviews.py:25](/home/zgentile/ctcMKWIIstatswebsite/backend/routes/reviews.py:25)

The browser currently requires preview metadata before submission (`finalSubmissionBlocked`), so simply fabricating local metadata changes UX gates but not backend authorization. Retain independent server queue validation and final administrator acceptance. If “all errors block queue submission” is interpreted to include importer-only conference/seeding checks, consolidating a read-only preflight improves today's backend contract too. ADR 0004 says anonymous JSON must be server-valid and validation errors block queue submission; accepted archives only follow committed administrator imports. [frontend/src/features/match-editor/MatchJsonEditor.tsx:1693](/home/zgentile/ctcMKWIIstatswebsite/frontend/src/features/match-editor/MatchJsonEditor.tsx:1693), [docs/adr/0004-administrator-access-and-public-review-queue.md:17](/home/zgentile/ctcMKWIIstatswebsite/docs/adr/0004-administrator-access-and-public-review-queue.md:17)

Current queue stores warning acknowledgement; direct admin `accept_match` does not consume `warnings_acknowledged`, despite frontend passing it. That is pre-existing: don't claim every UI warning was enforced by rollback or weaken queue handling while refactoring. [frontend/src/features/match-editor/MatchJsonEditor.tsx:1770](/home/zgentile/ctcMKWIIstatswebsite/frontend/src/features/match-editor/MatchJsonEditor.tsx:1770), [backend/acceptance_service.py:74](/home/zgentile/ctcMKWIIstatswebsite/backend/acceptance_service.py:74)

`replace_match` locks the original match, checks single-match source safety and expected source fingerprint, snapshots inventory/provenance, detaches cross references, deletes owned rows, checks conflicts against the database without original match, redetects/approves entries, reimports using stable match ID/source identity, writes addition logs, restores references, recomputes provenance, and returns before/after inventories/diff. Edit preview rolls all of it back; save runs it again and commits. [backend/match_management.py:446](/home/zgentile/ctcMKWIIstatswebsite/backend/match_management.py:446), [backend/routes/admin.py:1238](/home/zgentile/ctcMKWIIstatswebsite/backend/routes/admin.py:1238), [backend/routes/admin.py:1278](/home/zgentile/ctcMKWIIstatswebsite/backend/routes/admin.py:1278)

A no-write edit preflight needs explicit `exclude_match_id`/hypothetical-state support for reference conflicts, conference matchup counts, playoff numbers and win totals, standings/seeding, original-only imported aliases/roster memberships, and support counts used to decide catalog pruning. It also must retain source-fingerprint and legacy multi-match-source checks. Calculating prospective inventory/addition/provenance summaries without executing replacement is materially more complex than generating a new-match table. Do not silently replace detailed edit summary counts with guesses. IDs of newly created rows already do not survive rollback; current `edit_preview_summary` intentionally removes `record_ids_after`. [backend/match_management.py:439](/home/zgentile/ctcMKWIIstatswebsite/backend/match_management.py:439), [backend/match_management.py:587](/home/zgentile/ctcMKWIIstatswebsite/backend/match_management.py:587)

## Persistence constraints and limits of rehearsal

Models contain uniqueness constraints for source path/hash, season/division/tag identities, friend codes, player aliases/season entries, source match index, playoff series match number, races, match players, and race results; FK constraints and CHECK constraints govern modes/status/roles/special results/playoff shape. These are executed during the rollback flush today and remain executed during acceptance. Repository source search found no explicit deferred-constraint or database-trigger definitions; no live schema introspection was performed. [backend/models.py:154](/home/zgentile/ctcMKWIIstatswebsite/backend/models.py:154), [backend/models.py:278](/home/zgentile/ctcMKWIIstatswebsite/backend/models.py:278), [backend/models.py:327](/home/zgentile/ctcMKWIIstatswebsite/backend/models.py:327), [backend/models.py:386](/home/zgentile/ctcMKWIIstatswebsite/backend/models.py:386), [backend/models.py:578](/home/zgentile/ctcMKWIIstatswebsite/backend/models.py:578)

Rehearsal catches importer bugs and ORM/database mismatch early; a pure/read-only plan cannot literally exercise the same INSERT/UPDATE execution. That tradeoff is best covered with equivalence tests against disposable PostgreSQL plus unchanged transactional save validation, not production preview writes on every click. Existing acceptance/archive and edit/provenance tests are starting points, not a complete parity proof. [backend/test_phase3_workflows.py:197](/home/zgentile/ctcMKWIIstatswebsite/backend/test_phase3_workflows.py:197), [backend/test_phase3_workflows.py:236](/home/zgentile/ctcMKWIIstatswebsite/backend/test_phase3_workflows.py:236), [backend/test_phase3_postgres_integration.py:55](/home/zgentile/ctcMKWIIstatswebsite/backend/test_phase3_postgres_integration.py:55)

## Suggested acceptance evidence for future implementation

- Compare no-write projection versus old rollback projection versus committed match detail, excluding transient IDs/timestamps, across regular/playoff/special/unaccounted documents, aliases/canonical names, multiple codes/new identity choices, zero/null points, substitutes, disconnected players, placeholders, missing-player awards, penalties, inferred/manual roles, GP data, dropped/disqualified teams, and track aliases.
- For each importer-only current policy, show the no-write preflight rejects the same cases before enabling final action; specifically test conference count/assignment and semifinal seeding.
- Verify no DML/sequence allocation in new read-only preview/preflight (read-only PostgreSQL transaction/role test is stronger than mocking `session.add`).
- Keep actual save tests for atomic rollback on bad insert, FK/unique conflicts, idempotent duplicates, queue claim/status races, stale edits, archive promotion/repair, audit and provenance.
- Verify preview invalidates on JSON and identity-resolution/approval changes; delayed older responses must not enable a current document's upload.
- Measure time to first table separately from authoritative readiness and actual save; do not describe a locally rendered but unvalidated table as fully upload-ready.

## Performance implications and the credible alternative

JSON-derived display eliminates one full temporary import/readback from the
normal preview workflow and avoids doing persistence maintenance just to draw a
table. That is a plausible substantial resource and UX benefit. Small match arrays
should be inexpensive to project/render, but no numerical speed claim for the
unimplemented design has been established. Database-dependent authoritative
readiness and optional external naming lookups still take time. Catalog caches
need freshness and scope/version invalidation; a visible table is not a guarantee
that current server checks completed.

Actual upload still executes the importer. This design removes duplicated work
before save; it does not by itself make the real save fast. A failed real save
must retain the draft/resolutions and show an actionable error without partial
accepted data. A network timeout after a committed save still requires idempotent
retry/reconciliation; that problem is not solved by changing preview rendering.

There is a specific source-level reason not to assume rollback architecture is
the entire performance problem. `players_sharing_latest_mkc_name` queries all
aliased player IDs, then calls `latest_mkc_name` once per player. Import invokes
shared-name priorities for every participating player with an MKCentral name.
That can grow with match-player count times global player count, with additional
work for shared-name groups. Batch this calculation once per import/preparation
and preserve the same name-priority output. This concern is verified from code;
it has not been stage-profiled as the cause of the measured 34 seconds.
[Naming loop](../../../backend/player_naming.py:95),
[importer call](../../../backend/import_json_to_db.py:1061).

Optimizing that loop and repeated flushes while retaining rollback is a credible
smaller alternative and helps both preview and actual acceptance. Profiling can
determine whether it makes the existing design acceptable before a larger
validation/planning refactor. The 34-second number measures the whole handler,
not the ROLLBACK statement. Do not remove atomic rollback from failed real saves:
only temporary preview import is under consideration.

## Verification required before changing behavior

Before retiring rollback, compare new projection to `import_preview_match → get_match_detail` on disposable PostgreSQL fixtures. Normalize ephemeral IDs/timestamps only; assert names, ordering, scores, positions, roles, awards, notes and warnings. Also compare final accepted detail to validated projection. Existing e2e tests mostly mock preview responses and therefore cannot prove the adapter matches real importer behavior.

| Fixture | Required evidence |
| --- | --- |
| Standard 12-race known-player 5v5, winner appears second in JSON | Exact all views, totals, order, GP grouping, differential orientation. |
| Team/player ties; Unicode/case variants and historical team aliases | Same canonical tag/name, deterministic ordering, alias notes, no duplicate keys. |
| Team and legacy player penalties | Final totals only deducted once; chart penalty offset unchanged. |
| Manual role overrides, unknown role, final-race runner at low placement | Save preserves role exactly; backend inference matches existing behavior. |
| Substitution before/after shared slot; reduced rooms 7–12; true pre-race DC | Null vs zero, substitutions not double-counted, DC award/annotation preserved. |
| Multiple missing-player awards, zero award, legacy placeholder/array | Correct player vs team attribution, reasons/tooltips, totals and differential. |
| New player, linked new friend code, registry mapping, ambiguous MKCentral, conflicting identity | Correct projected name/link, required decisions/warnings, server rejects invalid choices. |
| Track alias, unresolved identifier, new track, cross-league track conflict | Canonical display/raw source preserved and same blocker/approval semantics. |
| Unaccounted GP, whole-match totals, partial final GP, aggregate awards/DC | Reuse scorecard, totals/attendance preserved, no invented race chart/tracks. |
| Free win either team, mutual tie, transitions among entry/result modes | Zero-race rules, scoring, no lingering race data, same display. |
| Playoffs 3/4 teams, series complete, wrong pairing/best-of/sequence; conference limit | Same context-sensitive server diagnostics and commit rejection. |
| Accepted-match edit, legacy multi-match source, source changed, provenance/reference effects | Exact report guarantees or explicitly retain old edit path. |
| Edit JSON/identity/track during pending lookup; switch files; failed preparation | No stale table/readiness; warnings acknowledgment reset; submission blocked appropriately. |
| Commit duplicate/conflict, mid-commit constraint failure, archive repair | Existing transaction/archive/idempotency semantics unchanged. |

Relevant existing tests include `frontend/e2e/review-warning-acknowledgement.spec.ts:356` (server notes visible), `frontend/e2e/smoke.spec.ts:1157` (substitution artifacts), `frontend/e2e/special-result-edit.spec.ts:127` (mode transitions), `backend/test_unicode_team_identity.py`, `backend/test_unaccounted_matches.py`, and `backend/test_match_management.py`.

Add validation-negative fixtures for every importer-only check that moves into
preflight: unassigned conference team, third same-conference/second cross-conference
matchup, wrong semifinal seed, clinched series, missing finalist prerequisites,
same player through two friend codes, two names resolving to one season entry,
stale source, and duplicate source/table reference. For edits, exclude the old
match consistently instead of double-counting its schedule/series contribution.

Enforce no preview DML/sequence allocation with a read-only database execution
test; compare table/preparation outputs against the old dry-run oracle on a
disposable PostgreSQL fixture, then against actual committed detail. Run the old
oracle locally/staging for parity rather than doubling every production request.
Normalize transient IDs/timestamps, not scores/names/order/diagnostics. Assert
unchanged archive bytes and keep final-save rollback/idempotency/archive-repair
and provenance tests. Existing mocked browser tests alone cannot establish
importer parity.

Measure time to first table, time to authoritative readiness, query count and
connection duration, and actual save time separately. Test warm and cold lookup
context, approved new entities, and ordinary concurrent usage. Do not report
first-paint improvements as faster full validation or faster persistence.

## Suggested sequencing and decision checkpoints

1. Profile the known repeated importer work; this is useful regardless of design.
2. Define exact presentation/validation parity fixtures and a shared table data
   contract; preserve raw and resolved fields separately.
3. Decouple visual table state from validation/acceptance state; use compiled JSON
   and lookup context with the existing renderers. Retaining background dry run
   temporarily preserves current early validation but still consumes its resources.
4. Extract/read-only-test shared preparation and importer-only policies, then
   retire new-match temporary import only after parity/negative tests pass.
5. Support special results and unaccounted GP/totals explicitly, not just one
   successful 12-race fixture; preserve all roles, awards, and penalties.
6. Migrate accepted-match edit entry detection, replacement policy, inventory and
   provenance planning separately. Keep the old dry run until equivalent reports
   and final-save protections exist. Do not describe a partial rollout as removing
   all editor rollback.
7. Keep actual commit/import, accepted-archive, and saved-history behavior intact.

Main implementation areas would be the editor's preview/readiness state;
`matchJsonEditorModel.ts` and `unaccountedMatchModel.ts` reuse; one projection
adapter/shared presentation contract; optional entity links in the shared
renderers; backend read-only preparation and extracted policy/resolution helpers;
preview metadata/fingerprinting routes; acceptance reuse of shared policy; and
separate edit planning in `match_management.py`. No database schema change is
inherently required for ordinary no-write preview; a persisted preview-receipt
system would be an optional new requirement, not needed for equivalence.

This direction is consistent with ADR 0002 (JSON is accepted audit input;
PostgreSQL remains operational source for saved history/analytics) and ADR 0004
(server-valid submissions; administrator-only atomic acceptance). Local draft
rendering must not be presented as accepted data.
[ADR 0002](../../adr/0002-postgresql-and-durable-json-archive.md),
[ADR 0004](../../adr/0004-administrator-access-and-public-review-queue.md).

**Recommendation:** adopt JSON-derived display with the existing renderers and
preserve authoritative server preparation/acceptance. Do not keep synchronous
full temporary persistence solely to obtain a table-shaped response. Do not
replace all server validation with browser rendering or claim exact no-write
rehearsal of SQL writes. Scope the refactor according to measured importer cost
and parity evidence, and treat edit replacement as the larger separate problem.
