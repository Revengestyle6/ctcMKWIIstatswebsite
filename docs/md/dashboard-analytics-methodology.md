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

## Player Scoring

- Points per race includes numeric `race_player_results.score` values from 0
  through 15, the deterministic single-race scoring range.
- Values outside 0 through 15 are excluded and reported as invalid score rows;
  historical files sometimes placed GP totals into a race-score field.
- Awarded disconnection points count toward scoring even when no placement was
  assigned.
- Placement metrics include only rows with a numeric placement.
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
5. A race is confirmed 5v5 when its normalized match format is `5v5`, or when
   it has exactly two teams and ten distinct placements covering 1 through 10.
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

Runner averages include explicit and inferred runner rows with numeric scores.
Runner placement, win, and podium metrics include runner rows with placements.
Bagging is reported as role context rather than a headline point-performance
measure.

## Player Track Statistics

- Track appearances count numeric player scores on the canonical track.
- Average is total numeric player points divided by appearances.
- Runner average uses only classified runner rows with numeric scores.
- Wins and podiums require placements of 1 and 1 through 3, respectively.
- Top-three rate uses only rows with placements.
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
- Recent matches sort by season number, week number, then match ID because
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
- The minimum-races requirement is configurable from 1 through 500.
- Equal metric values receive the same rank; ties are not broken.
- Player overview ranking uses 12-race scoring pace.
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
