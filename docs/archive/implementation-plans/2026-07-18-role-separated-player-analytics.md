# Role-Separated Player Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure runner and bagger points are never combined in player-derived analytics while preserving complete team match results.

**Architecture:** Add one shared backend role-classification and aggregation module, then make dashboard and legacy player-stat endpoints consume that contract through an explicit `role=runner|bagger` query parameter. Use a shared controlled React segmented control and discriminated TypeScript response types so every affected screen renders role-appropriate metrics without duplicating role logic in the browser.

**Tech Stack:** Python 3, Flask, SQLAlchemy, SQLite test fixtures, React 19, React Router 7, TypeScript 5, Vite 6, Tailwind CSS.

---

## File Structure

- Create `backend/player_role_analytics.py`: shared role validation, exact-5v5 classification, coverage, role metric summaries, and bagger counterpart calculations.
- Create `backend/test_player_role_analytics.py`: focused unit and in-memory database tests for role classification and metric math.
- Modify `backend/dashboard_stats.py`: consume the shared role module and return role-specific dashboard overview, performance, tracks, ranking, recent-match scoring, and team roster data.
- Modify `backend/test_dashboard_stats.py`: seed complete teams and assert dashboard separation without changing team totals.
- Modify `backend/stats_db.py`: adapt legacy player, track-player, and team-roster analytics to the shared role-aware dashboard calculations; retain complete team-track calculations.
- Modify `backend/app.py`: validate the role query once and pass it to every player-derived endpoint.
- Create `frontend/src/components/RoleModeToggle.tsx`: reusable controlled Runner/Bagger segmented control.
- Modify `frontend/src/dashboardApi.ts`: role query type and discriminated role-specific response types.
- Modify `frontend/src/components/dashboard/DashboardPrimitives.tsx`: allow the role control to sit beside dashboard scope controls.
- Modify `frontend/src/components/dashboard/DashboardTabViews.tsx`: render separate runner and bagger performance, track, and roster columns.
- Modify `frontend/src/pages/PlayerDashboard.tsx`: URL-backed role mode for all player-derived summaries and recent scoring.
- Modify `frontend/src/pages/TeamDashboard.tsx`: URL-backed role mode for the roster tab without changing team result tabs.
- Modify `frontend/src/components/PlayerStats.tsx`: replace mixed averages and formatted strings with structured role-specific data.
- Modify `frontend/src/components/TopTeamPlayers.tsx`: role-specific player roster ranking while leaving team track totals complete.
- Modify `frontend/src/components/TopTracks.tsx`: role-specific player rankings while leaving team rankings complete.
- Modify `docs/md/dashboard-analytics-methodology.md`: publish the final formulas and shock-data limitation.

### Task 1: Shared Role Classification And Metric Engine

**Files:**
- Create: `backend/player_role_analytics.py`
- Create: `backend/test_player_role_analytics.py`

- [ ] **Step 1: Write failing validation and metric tests**

Create tests with lightweight result objects for role validation, valid scores,
runner metrics, and bagger metrics:

