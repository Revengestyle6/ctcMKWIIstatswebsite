# JSON editor preview: connection capacity and cost

Research date: November 15, 2026. Scope: capacity and pricing implications of
changing the database pool, supplemented by the investigation's live read-only
Cloud Run and Cloud SQL configuration audit on that date.

## Findings

The five-connection setting is an application pool limit, not a consequence of
having one Cloud Run CPU. `backend/database.py` creates a new SQLAlchemy Engine
on each `get_engine()` call, with defaults `pool_size=3` and `max_overflow=2`.
`get_session_factory()` calls that constructor each time. Separate module globals
in `admin_auth.py`, `stats_db.py`, `stats_queries.py`, `player_dashboard_stats.py`,
`team_dashboard_stats.py`, and `routes/operations.py` each call
`get_session_factory()`, and the application imports all six. Consequently,
**five is a per-Engine ceiling, not automatically the per-instance ceiling**.
These are current workspace source findings; correspondence with the deployed
image's exact source version has not been established. Six Engines represent an
aggregate configured capacity of 30 checkouts per worker, not proof of 30 active
connections. Actual concurrent demand also depends on the request paths and
worker threads.

SQLAlchemy creates connections on demand, retains at most `pool_size` idle
connections, and discards returned overflow connections. Maximum simultaneous
checkouts per QueuePool equal `pool_size + max_overflow`; its default acquisition
timeout is 30 seconds. [SQLAlchemy pooling documentation](https://docs.sqlalchemy.org/en/20/core/pooling.html#sqlalchemy.pool.QueuePool.__init__)

The live audit of `ctc-stats-api-staging`, latest revision
`ctc-stats-api-staging-00052-glq`, found 1 CPU, 512 MiB memory, concurrency eight,
`DB_POOL_SIZE=3`, and `DB_MAX_OVERFLOW=2`. There are no Gunicorn worker/thread
environment overrides; the current container defaults are one worker and eight
threads. It found **service-level `run.googleapis.com/maxScale=1`** and
revision-level `autoscaling.knative.dev/maxScale=3`. Google's documented effective
maximum is the lesser of these, so the effective configured service limit is
**one instance**, superseding the historical three-instance description in
[infra/run/README.md](../../infra/run/README.md).
[Google precedence rules](https://docs.cloud.google.com/run/docs/configuring/max-instances#use_both_service-level_and_revision-level_minimum_or_maximum_instances)

The live Cloud SQL configuration is PostgreSQL 18, Enterprise edition,
`db-f1-micro`, zonal availability. Its only explicit database flag enables IAM
authentication; there is no explicit `max_connections` flag override. This does
not establish the effective server limit: query `pg_settings` as shown below.
The intended database tier and cost-first upgrade policy are in
[ADR 0002](../adr/0002-postgresql-and-durable-json-archive.md).

Cloud Run's built-in Cloud SQL integration allows up to 100 connections per
container instance to a database; the database's own limit still applies.
Connections multiply as Cloud Run scales. [Google connection limits](https://docs.cloud.google.com/sql/docs/postgres/connect-run#connection_limits)

Budget using the sum of each live Engine's ceiling across every process,
instance, service, and revision using the SQL server, plus jobs and administrative
clients. With six Engines and one worker, increasing each Engine from `3+2` to
`5+3` changes aggregate configured capacity from 30 to 48 per instance, while
retained idle capacity changes from 18 to 30. These are capacity calculations,
not expected utilization. The currently effective one-instance service limit
does not justify treating each pool as the only database consumer. Other services
and jobs may share the SQL server. Revision-only maxima can overlap during
deployment; service maxima and their traffic/tag rules must also be considered,
and maximum-instance settings can be briefly exceeded. Retain headroom.
[Google maximum-instance guidance](https://docs.cloud.google.com/run/docs/configuring/max-instances-limits)

Increasing pool settings alone does not buy a larger database or add a published
per-connection billing item. Google's Cloud SQL pricing lists compute, storage,
networking, and other service charges; its shared-core table specifies
`db-f1-micro` has 0.6 GiB RAM. A larger pool can still have an **indirect** cost:
additional work or contention can increase runtime or require a tier upgrade.
That consequence is an inference, not a fixed charge for each connection.
[Cloud SQL pricing](https://cloud.google.com/sql/pricing)

Cloud Run bills resource use and, with request-based billing, requests. A change
that reduces requests and time spent serving a preview can reduce usage; one that
causes longer execution or more instances can increase it. Pool size itself is
not a pricing dimension. Exact savings need measured traffic and free-tier usage.
[Cloud Run pricing](https://cloud.google.com/run/pricing)

Database capacity cannot be inferred from available connection slots alone.
PostgreSQL uses a backend process per connection, and raising server
`max_connections` increases shared resource allocation. The documented small
memory budget makes a blanket increase difficult to justify without measurement.
[PostgreSQL process resources](https://www.postgresql.org/docs/18/kernel-resources.html),
[connection settings](https://www.postgresql.org/docs/18/runtime-config-connection.html)

## Decision guidance

First reduce duplicated preview work and use set-based database reads behind any
batch API. Combining HTTP calls but internally executing the same expensive reads
in parallel does not solve database pressure. This recommendation is a design
inference from the resource model above, pending the preview path audit.

Keep pool settings unchanged initially. Confirm whether the application should
share one Engine per process, measure acquisition waits separately from query
execution, and check Cloud SQL CPU, memory, connection usage, and errors while
reproducing the JSON editor preview. Consider a small measured pool increase only
if acquisition waits remain material and the database has spare capacity.

Read the real database limit rather than assuming a tier-specific value:

```sql
SELECT name, setting
FROM pg_settings
WHERE name IN (
  'max_connections', 'reserved_connections', 'superuser_reserved_connections'
);

SELECT datname, application_name, state, count(*)
FROM pg_stat_activity
GROUP BY datname, application_name, state
ORDER BY count(*) DESC;
```

Google explicitly recommends reading `pg_settings` for the instance connection
limit. Activity visibility depends on the SQL role; a point-in-time count does not
establish peak demand. [Cloud SQL quotas](https://docs.cloud.google.com/sql/docs/postgres/quotas#maximum_concurrent_connections)

No infrastructure, application code, or database settings were changed for this
research. A safe larger pool size remains undetermined until the deployed Engine
count, shared-server consumers, actual limits, and load measurements are known.

## JSON editor request audit and reproduction

The user confirmed the JSON editor's preview flow, rather than the public match
viewer. No application or infrastructure changes were made. A production frontend
build (`npm run build`) passed. A temporary Playwright probe drove the actual
`/json-editor?league=gsc` page and uploaded the ten-player Match 4 JSON from this
conversation. Every API response was mocked; this establishes request behavior,
not production latency or database saturation. The full catalog response was
held for 900 ms, while identity replies were staggered from 200 to 1100 ms to
exercise asynchronous arrivals. The production-build probe reported:

| Request | Count before pressing preview |
| --- | ---: |
| Player identities | 10 |
| Player team memberships | 10 |
| Track searches | 13 (one catalog plus twelve per-track searches) |
| Authentication session | 1 |
| Match scopes | 1 |
| Team scopes | 1 |
| Playoff context | 1 |
| Total | 37 |

Development mode reported 41 due to repeated mounting effects; the production
count above avoids treating those development effects as production behavior.
Membership requests successively included player IDs 1, then 1–2, and so on to
1–10. The probe asserted ten identity requests and more than one membership
request and passed against both builds. Counts depend on response timing and
editor state: this is a demonstrated scenario, not every preview's fixed cost.
Temporary reproduction commands: `node /tmp/preview-request-probe-production.mjs`
and `node /tmp/preview-request-probe.mjs`; captured requests are in
`/tmp/preview-request-probe-production.json`. These are session-local artifacts.

Source evidence:

- [Identity effect](../../frontend/src/features/match-editor/MatchJsonEditor.tsx#L885)
  uses `pending.forEach` to issue one request per friend code.
- [Configured IDs](../../frontend/src/features/match-editor/MatchJsonEditor.tsx#L305)
  derive from individually resolved identities, and the
  [membership effect](../../frontend/src/features/match-editor/MatchJsonEditor.tsx#L540)
  reruns as that set grows. The membership endpoint already accepts a batch;
  the caller repeatedly supplies partial batches.
- [Track effects](../../frontend/src/features/match-editor/MatchJsonEditor.tsx#L719)
  fetch the catalog and launch per-name fallbacks without waiting for catalog
  completion. Cache invalidation, stale replies after scope changes, and retries
  need explicit treatment in any fix.
- [Identity lookup](../../backend/stats_queries.py#L367) performs four SELECTs for
  a successful exact friend-code lookup: friend-code resolution, player rows,
  friend codes, aliases. Ten successful lookups therefore perform forty SELECTs
  in that implementation. A true bulk implementation can resolve all supplied
  codes and load the corresponding facts with roughly four set-based SELECTs.
  Wrapping ten calls to the existing function in one HTTP handler retains the
  forty-query cost and creates separate sessions.

The actual Continue to preview action additionally sends **two sequential POSTs**:
`/api/matches/new-entries`, then `/api/matches/preview` when no approvals block it.
See [requestTablePreview](../../frontend/src/features/match-editor/MatchJsonEditor.tsx#L1788).
Both paths perform entry detection; the preview also runs an import, flushes,
constructs the match detail using the same session, and rolls back.
See [preview route](../../backend/routes/admin.py#L1090),
[new-entry route](../../backend/routes/admin.py#L1476), and
[preview importer](../../backend/import_json_to_db.py#L1152).
These POSTs are separate from the 37 pre-preview requests measured above.

Unknown friend codes can also invoke MKCentral through the
[public identity route](../../backend/routes/public.py#L128), then again during
entry detection. The public identity helper closes its database session before
MKCentral; in contrast, entry detection performs the external lookup inside the
caller's open database transaction, after database reads have acquired a
connection. Its [HTTP client](../../backend/mkc_registry.py#L38) has timeouts and
retries; six seconds is a read timeout, not a guaranteed whole-operation bound.
This is a source-confirmed risk, not a measured explanation of current latency.

A separate offline import of `app` with a dummy PostgreSQL URL instantiated six
distinct Engines, each with pool size three and overflow two. No database
connections were opened. This confirms current source topology, not the live
revision's exact source or actual connection usage.

## Recommended design and evaluation order

1. **Reduce redundant work while keeping the pool unchanged.** Wait for catalog
   completion before fallback searches; key cached lookups by league/name and
   ignore stale replies. Resolve friend codes in one bounded batch using set-based
   SQL. Resolve memberships for the completed identity set once, or return them
   alongside the identity batch for the selected competition scope. Expose
   per-code missing/conflicting/error results; a single unknown player must not
   erase all successful results. Deduplicate and cap batch inputs, retain existing
   identity/linking rules, and support cancellation/version checks.
2. **Avoid repeated validation in the normal preview action.** Let the existing
   preview operation return either approval-required entries or a validated
   preview, so matches needing no approval can finish in one POST. Retain the
   explicit approval round trip when needed. Commit/submission must still
   revalidate: browser caches and earlier approval results are not authority.
   Do not introduce a generic endpoint that simply fans out subrequests or opens
   ten database sessions internally.
3. **Keep MKCentral out of connection-holding transactions.** Do local database
   reads, release the connection, then enrich unresolved players with bounded
   external work and a short-lived cache. Separate slow optional enrichment from
   essential identity resolution where possible. Recheck authoritative database
   facts before preview/import after any external work.
4. **Give Engine ownership one process-level home.** Consolidation makes the pool
   budget predictable and lets otherwise idle module capacity serve other routes.
   It also lowers aggregate capacity from the current independent pools, so test
   concurrent previews, analytics, authenticated requests, and readiness checks;
   make this a separately measured change. Never share a live Engine across
   forked workers without respecting SQLAlchemy's multiprocessing rules.
5. **Tune capacity only from measurements.** Record browser time to identities
   ready and preview visible, request count, preview stage durations, SQL count,
   database connection hold time, checkout wait, database CPU/memory/connections,
   and errors. Compare representative ten-player/12-race matches with known
   players, unknown players, new-entry approvals, repeated previews, and
   concurrent analytics. Test batch sizes and concurrent users within existing
   deployment limits; do not load-test the small shared production database
   casually. Only test a modest pool increase if pool wait is material while
   database CPU and memory have headroom. A 3+2 to 3+3 experiment is more bounded
   than blindly expanding every pool to eight; neither value is approved as safe
   by this investigation.

The target for a known-player upload is one catalog request, one identity batch,
one membership batch (or memberships included in identity resolution), and one
preview request when no new entries require approval, plus reusable scope/auth
context. This is a proposed request budget, not a measured speedup. Keep the
rollback-based server preview initially: it currently provides importer/database
validation and replacing it with a pure JSON renderer would alter guarantees.

## Server timing sample and priority refinement

A read-only Cloud Logging query sampled the latest 3,000 application request log
rows for `ctc-stats-api-staging` since November 14, 2026 at 00:00 UTC. This is a
bounded recent sample, not a complete day, controlled benchmark, or per-user
trace. Application `duration_ms` measures handler wall time, excluding time
before Flask's `before_request`; it does not isolate SQL, pool acquisition,
external HTTP, CPU throttling, locks, or time spent after a client disconnect.

| Endpoint | Samples | Median handler ms | Sample p95 ms | Maximum ms |
| --- | ---: | ---: | ---: | ---: |
| `/api/matches/new-entries` | 48 | 792.5 | 2061.6 | 6228.7 |
| `/api/matches/preview` | 47 | 29905.9 | 398603.3 | 679876.5 |
| `/api/player-identities` | 413 | 63.4 | 203.2 | 1055.5 |
| `/api/player-team-memberships` | 235 | 18.6 | 92.6 | 988.2 |
| `/api/track-search` | 156 | 31.9 | 496.6 | 976.5 |

These sampled app handlers logged status 200. That does not prove a browser
received a successful response: correlate platform request logs and request IDs
before interpreting the long outliers. Samples may span revisions and match
sizes and should not be summed as if they came from the same browser action.

**This changes the priority:** request batching is a confirmed opportunity, but
it does not by itself explain or fix a roughly 30-second median server preview.
Before choosing a pool increase or rewriting preview, add stage timings to the
actual slow handler: entry detection/external enrichment, importer, final flush,
detail assembly, rollback. Count SQL statements and record connection acquisition
and SQL execution/lock wait separately. The importer currently flushes inside
race/player loops and updates shared player/friend-code/alias facts even for a
rolled-back preview, so excessive round trips or lock contention between
concurrent previews are hypotheses to test. They are not established causes.
Optimize the measured dominant phase with batch reads, fewer necessary flushes,
and bounded transaction duration, preserving importer validation guarantees.

The practical decision is to keep the pool unchanged, remove demonstrated
frontend duplication as a contained change, and profile/optimize the slow server
preview in parallel. Capacity tuning follows those measurements. No fixed
speedup or safe higher pool size can be established from the request counts and
aggregate logs alone.

A follow-up query limited to preview handlers separated deployment revisions.
The current revision `ctc-stats-api-staging-00052-glq` had 42 samples: minimum
23,578.9 ms, median 29,871.3 ms, sample p95 398,603.3 ms, maximum 679,876.5 ms.
Thus the slow-handler finding is also present in the current revision, rather
than being explained solely by older deployments. This later query covers a
slightly different moving sample than the 3,000-row query above. The older
`00049-q69` revision had eleven samples with median 25,728.2 ms.

## Step 1 implementation and verification

Implemented locally on November 15, 2026 after user authorization. The new bounded
`GET /api/player-identities/batch?friend_codes=...` resolves up to 24 codes with
four set-based SELECTs, sharing identity serialization with existing single-code
and name searches. Unknown codes retain the existing single-code MKCentral
enrichment, with two concurrent client requests maximum. The editor applies
known results together and waits for all identity checks before sending the
complete membership set. Membership effect dependencies use a stable sorted ID
key. Track fallback searches wait for the catalog, and stale catalog/identity
responses are ignored after the relevant editor or catalog generation changes.

Repeating the production-build probe with the same ten-player/12-track fixture
and delayed catalog reduced pre-preview requests from **37 to 7**: one each for
authentication, catalog, match scopes, team scopes, playoff context, identity
batch, and memberships. This is request-count evidence under mocked responses,
not a measured production latency improvement. The new PostgreSQL integration
test verifies four actual SELECTs for ten known players plus alternate,
duplicate, and unknown codes and equivalence with individual lookup results.

Validation passed: 32 related backend tests; 65 desktop Chromium editor tests;
backend Ruff lint/format; frontend Biome/TypeScript checks and production build;
`git diff --check`. Browser coverage includes delayed catalog/batch responses,
unknown-code enrichment and concurrency, stale replies after loading another
match, and batch/single-code transport failures. Infrastructure and pool settings
were not changed. The two-stage preview protocol and server transaction profiling
remain separate follow-up work; no deployment was performed.
