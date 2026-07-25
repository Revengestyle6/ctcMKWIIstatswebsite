# Role-Separated Player Analytics Design

Date: 2026-07-18
Status: Approved

## Objective

Separate runner and bagger points across every player-derived analytic. A
combined player scoring average is misleading because the two roles pursue
different objectives and naturally produce very different point totals.

Team match scores, match differentials, records, and war tables remain
role-combined because they represent actual team results rather than player
performance averages.

## Product Rules

- No player scoring average may combine runner and bagger races.
- Role-aware views default to runner statistics.
- A shared `Runner | Bagger` segmented control changes the active metric set.
- The selected role is represented in the URL as `role=runner` or
  `role=bagger` so links and browser navigation preserve it.
- Pages without player-derived statistics do not show the role control.
- Bagger statistics are described as scoring outcomes, not as a complete
  measurement of bagging effectiveness. Shock acquisition is the bagger's
  primary objective, but the current data does not record it.

## Scope

Role separation applies to:

- player dashboard summaries, performance, tracks, rankings, and player
  contributions shown with recent matches;
- team dashboard roster and other player-derived statistics;
- player and team track views where player averages are shown; and
- existing analytics pages that expose player scoring averages or rankings.

Role separation does not alter:

- team final scores or penalties;
- match outcomes, team records, or match differentials;
- traditional or vertical war tables; or
- raw race results displayed as historical facts.

## Role Classification

The existing hybrid classification remains authoritative:

1. A stored `runner` or `bagger` role is used as recorded.
2. A stored role whose source is inferred remains labeled inferred.
3. An unknown role may be inferred only in a confirmed 5v5 race.
4. A confirmed 5v5 race has exactly ten distinct player results and exactly
   five distinct players associated with each of two teams.
5. Placements 1 through 8 infer runner.
6. Placements 9 and 10 infer bagger.
7. Awarded points without a placement do not infer a role.
8. Unknown roles in other formats remain unclassified until a format-specific
   rule is documented.

Every role-aware response reports explicit, inferred, and unclassified role
coverage so users can judge the completeness of the result.

## Runner Metrics

Runner mode includes only results classified as runner. Its primary metrics
are:

- runner races;
- valid runner points;
- runner points per race;
- projected 12-race runner pace;
- average runner placement;
- race wins;
- podiums and podium rate; and
- role-specific track performance and ranking.

A score is valid for scoring calculations only when it is numeric and within
the supported race-score range of 0 through 15. Placement metrics can still
use a valid placement when the score is missing or invalid.

## Bagger Metrics

Bagger mode includes only results classified as bagger. Its primary metrics
are:

- bagger races;
- total valid bagging points;
- points per bagging race;
- bag-point count and rate;
- zero-point count and rate;
- average bagger placement;
- opponent bagger point differential; and
- role-specific track scoring outcomes.

A **bag point** is any valid bagger race score greater than zero. It is not
limited to ninth place. All valid points earned while classified as bagger,
including points from eighth place or higher, count toward bagging points.

Opponent bagger point differential is calculated only for a race where
exactly one bagger is identified on each team and both have valid scores. It
equals the selected bagger's score minus the opposing bagger's score. The UI
must not label this comparison as a win rate because finishing above the
opposing bagger does not establish that the bagger fulfilled the role's main
objective.

## Interface Design

The role selector is a compact segmented control placed beside the existing
career, season, and division scope controls. Runner is selected when the URL
does not specify a valid role.

Changing modes replaces labels, summary values, table columns, sorting
options, and explanatory text with the relevant role's metric set. Runner-only
labels such as `12-race pace` and `podium rate` never appear in bagger mode.
Bagger-only labels such as `bag-point rate` never appear in runner mode.

Recent-match lists retain the same matches in both modes. Any player scoring
summary embedded in a match row uses only the selected role. Team result
values in those rows remain unchanged.

## Backend Design

Player-stat endpoints accept `role=runner|bagger` and default to `runner`.
Unsupported role values return HTTP 400 with a clear error message.

A shared role-filtering and aggregation layer supplies dashboards, rankings,
track statistics, and legacy analytics endpoints. Consumers must not implement
independent role inference or combine pre-aggregated runner and bagger values.

Responses include:

- the active role;
- role-specific counts and metrics;
- explicit and inferred coverage;
- unclassified race counts;
- excluded invalid-score counts; and
- counterpart eligibility counts where bagger comparison is requested.

Team-level result aggregation continues to use all valid team scoring data and
penalties regardless of player role.

## Empty And Partial Data

- A player with no results for the selected role receives a successful empty
  response, not a fallback combined average.
- A metric requiring placement is unavailable when placement is missing.
- A metric requiring a valid score excludes missing or out-of-range scores and
  reports the exclusion count.
- Opponent bagger differential is unavailable when either team has zero or
  multiple identified baggers, or when either score is invalid.
- Partial role coverage remains visible and is never silently treated as full
  coverage.

## Documentation

The analytics methodology document will define each runner and bagger metric,
the hybrid role-classification rules, score validity, counterpart eligibility,
and the limitation that shock acquisition is not recorded. User-facing help
text will use the same definitions.

## Verification

Backend tests will cover:

- strict exclusion of bagger points from runner metrics and runner points from
  bagger metrics;
- explicit and inferred role classification;
- bag-point count and rate using `score > 0`;
- zero-point count and rate;
- bagger points above one point;
- opponent bagger differential and all disqualification cases;
- missing and invalid scores;
- partial role coverage;
- invalid role parameters; and
- unchanged team scores, penalties, and match results.

Frontend tests and manual verification will cover:

- Runner as the default mode;
- URL persistence for both modes;
- metric labels, columns, and sorting changing with the mode;
- empty and partial-data states;
- recent-match player contributions respecting the mode; and
- team result values remaining unchanged when the mode changes.

## Non-Goals

- Estimating shock acquisition or overall bagging effectiveness from placement
  alone.
- Assigning a bagging winner based on placement or points.
- Adding new role-inference rules for formats other than confirmed 5v5.
- Changing historical match scores, placements, penalties, or team outcomes.