```python
from types import SimpleNamespace
import unittest

from player_role_analytics import normalize_role, summarize_role_rows


def result(*, score, position, role, role_source="manual", race_id=1,
           match_team_id=1, player_id=1):
    return SimpleNamespace(
        score=score,
        position=position,
        role=role,
        role_source=role_source,
        race_id=race_id,
        match_team_id=match_team_id,
        player_id=player_id,
    )


class RoleMetricTests(unittest.TestCase):
    def test_role_defaults_to_runner_and_rejects_other_values(self):
        self.assertEqual(normalize_role(None), "runner")
        self.assertEqual(normalize_role(" BAGGER "), "bagger")
        with self.assertRaisesRegex(ValueError, "role must be runner or bagger"):
            normalize_role("all")

    def test_runner_summary_excludes_bagger_points(self):
        rows = [
            (result(score=12, position=2, role="runner"), "runner", "explicit"),
            (result(score=1, position=9, role="bagger"), "bagger", "explicit"),
        ]
        summary = summarize_role_rows(rows, "runner")
        self.assertEqual(summary["total_points"], 12)
        self.assertEqual(summary["points_per_race"], 12.0)
        self.assertEqual(summary["wins"], 0)
        self.assertEqual(summary["podiums"], 1)

    def test_bagger_summary_uses_any_positive_score_as_a_bag_point(self):
        rows = [
            (result(score=0, position=10, role="bagger"), "bagger", "explicit"),
            (result(score=1, position=9, role="bagger"), "bagger", "explicit"),
            (result(score=4, position=7, role="bagger"), "bagger", "explicit"),
            (result(score=12, position=2, role="runner"), "runner", "explicit"),
        ]
        summary = summarize_role_rows(rows, "bagger")
        self.assertEqual(summary["total_points"], 5)
        self.assertEqual(summary["bag_points"], 2)
        self.assertEqual(summary["bag_point_rate"], 66.67)
        self.assertEqual(summary["zero_points"], 1)
        self.assertEqual(summary["zero_point_rate"], 33.33)
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd backend
../.venv-wsl/bin/python -m unittest test_player_role_analytics.py -v
```

Expected: FAIL because `player_role_analytics` does not exist.

- [ ] **Step 3: Implement validation, score rules, classification, coverage, and summaries**

Create these public contracts in `backend/player_role_analytics.py`:

```python
from collections import defaultdict

from sqlalchemy import func, select

from models import RacePlayerResult

VALID_ROLES = frozenset({"runner", "bagger"})


def normalize_role(value):
    role = "runner" if value is None or str(value).strip() == "" else str(value).strip().lower()
    if role not in VALID_ROLES:
        raise ValueError("role must be runner or bagger.")
    return role


def valid_race_score(score):
    return score is not None and 0 <= int(score) <= 15


def classify_role(row, confirmed_5v5_ids):
    if row.role in VALID_ROLES:
        source = "inferred" if row.role_source == "inferred" else "explicit"
        return row.role, source
    if row.race_id in confirmed_5v5_ids and row.position is not None:
        return ("runner" if int(row.position) <= 8 else "bagger"), "inferred"
    return "unknown", "unknown"


def role_coverage(rows, confirmed_5v5_ids):
    coverage = {
        "explicit_runner": 0,
        "inferred_runner": 0,
        "explicit_bagger": 0,
        "inferred_bagger": 0,
        "unknown": 0,
        "total": len(rows),
    }
    classified = []
    for row in rows:
        role, source = classify_role(row, confirmed_5v5_ids)
        coverage["unknown" if role == "unknown" else f"{source}_{role}"] += 1
        classified.append((row, role, source))
    known = coverage["total"] - coverage["unknown"]
    coverage["known_rate"] = round(known / coverage["total"] * 100, 2) if coverage["total"] else None
    return coverage, classified
```

Implement `confirmed_5v5_race_ids(session, rows)` by grouping all
`RacePlayerResult` records for candidate race IDs. A race qualifies only when
there are exactly two `match_team_id` values, each team has exactly five result
rows and five distinct `player_id` values, and the race has ten result rows in
total. Do not treat the match format string alone as sufficient.

Implement `summarize_role_rows(classified_rows, role)` with a common payload:

```python
{
    "role": role,
    "races": len(selected_rows),
    "scored_races": len(valid_scores),
    "total_points": sum(valid_scores),
    "points_per_race": rounded_average_or_none,
    "average_placement": rounded_average_or_none,
    "excluded_score_rows": invalid_non_null_score_count,
}
```

For runner, add `twelve_race_pace`, `wins`, `podiums`, and `podium_rate`.
For bagger, add `bag_points`, `bag_point_rate`, `zero_points`, and
`zero_point_rate`, using only valid scored races as the two rate denominators.

- [ ] **Step 4: Add exact-5v5 and counterpart tests**

