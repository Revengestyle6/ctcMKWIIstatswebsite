# Live JSON editor timing checks

Test date: November 15, 2026. Cloud Run revision: `ctc-stats-api-staging-00053-zdj`.

Used the deployed anonymous editor at `https://mkw-stats.web.app/json-editor?league=gsc` with the GSC Season 16 Division 10 Match 4 JSON from this conversation. The deployed batch endpoint was verified before the test, so this is a warmed-service sample. These are three ordinary sequential browser runs, not a controlled before/after benchmark or load test. An additional unknown-code check overlapped part of the preview sequence.

| Run | Page ready | Upload validation ready | Review click to visible preview | Preview endpoint | Entry-check endpoint |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 1.078 s | 0.839 s | 34.765 s | 33.740 s | 0.968 s |
| 2 | 1.087 s | 0.341 s | 34.484 s | 33.580 s | 0.861 s |
| 3 | 1.078 s | 0.334 s | 35.137 s | 33.994 s | 1.107 s |

All three runs returned HTTP 200, 12 races, five players on each team, and final scores GBS 391–316 Fe. Browser validation reported zero errors and warnings. Every run issued one request each for authentication, match scopes, team scopes, track catalog, playoff context, batch identities, and memberships: seven setup requests, followed by the two existing preview POSTs. There were no single-player identity calls or individual track searches in the known-player runs.

The median upload-ready time was 0.341 s; the median click-to-visible-preview time was 34.765 s. Preview HTTP timings include network and server time and are not a stage profile or CPU measurement. The request reduction is verified on the live deployment, but there is no equivalent live pre-change upload timing to establish a latency speedup.

Additional lookup checks:

- `unknown-player-upload`: 1.705 s. HTTP 200, zero local identity matches; MKCentral returned `ambiguous`; the lookup completed and the editor allowed review of the unresolved identity.
- `corrected-upload`: 0.303 s. Reloading the corrected original JSON restored zero validation errors and warnings.

Browser requests that could save, commit, or submit matches were blocked. Only the two public preview POSTs were permitted in the known-player tests; the lookup-only browser blocked all POSTs. No matches were saved or submitted.

Local automated tests from the implementation separately cover stale replies after replacing a match, unknown-code request bounds, and transport failures. Those tests used mocked responses; the live checks above used actual deployed endpoints.

Interpretation: the initial lookup workflow is fast in this small sample. The roughly 34-second server preview remains the clear next measurement target. Keep pool settings unchanged and instrument entry detection, import, flush, detail assembly, rollback, connection acquisition, and query/lock waits before choosing the next optimization.

Session-local harnesses and raw timing results: `/tmp/time-live-editor.mjs`, `/tmp/time-live-lookups.mjs`, `/tmp/live-editor-timings.json`, `/tmp/live-editor-lookup-timings.json`. An early harness attempt waited for the intentionally hidden file input to become visible and stopped before upload; it was corrected to wait for attachment and is excluded from the timings above.

The first concurrent analytics request omitted the endpoint's required `track` parameter and returned HTTP 400 before querying; its preview still passed in 34.331 s. This does not establish analytics concurrency behavior. The analytics request was corrected and the concurrency scenario repeated.

Corrected concurrent-use check: one track-ranking analytics GET for Wii DK Summit returned HTTP 200 in 0.711 s while the browser's review workflow ran. The preview remained correct and appeared in 36.050 s; upload validation took 0.836 s. The analytics request started when Review was clicked and may complete during entry detection, before the long preview transaction begins. This is a modest workflow concurrency check, not a controlled test of overlapping database transactions or pool saturation. Results: `/tmp/live-editor-concurrent-timings.json`.
