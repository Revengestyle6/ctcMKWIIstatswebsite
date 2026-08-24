# Dashboard Analytics Methodology

This document defines the calculations used by the player and team dashboard
APIs. Dashboard filters change the rows included in a calculation; they do not
change player or team identity.

## Scope

- Career includes every recorded season and division.
- Season includes every division and team appearance in that season.
- Division requires a season and includes only that season/division pair.
- Player team filters use the global `team_id` across matching season entries.
- Team opponent filters retain only matches containing the selected global
  opponent `team_id`.

## Player Role Modes

Player analytics never combine runner and bagger points into one average. Every
player scoring view uses one of two explicit modes:

- **Runner** is the default and reports runner-only scoring and placements.
- **Bagger** reports bagger-only scoring outcomes.

The selected mode is stored in the page URL so links, refreshes, and browser
navigation retain it. Team match scores, records, differentials, penalties,
recent matches, and team track results always remain complete team statistics;
the role selector does not filter them.

## Player Scoring

- Points per race includes numeric `race_player_results.score` values from 0
  through 15, the deterministic single-race scoring range.
- Values outside 0 through 15 are excluded and reported as invalid score rows;
  historical files sometimes placed GP totals into a race-score field.
- Awarded disconnection points count toward scoring even when no placement was
  assigned.
- Placement metrics include only integral placements from 1 through 10.
- The 12-race pace is points per race multiplied by 12. It is not necessarily
  an actual match score.
- A player counts as participating in a match after recording at least one
  numeric score or placement.
- Best match score is the sum of the player's numeric scores in one match.
- Best GP is the largest sum from a complete group of four consecutive race
  numbers in one match. Incomplete groups are excluded.

## Runner Classification

Runner analytics use a hybrid classifier. Classification is calculated for
analytics and does not rewrite imported race data.

1. A stored `runner` or `bagger` role is authoritative.
2. A stored role with `role_source = inferred` remains labeled inferred.
3. Other stored non-unknown roles are labeled explicit.
4. An unknown role can be inferred only in a confirmed 5v5 race.
5. A race is confirmed 5v5 only when it has exactly ten result rows for ten
   globally distinct players, exactly two teams, and exactly five distinct
   players assigned to each team. A `5v5` format label alone is not enough to
   infer roles from an incomplete or malformed race.
6. In an eligible race, placements 1 through 8 infer runner.
7. In an eligible race, placements 9 and 10 infer bagger.
8. Awarded points without a placement remain unknown.
9. Unknown roles in other formats remain unknown until a format-specific rule
   is approved.

Every performance response reports these coverage categories:

- explicit runner;
- inferred runner;
- explicit bagger;
- inferred bagger; and
- unknown.

Runner averages include explicit and inferred runner rows with valid numeric
scores. Runner placement, win, and podium metrics include runner rows with
valid placements.

## Runner Metrics

- Runner races count rows classified as runner.
- Scored runner races count runner rows with scores from 0 through 15.
- Points per race is valid runner points divided by scored runner races.
- The 12-race pace is runner points per race multiplied by 12.
- Race wins and podiums require valid placements of 1 and 1 through 3,
  respectively.
- Podium rate is podiums divided by runner rows with valid placements.

## Bagger Metrics

- Bagger races count rows classified as bagger.
- Scored bagger races count bagger rows with scores from 0 through 15.
- Bagging points per race is valid bagger points divided by scored bagger races.
- A **bag point** means the bagger scored more than zero points in that race.
  It is not a race win and does not prove that the team's bagger objective was
  achieved.
- Bag-point rate is scored bagger races above zero divided by scored bagger
  races. Zero-point rate is scored bagger races equal to zero divided by scored
  bagger races.
- Average placement uses only valid recorded bagger placements.
- Opponent point differential is calculated only for races with exactly two
  teams, exactly one classified bagger on each team, and valid scores for both.
  Explicitly stored bagger roles can therefore qualify even when a race is not
  eligible for 5v5 role inference. The metric is the selected bagger's points
  minus the opposing bagger's points. Races that do not satisfy that
  comparison are excluded rather than treated as zero.

The source data does not record shock acquisition. Bagger metrics therefore
describe scoring outcomes only and do not measure complete bagging
effectiveness.

## Player Track Statistics

- Track appearances count numeric player scores on the canonical track.
- Every track table uses the selected role and never mixes runner and bagger
  scores.
- Points per race is valid selected-role points divided by scored selected-role
  races on the canonical track.
- Runner track wins, podiums, and podium rate use valid runner placements.
- Bagger track tables report total bagging points, points per bagging race,
  bag-point rate, zero-point rate, and average placement. Counterpart
  differential is intentionally omitted from track rows because the comparison
  belongs to a whole race, not one player's isolated track aggregate.
- The selected minimum-races threshold is applied after all scope filters.

## Team Match Statistics

- Records compare `match_teams.final_score`, after penalties.
- If a legacy row lacks `final_score`, the fallback is raw score minus team
  penalty points.
- Ties are retained as ties.
- Differential is the selected team's final score minus the highest opposing
  final score.
- Win rate is wins divided by wins, losses, and ties. Unknown results are not in
  the denominator.
- Recent matches sort by season number, match number, then match ID because
  trusted historical dates are not consistently available.

## Team Track Statistics

A team's score in one race is:

```text
sum(player race scores) + sum(race_team_results missing-player awards)
```

Missing-player awards increase the team score without creating a synthetic
player. A team race win compares that complete score with the highest opposing
complete score. Equal scores are race ties.

Track averages are gross race scores. A match-level penalty is not assigned to
a track unless the source data identifies the exact race.

## Rankings And Thresholds

- Rankings are returned only for a selected season and division.
- The minimum-races requirement is configurable from 1 through 500 and counts
  valid scored races in the selected role for player scoring leaderboards.
- Equal metric values receive the same rank; ties are not broken.
- Runner player rankings use 12-race scoring pace. Bagger player rankings use
  bagging points per race, with bag-point rate available as an alternate roster
  ordering.
- Team overview ranking uses final-score differential per race.
- Responses include the rank, eligible population, metric, value, and active
  minimum-races requirement.

## Identity And Logos

- Dashboard routes use global `player_id` and `team_id` values.
- Friend codes and aliases are identity history for one player, not separate
  analytics records.
- Team logos are resolved in this order: selected-season logo by priority,
  career/default logo by priority, shared placeholder.
- Logo asset paths must remain under `frontend/public/images/team-logos/`.