Use an in-memory SQLite database to create two five-player teams in one race
and assert:

```python
confirmed = confirmed_5v5_race_ids(session, all_rows)
self.assertEqual(confirmed, {race.race_id})

# Removing one team's fifth result makes the race ineligible.
session.delete(fifth_result)
session.flush()
self.assertEqual(confirmed_5v5_race_ids(session, remaining_rows), set())
```

Add `bagger_counterpart_summary(session, selected_player_id, classified_rows)`
and test these cases:

```python
self.assertEqual(summary["counterpart_races"], 2)
self.assertEqual(summary["opponent_points_for"], 5)
self.assertEqual(summary["opponent_points_against"], 1)
self.assertEqual(summary["opponent_point_differential"], 4)
```

Also assert that a race is excluded when either team has zero or multiple
classified baggers, or either bagger has an invalid score. The helper must
query all player results for the selected bagger's candidate race IDs,
classify those rows with the same exact-5v5 rules, and return counts and totals,
never a `wins` field.

- [ ] **Step 5: Run the role-engine tests**

Run:

```bash
cd backend
../.venv-wsl/bin/python -m unittest test_player_role_analytics.py -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the role engine**

```bash
git add backend/player_role_analytics.py backend/test_player_role_analytics.py
git commit -m "feat: add shared player role analytics"
```

### Task 2: Role-Specific Dashboard Backend Contracts

**Files:**
- Modify: `backend/dashboard_stats.py`
- Modify: `backend/test_dashboard_stats.py`

- [ ] **Step 1: Rewrite dashboard tests around the new response contract**

Expand the fixture so inferred-role races contain ten distinct players, five
per team. Include an explicit bagger result with scores `0`, `1`, and `4`, an
opposing bagger, and at least one invalid score. Replace runner-only assertions
with both modes:

```python
runner = get_player_performance(self.player_id, role="runner", session=self.session)
bagger = get_player_performance(self.player_id, role="bagger", session=self.session)

self.assertEqual(runner["role"], "runner")
self.assertEqual(runner["metrics"]["total_points"], self.expected_runner_points)
self.assertNotIn("bag_points", runner["metrics"])
self.assertEqual(bagger["role"], "bagger")
self.assertEqual(bagger["metrics"]["bag_points"], 2)
self.assertEqual(bagger["metrics"]["total_points"], 5)
self.assertNotIn("twelve_race_pace", bagger["metrics"])
```

Add overview assertions that recent matches remain present in both modes while
`player_score` and `role_races` change. Add team roster assertions that its
minimum-race threshold is applied to selected-role races. Preserve the existing
team overview and missing-player team-track assertions verbatim.

- [ ] **Step 2: Run dashboard tests and verify the contract fails**

Run:

```bash
cd backend
../.venv-wsl/bin/python -m unittest test_dashboard_stats.py -v
```

Expected: FAIL because dashboard functions do not accept `role` and still
return mixed overview and roster metrics.

- [ ] **Step 3: Replace local role helpers with the shared engine**

Import these functions from `player_role_analytics`:

```python
from player_role_analytics import (
    bagger_counterpart_summary,
    confirmed_5v5_race_ids,
    normalize_role,
    role_coverage,
    summarize_role_rows,
    valid_race_score,
)
```

Delete `_valid_race_score`, `_confirmed_5v5_race_ids`,
`_role_classification`, and `_role_coverage` from `dashboard_stats.py`. Update
every caller to use the shared names.

- [ ] **Step 4: Make player overview, performance, tracks, and ranking role-aware**

Add `role="runner"` to the public function signatures and normalize it at the
top of each owned-session call:

```python
def get_player_performance(player_id, season=None, division=None, team_id=None,
                           role="runner", session=None):
    active_role = normalize_role(role)
```

Use a consistent response shape:

```python
{
    "player_id": player_id,
    "role": active_role,
    "scope": scope_payload,
    "metrics": summarize_role_rows(classified, active_role),
    "role_coverage": coverage,
    "score_distribution": role_score_distribution,
    "placement_distribution": role_placement_distribution,
    "by_race_number": role_race_number_averages,
    "by_gp_number": role_gp_number_averages,
}
```

For bagger mode, merge `bagger_counterpart_summary` into `metrics`. For tracks,
filter classified rows to the selected role before applying `min_races`, then
return common score and placement fields plus runner-only or bagger-only fields.
Sort runner tracks by points per race, and bagger tracks by points per bagging
race, then races and name.

In player overview, keep match record, seasons, teams, and recent-match identity
scope unchanged. Calculate total points, role races, role scoring, best match,
best GP, trends, and recent `player_score` only from the active role. Runner
ranking uses 12-race pace. Bagger ranking uses points per bagging race and
returns `metric: "bagger_points_per_race"`.

- [ ] **Step 5: Make team roster role-aware without changing team results**

Add `role="runner"` to `get_team_roster`. Group only selected-role rows into
each player's metric summary and apply `min_races` to selected-role `races`.
Return:

```python
{
    "team_id": team_id,
    "role": active_role,
    "minimum_races": min_races,
    "players": [
        {
            "player_id": player_id,
            "name": display_name,
            "friend_codes": friend_codes,
            "matches": selected_role_match_count,
            "metrics": role_summary,
            "first_appearance": first_selected_role_appearance,
            "last_appearance": last_selected_role_appearance,
        }
    ],
}
```

Do not add a role parameter to `get_team_overview` or `get_team_tracks`; those
functions represent complete team outcomes.

- [ ] **Step 6: Run dashboard and role-engine tests**

Run:

```bash
cd backend
../.venv-wsl/bin/python -m unittest test_player_role_analytics.py test_dashboard_stats.py -v
```

Expected: all tests PASS, including unchanged team totals.

- [ ] **Step 7: Commit dashboard backend changes**

```bash
git add backend/dashboard_stats.py backend/test_dashboard_stats.py
git commit -m "feat: separate dashboard analytics by player role"
```

### Task 3: Role-Aware Legacy Analytics Backend

**Files:**
- Modify: `backend/dashboard_stats.py`
- Modify: `backend/stats_db.py`
- Modify: `backend/app.py`
- Create: `backend/test_role_api.py`

- [ ] **Step 1: Write failing API forwarding and validation tests**

Use Flask's test client and `unittest.mock.patch` to verify defaulting,
forwarding, and rejection before database work:

```python
from unittest.mock import patch
import unittest

from app import app


class RoleApiTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    @patch("app.dashboards.get_player_performance")
    def test_dashboard_role_defaults_and_forwards(self, get_performance):
        get_performance.return_value = {"role": "runner", "metrics": {}}
        response = self.client.get("/api/players/1/performance")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(get_performance.call_args.kwargs["role"], "runner")

    def test_invalid_role_is_a_400(self):
        response = self.client.get("/api/players/1/performance?role=all")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "role must be runner or bagger.")

    @patch("app.stats.top_team_players")
    def test_legacy_player_ranking_forwards_bagger(self, top_players):
        top_players.return_value = []
        response = self.client.get(
            "/api/top-team-players?team=a&season=s2&division=d1&role=bagger"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(top_players.call_args.kwargs["role"], "bagger")
```

- [ ] **Step 2: Run API tests and verify failure**

Run:

```bash
cd backend
../.venv-wsl/bin/python -m unittest test_role_api.py -v
```

Expected: FAIL because the routes do not parse or forward `role`.

- [ ] **Step 3: Add one role query parser and pass it through every player endpoint**

In `backend/app.py`, add:

```python
from player_role_analytics import normalize_role


def _role_arg():
    try:
        return normalize_role(request.args.get("role"))
    except ValueError as error:
        raise DashboardError(str(error)) from error
```

Pass `_role_arg()` to:

- `/api/player`
- `/api/player-avg`
- `/api/players/<id>/overview`
- `/api/players/<id>/performance`
- `/api/players/<id>/tracks`
- `/api/teams/<id>/roster`
- `/api/top-team-players`
- `/api/top-tracks`

Do not pass it to team overview, team tracks, top team tracks, or top teams on a
track.

- [ ] **Step 4: Replace legacy mixed-player calculations with role-aware dashboard data**

In `stats_db.py`, make these functions accept `role="runner"`:

- `findplayeravg`
- `top_player_tracks`
- `top_team_players`
- `top_track_players`
- their `findtop...` formatting wrappers

Resolve the existing player, team, and track aliases as before, but delegate
player summary, player tracks, and team roster math to the role-aware dashboard
functions. Add one role-aware track-player ranking function to
`dashboard_stats.py` for `top_track_players`; it must classify each player's
rows before applying the selected-role minimum and sorting.

Return structured objects instead of strings. The player summary response is:

```python
{
    "role": active_role,
    "player_id": player_row.player_id,
    "player_name": display_name,
    "team_name": team_name,
    "metrics": role_metrics,
}
```

Track and ranking rows use:

```python
{
    "player_id": player_id,
    "name": display_name,
    "role": active_role,
    "races": role_races,
    "points_per_race": points_per_race,
    "twelve_race_pace": runner_pace_or_none,
    "bag_point_rate": bagger_rate_or_none,
}
```

Remove `_format_avg_rows` and `_format_track_rows` once no route consumes
formatted strings. Preserve `findteamavg`, `top_team_tracks`, and
`top_track_teams` as complete team scoring calculations.

- [ ] **Step 5: Run all backend tests**

Run:

```bash
cd backend
../.venv-wsl/bin/python -m unittest test_player_role_analytics.py test_dashboard_stats.py test_role_api.py -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit API and legacy backend changes**

```bash
git add backend/app.py backend/stats_db.py backend/dashboard_stats.py backend/test_role_api.py
git commit -m "feat: expose role-specific player analytics APIs"
```

### Task 4: Shared Frontend Role Contract And Control

**Files:**
- Create: `frontend/src/components/RoleModeToggle.tsx`
- Modify: `frontend/src/dashboardApi.ts`
- Modify: `frontend/src/components/dashboard/DashboardPrimitives.tsx`

- [ ] **Step 1: Define discriminated frontend role types**

In `dashboardApi.ts`, add:

```typescript
export type PlayerRoleMode = "runner" | "bagger";

export interface RoleCoverage {
  explicit_runner: number;
  inferred_runner: number;
  explicit_bagger: number;
  inferred_bagger: number;
  unknown: number;
  total: number;
  known_rate: number | null;
}

export interface RunnerMetrics {
  role: "runner";
  races: number;
  scored_races: number;
  total_points: number;
  points_per_race: number | null;
  twelve_race_pace: number | null;
  average_placement: number | null;
  wins: number;
  podiums: number;
  podium_rate: number | null;
  excluded_score_rows: number;
}

export interface BaggerMetrics {
  role: "bagger";
  races: number;
  scored_races: number;
  total_points: number;
  points_per_race: number | null;
  average_placement: number | null;
  bag_points: number;
  bag_point_rate: number | null;
  zero_points: number;
  zero_point_rate: number | null;
  counterpart_races: number;
  opponent_points_for: number;
  opponent_points_against: number;
  opponent_point_differential: number;
  excluded_score_rows: number;
}

export type PlayerRoleMetrics = RunnerMetrics | BaggerMetrics;
```

Add `role?: PlayerRoleMode` to `DashboardQuery`, replace `runner_metrics` with
`role` and `metrics`, and update overview, track, roster, and recent-match types
to match Tasks 2 and 3.

- [ ] **Step 2: Create the controlled segmented role selector**

Create `RoleModeToggle.tsx`:

```tsx
import type { PlayerRoleMode } from "../dashboardApi";

export default function RoleModeToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: PlayerRoleMode;
  onChange: (value: PlayerRoleMode) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex min-w-44 flex-col gap-1 text-sm font-semibold text-gray-300">
      <legend>Player role</legend>
      <div className="grid min-h-10 grid-cols-2 overflow-hidden rounded-md border border-white/20 bg-zinc-950 p-1">
        {(["runner", "bagger"] as const).map((role) => (
          <button
            key={role}
            type="button"
            disabled={disabled}
            aria-pressed={value === role}
            className={`rounded px-3 py-1 text-sm font-bold capitalize ${
              value === role ? "bg-blue-500 text-white" : "text-gray-400 hover:text-white"
            } disabled:opacity-50`}
            onClick={() => onChange(role)}
          >
            {role}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 3: Add an extra-control slot to dashboard scope controls**

Add `extraControl?: ReactNode` to `ScopeControlsProps`, render it after the
entity control and before minimum races, and keep the existing responsive flex
layout. This lets Player Dashboard always supply `RoleModeToggle` and Team
Dashboard supply it only on the roster tab.

- [ ] **Step 4: Run the TypeScript production build**

Run:

```bash
cd frontend
npm run build
```

Expected: build may fail only in existing consumers that still reference the
old `runner_metrics` and mixed track/roster fields; the new component and base
types themselves must type-check.

- [ ] **Step 5: Commit the shared frontend contract**

```bash
git add frontend/src/dashboardApi.ts frontend/src/components/RoleModeToggle.tsx frontend/src/components/dashboard/DashboardPrimitives.tsx
git commit -m "feat: add shared analytics role selector"
```

### Task 5: Player Dashboard Role Modes

**Files:**
- Modify: `frontend/src/pages/PlayerDashboard.tsx`
- Modify: `frontend/src/components/dashboard/DashboardTabViews.tsx`

- [ ] **Step 1: Make role URL-backed and include it in every player request**

In `PlayerDashboard.tsx`, derive the mode with a safe runner default:

```typescript
const role = searchParams.get("role") === "bagger" ? "bagger" : "runner";
```

Pass `role` to overview, performance, and track API queries; add it to each
effect dependency list. Supply `RoleModeToggle` through `extraControl`:

```tsx
<RoleModeToggle
  value={role}
  disabled={loading}
  onChange={(value) => updateQuery("role", value === "runner" ? "" : value)}
/>
```

Runner URLs may omit `role`; bagger URLs must contain `role=bagger`.

- [ ] **Step 2: Render role-specific overview metrics and recent scoring**

Branch on `data.metrics.role`. Runner cards remain pace, race wins, podium rate,
best runner match, and best complete runner GP. Bagger cards become:

```typescript
[
  { label: "Bagging points", value: String(metrics.total_points), detail: `${numberValue(metrics.points_per_race)} per bagging race` },
  { label: "Bagger races", value: String(metrics.races), detail: `${metrics.scored_races} scored` },
  { label: "Bag-point rate", value: numberValue(metrics.bag_point_rate, "%"), detail: `${metrics.bag_points} races with points` },
  { label: "Zero-point rate", value: numberValue(metrics.zero_point_rate, "%"), detail: `${metrics.zero_points} zero-point races` },
  { label: "Average place", value: numberValue(metrics.average_placement), detail: "Recorded bagger placements" },
  { label: "Opponent point diff", value: signedValue(metrics.opponent_point_differential), detail: `${metrics.counterpart_races} comparable races` },
]
```

Rename the trend heading to `Recent runner scoring` or `Recent bagger scoring`,
and rename the recent-match score header to `Runner pts` or `Bagger pts`.
Preserve the same recent matches and complete team result badges.

- [ ] **Step 3: Render role-specific performance details**

Change `PlayerPerformanceView` to read `data.metrics`. Keep runner score,
placement, GP, wins, and podium displays. In bagger mode show total points,
points per bagging race, bag-point and zero-point rates, average placement, and
opponent point differential. Keep role coverage visible in both modes.

The bagger methodology disclosure must say:

```text
Bagging statistics report scoring outcomes only. A bag point is any race with
more than zero points. Shock acquisition is not recorded, so these values do
not measure complete bagging effectiveness.
```

Do not render a bagger win rate or podium statistic.

- [ ] **Step 4: Render role-specific player track tables**

For runner rows, show points per race, runner races, wins, podiums, and podium
rate. For bagger rows, show points per bagging race, bagger races, bag-point
rate, zero-point rate, and average placement. Update sort labels and comparison
fields to use `points_per_race`; remove the mixed `Average` and `Runner avg`
columns.

- [ ] **Step 5: Build the frontend**

Run:

```bash
cd frontend
npm run build
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit player dashboard UI changes**

```bash
git add frontend/src/pages/PlayerDashboard.tsx frontend/src/components/dashboard/DashboardTabViews.tsx
git commit -m "feat: add runner and bagger player dashboard modes"
```

### Task 6: Team Roster Role Modes

**Files:**
- Modify: `frontend/src/pages/TeamDashboard.tsx`
- Modify: `frontend/src/components/dashboard/DashboardTabViews.tsx`

- [ ] **Step 1: Pass role only to the team roster request**

Read role from the URL with Runner as default. Include `role` in the roster
request and effect dependencies, but do not send it to team overview or team
track requests. Show `RoleModeToggle` beside scope controls only when
`activeTab === "roster"`.

- [ ] **Step 2: Replace mixed roster columns with role-specific columns**

Update `TeamRosterView` to use each row's discriminated `metrics` object.
Runner columns are Player, Friend codes, Matches, Runner races, 12-race pace,
Points/race, and Last seen. Bagger columns are Player, Friend codes, Matches,
Bagger races, Points/race, Bag-point rate, Zero-point rate, Opponent point diff,
and Last seen.

Runner sorting defaults to 12-race pace. Bagger sorting defaults to points per
bagging race and also offers bag-point rate. Links to player dashboards carry
the active `role` query value.

- [ ] **Step 3: Verify complete team analytics are unchanged**

Switch the URL between `role=runner` and `role=bagger` while viewing Overview
and Tracks. Confirm the record, average team score, penalties, differential,
team track average, wins, and recent matches do not change. The role control is
not displayed on those tabs.

- [ ] **Step 4: Build and commit**

Run:

```bash
cd frontend
npm run build
```

Expected: PASS.

Commit:

```bash
git add frontend/src/pages/TeamDashboard.tsx frontend/src/components/dashboard/DashboardTabViews.tsx
git commit -m "feat: separate team roster analytics by role"
```

### Task 7: Legacy Player, Team, And Track Analytics Screens

**Files:**
- Modify: `frontend/src/components/PlayerStats.tsx`
- Modify: `frontend/src/components/TopTeamPlayers.tsx`
- Modify: `frontend/src/components/TopTracks.tsx`

- [ ] **Step 1: Convert Player Statistics to structured role data**

Replace Axios and string result types with `fetchJson` and the structured API
interfaces from Task 3. Add URL-backed role state via `useSearchParams`, render
`RoleModeToggle` beside Player, and pass `role` to `/api/player` and
`/api/player-avg`.

Runner summary shows 12-race pace, points per race, and runner races. Bagger
summary shows bagging points, points per bagging race, bag-point rate, and
bagger races. Track rows render structured columns appropriate to the role.
The dashboard link preserves `season`, `division`, and `role`.

- [ ] **Step 2: Convert Team Statistics player rankings**

In `TopTeamPlayers.tsx`, add the URL-backed toggle and pass role only to
`/api/top-team-players`. Keep `/api/top-team-tracks` complete and unchanged.
Render structured player ranking columns rather than formatted strings.

Runner columns show 12-race pace, points per race, and runner races. Bagger
columns show points per bagging race, bag-point rate, zero-point rate, and
bagger races. Link the selected team dashboard to
`tab=roster&role=<active-role>`.

- [ ] **Step 3: Convert Track Averages player rankings**

In `TopTracks.tsx`, add the URL-backed toggle and pass role only to
`/api/top-tracks`. Keep `/api/top-teams-on-track` complete and unchanged.
Render structured role-specific player columns.

Delete the client-side regex filter that hides rows below two points. It would
incorrectly hide baggers and duplicates a backend concern; `min_races` remains
the eligibility threshold.

- [ ] **Step 4: Build and inspect all three screens**

Run:

```bash
cd frontend
npm run build
```

Expected: PASS.

Inspect:

- `/stats?role=runner` and `/stats?role=bagger`
- `/top-team-players?role=runner` and `?role=bagger`
- `/top-tracks?role=runner` and `?role=bagger`

Confirm changing role never changes the complete team track or top-team
columns on the latter two pages.

- [ ] **Step 5: Commit legacy analytics UI changes**

```bash
git add frontend/src/components/PlayerStats.tsx frontend/src/components/TopTeamPlayers.tsx frontend/src/components/TopTracks.tsx
git commit -m "feat: separate legacy player analytics by role"
```

### Task 8: Methodology And End-To-End Verification

**Files:**
- Modify: `docs/md/dashboard-analytics-methodology.md`

- [ ] **Step 1: Update the published analytics formulas**

Rename `Runner Classification` to `Role Classification` and document:

- exact two-team, five-results-per-team 5v5 inference;
- explicit roles taking precedence;
- no combined player scoring average;
- Runner as the default query mode;
- runner points per race and 12-race pace;
- bagging points and points per bagging race;
- bag point as any valid score greater than zero;
- zero-point rate;
- opponent bagger comparison eligibility and total point differential;
- exclusion of missing and invalid scores from rate denominators;
- partial role coverage; and
- the absence of shock acquisition data and consequent limits on bagger
  evaluation.

Retain the complete-team scoring, missing-player awards, penalty, and team-track
sections.

- [ ] **Step 2: Run the complete backend verification suite**

Run:

```bash
cd backend
../.venv-wsl/bin/python -m unittest test_player_role_analytics.py test_dashboard_stats.py test_role_api.py -v
```

Expected: all tests PASS.

- [ ] **Step 3: Run the frontend production build**

Run:

```bash
cd frontend
npm run build
```

Expected: TypeScript and Vite build PASS.

- [ ] **Step 4: Verify representative API invariants against the development database**

With the backend on port 5001, request the same player and team in both modes:

```bash
curl -sS "http://127.0.0.1:5001/api/players/1/performance?role=runner"
curl -sS "http://127.0.0.1:5001/api/players/1/performance?role=bagger"
curl -sS "http://127.0.0.1:5001/api/teams/1/overview"
curl -sS "http://127.0.0.1:5001/api/teams/1/roster?role=runner&min_races=1"
curl -sS "http://127.0.0.1:5001/api/teams/1/roster?role=bagger&min_races=1"
```

Expected: player totals differ by role, bagger responses contain no runner
pace or podium fields, runner responses contain no bag-point fields, and team
overview totals remain identical.

- [ ] **Step 5: Verify responsive UI behavior**

At desktop and mobile widths, inspect Player Dashboard Overview, Performance,
and Tracks; Team Dashboard Roster; Player Statistics; Team Statistics; and
Track Averages. Confirm the segmented control remains aligned with scope
controls, labels do not overflow, tables remain horizontally scrollable, and
the URL preserves `role=bagger` through reload and dashboard links.

- [ ] **Step 6: Commit documentation and any verification fixes**

```bash
git add docs/md/dashboard-analytics-methodology.md
git commit -m "docs: define runner and bagger analytics"
```

- [ ] **Step 7: Confirm the worktree contains no unintended files**

Run:

```bash
git status --short
git diff --check
```

Expected: only pre-existing user work or explicitly intended implementation
changes remain; `git diff --check` prints no whitespace errors.
