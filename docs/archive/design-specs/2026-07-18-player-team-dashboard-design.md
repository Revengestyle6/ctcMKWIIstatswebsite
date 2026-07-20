# Player And Team Dashboard Design

Date: 2026-07-18
Status: Approved design

## Objective

Add stable, career-first dashboard pages for every player and team. These pages
must make identity history, current context, performance, and source matches
easy to inspect without splitting a person across friend codes or splitting a
team across seasons.

The first release will establish the shared dashboard foundation and useful
overview pages. Deeper tabs will be added in inspectable stages so the design
can be refined against real data.

## Product Principles

- A player page represents one global `player_id` across every friend code,
  alias, team, season, and division.
- A team page represents one global `team_id` across every season, division,
  tag variation, color, and logo.
- Career is the default scope. Users can narrow calculations without changing
  the underlying identity page.
- Every summarized result links back to matches that support it.
- Point, placement, runner, penalty, and missing-player calculations have
  explicit and documented meanings.
- Tables are used for dense comparison; cards are reserved for compact summary
  metrics and repeated match items on small screens.

## Stable Routes And Scope

The frontend routes are:

```text
/players/:playerId
/teams/:teamId
```

Scope is represented by URL query parameters so a view can be bookmarked:

```text
?season=s3&division=d2&team_id=17&min_races=12
?season=s3&division=d2&opponent_team_id=24&min_races=12
```

The supported scope levels are:

- Career: no season or division filter.
- Season: one season across all divisions and team entries.
- Season and division: one competitive division in one season.
- Player team: optional `team_id`, applied within or across seasons.
- Team opponent: optional `opponent_team_id`, applied within or across seasons.

Division must belong to the selected season. Team and opponent filters use
global IDs and must have data in the resulting scope. Invalid combinations
return `400`; a valid scope with no results returns an empty data response.

Career is always the initial scope. A configurable minimum-races control is
used for track tables and player rankings. Its initial value is 12, with a
supported integer range of 1 through 500.

## Player Dashboard

### Header And Identity

The header shows:

- canonical lounge name and flag;
- current or most recently seen team;
- recorded seasons, divisions, and teams;
- Career, Season, Division, and Team controls; and
- an expandable identity panel containing every friend code, Mii name, table
  name, and former lounge alias.

Aliases are descriptive history. They never create additional dashboard pages
or analytics identities.

### Overview Tab

The overview includes:

- total races, matches, seasons, points, and teams represented;
- points per race and projected 12-race average;
- best completed four-race GP and best match score;
- race wins, podium finishes, and top-three rate;
- team match record for matches in which the player participated;
- recent match scoring trend;
- scoped ranking when both season and division are selected; and
- five recent matches with team, opponent, result, player score, races played,
  and a link to the complete war table.

### Performance Tab

The performance view includes:

- runner points per race and projected 12-race runner average;
- runner race count, placement average, race wins, and podium rate;
- explicit, inferred, and unknown role coverage;
- score and placement distributions;
- match-by-match scoring trend;
- performance by GP and race number; and
- scoped rankings with configurable minimum races.

Bagging is shown as role and race-count context. Bagger point averages are not
promoted as a headline performance measure.

### Tracks Tab

The track table includes canonical track name, appearances, average points,
runner average, wins, podiums, and top-three rate. It supports search, sorting,
best/worst ordering, and the shared minimum-races control.

### Matches Tab

The paginated match table includes season, division, week, team, opponent,
result, player score, races played, and a link to Match History. The default
page size is 25 and the maximum accepted page size is 100.

### Career Tab

The career timeline groups data by season, division, and team stint. Each row
shows matches, races, points per race, 12-race pace, runner metrics, and links
to the related team and filtered matches. Name and friend-code history appears
here as identity history, not separate performance rows.

## Team Dashboard

### Header And Identity

The header shows:

- selected logo or placeholder;
- canonical name and exact clan tag without case conversion;
- current or most recently seen division;
- color history;
- Career, Season, Division, and Opponent controls; and
- prior display names and tags where recorded.

### Overview Tab

The overview includes:

- total matches and races;
- wins, losses, ties, and win rate;
- average final score and average final-score differential;
- total penalties and average penalties per match;
- best win, closest match, and largest loss;
- scoped ranking when both season and division are selected;
- score-differential trend and recent form; and
- five recent matches with opponent, scope, final score, differential,
  penalties, result, and a link to the complete war table.

### Roster Tab

Career scope shows all recorded alumni. Narrower scopes show players attached
to matching team season entries. The sortable roster contains player name,
friend codes, matches, races, points per race, projected 12-race average,
runner average, runner coverage, and first/last recorded appearance. Player
names link to stable player dashboard routes.

### Tracks Tab

The track table includes team score per appearance, race wins, track win rate,
appearances, and scoped division ranking. Team race scores include awarded
missing-player points from `race_team_results`. Search, sorting, best/worst
ordering, and minimum appearances are supported.

### Matches Tab

The paginated table includes season, division, week, opponent, final score,
differential, penalties, result, and a link to Match History. It supports
opponent and result filters, with the same 25-row default and 100-row maximum.

### Seasons Tab

The season timeline includes division, roster, match record, average final
score, average differential, penalties, and links to scoped roster and match
views. It also records the display name, exact tag, color, and selected logo
for that season.

## Calculation Definitions

### Player Scores And Placements

- Points per race includes numeric `race_player_results.score` values from 0
  through 15, including valid awarded disconnect points. Values outside the
  deterministic single-race range are excluded and reported because some
  historical files stored GP totals in a race-score field.
- Placement metrics include only results with a numeric placement.
- Projected 12-race average equals points per race multiplied by 12. The UI
  labels it as a pace, not an actual match score.
- Best match score sums the player's valid single-race scores within a match.
- A completed GP is four consecutive race numbers in the same match. Best GP
  sums the player's valid single-race scores for a complete four-race group. Incomplete
  groups are excluded.
- A player participated in a match when the player has at least one race result
  with a numeric score or placement. Merely appearing as an unused roster/sub
  record does not add a match to the player's record.

### Hybrid Runner Classification

Runner classification is computed for analytics and does not rewrite source
race records.

1. A stored non-unknown role with a non-inferred source is explicit.
2. A stored role with `role_source = inferred` remains inferred.
3. Explicit runner races are included; explicit bagger races are excluded.
4. An unknown role is eligible for inference only in a confirmed 5v5 race.
5. A race is confirmed 5v5 when the normalized match format is `5v5`, or when
   it has exactly two teams and exactly ten distinct valid placements 1-10.
6. In an eligible race, placements 1-8 infer runner and placements 9-10 infer
   bagger.
7. Awarded points without a placement are not inferred as runner.
8. Unknown roles in every other format remain unknown until that format has a
   separately approved rule.

Every runner response returns explicit runner races, inferred runner races,
explicit/inferred bagger races, unknown races, and total eligible races. The UI
shows counts and coverage alongside runner metrics.

### Team Results

- Match wins, losses, ties, and differentials compare final scores after all
  penalties.
- Ties remain a separate result category.
- Team race score equals player race scores plus matching awarded points from
  `race_team_results`.
- Track scoring metrics are gross race scores. Match-level penalties are not
  assigned to a track unless a penalty has an explicit `race_id`.
- A team wins a race/track appearance when its complete race score exceeds the
  opposing team's complete race score; equal scores are race ties.

### Rankings

Rankings are available only with both season and division selected. Eligible
participants must meet the current minimum-races requirement. Rankings do not
break equal metric values: tied entities receive the same rank. The UI reports
rank and eligible population, for example `#4 of 38`.

### Recent Ordering

Historical match dates are incomplete. Recent lists therefore sort by season
number descending, week number descending, and match ID descending. A future
trusted match date can become the leading sort key without changing the API
contract.

## Team Logo Storage

Logo assets use stable team IDs rather than mutable tags:

```text
frontend/public/images/team-logos/
  placeholder.webp
  {team_id}/
    default.webp
    alternate.webp
    season-3.webp
```

A new `team_logos` table contains:

- `team_logo_id` primary key;
- `team_id` required foreign key;
- nullable `season_id` foreign key;
- `asset_path` relative to `frontend/public`;
- `alt_text`;
- integer `priority`, default 0;
- `is_active`, default true; and
- `created_at`.

The selected logo is the highest-priority active logo for the selected season,
then the highest-priority active logo without a season, then
`/images/team-logos/placeholder.webp`. Ties use the highest
`team_logo_id`. Career scope uses only seasonless logos before falling back to
the placeholder. Asset paths must remain under `/images/team-logos/`; API data
must not permit arbitrary filesystem paths.

This metadata supports multiple logo files, historical season logos, renamed
teams, and a shared placeholder while keeping the asset directory predictable.

## Backend Architecture

Dashboard queries live in a focused analytics module rather than extending the
legacy string-formatting functions. Shared helpers own scope validation,
complete team race scores, participation, runner classification, ranking, and
pagination. Endpoints return structured values, never preformatted display
strings.

The API surface is:

```text
GET /api/players/:id/overview
GET /api/players/:id/performance
GET /api/players/:id/tracks
GET /api/players/:id/matches
GET /api/players/:id/career

GET /api/teams/:id/overview
GET /api/teams/:id/roster
GET /api/teams/:id/tracks
GET /api/teams/:id/matches
GET /api/teams/:id/seasons
```

The overview endpoint includes identity/header data and recent matches. Other
tabs load independently. Existing analytics endpoints remain available during
migration.

## Frontend Architecture

Shared units include:

- dashboard page shell and compact site header;
- URL-backed scope toolbar;
- tab navigation;
- metric strip;
- ranking and role-coverage displays;
- recent-match list;
- paginated/sortable data table; and
- team-logo component with runtime placeholder fallback.

Player and team pages compose these shared units but own their tab-specific
content. Tab data is requested lazily and cached by entity ID plus scope query.
Changing scope refreshes the active tab while preserving the loaded identity
header where possible.

Desktop uses a constrained, dense dashboard with two-column analytical
sections. Mobile uses full-width controls, a horizontally scrolling tab row, a
two-column metric grid, horizontally scrolling tables, and stacked recent-match
rows. Stable placeholders reserve layout space while requests load.

## Navigation Integration

Stable player and team links will be added incrementally to:

- Match History player names and team tags;
- player and team recent-match rows;
- team rosters;
- career and season timelines; and
- existing player/team statistics lists as those responses gain stable IDs.

No link may resolve an identity from display text when a database ID is
available.

## Error And Empty States

- Unknown entity ID: `404` with a not-found page.
- Invalid filter combination: `400` with a field-specific message.
- Valid scope with no records: normal empty response and a scope-specific empty
  state.
- Minimum threshold excludes all results: threshold-specific empty state with
  the current value visible.
- Tab request failure: inline retry state; the loaded header and other tabs
  remain usable.
- Missing or broken team logo: shared placeholder.
- Partial role coverage: metrics remain available with explicit coverage, not
  a generic error.

## Delivery Stages

1. Add shared backend scope/query helpers, stable ID endpoints, team-logo
   migration, asset directory, and placeholder.
2. Build the shared dashboard shell plus Player Overview and Team Overview,
   including Recent Matches.
3. Add Player Performance and Tracks, plus Team Roster and Tracks.
4. Add complete Matches, Player Career, and Team Seasons tabs.
5. Add stable links from Match History and existing statistics pages.
6. Add analytics methodology documentation and complete responsive,
   accessibility, and visual verification.

Each stage must leave a runnable application and preserve existing routes.

## Verification

Backend unit and integration tests cover:

- career, season, division, team, and opponent scope filtering;
- multi-team and multi-division player history;
- explicit, inferred, and unknown runner classification;
- disconnect points without placements;
- missing-player team race totals;
- penalty-adjusted match records and differentials;
- ties and ranking ties;
- configurable ranking thresholds;
- pagination and invalid query combinations;
- logo selection priority and placeholder fallback; and
- structured API response contracts.

Frontend tests and browser verification cover:

- URL-backed tabs and filters;
- loading, empty, error, and retry states;
- logo image fallback;
- stable player/team links from match tables;
- desktop and mobile layouts without overlap or clipped text;
- horizontally scrolling tabs and tables on narrow screens; and
- a successful production TypeScript/Vite build.

## Non-Goals For The Initial Delivery

- User-edited biographies, social links, awards, or profile customization.
- Predictive ratings, Elo, or strength-of-schedule models.
- Inference rules for formats other than confirmed 5v5.
- Automated logo upload or image processing UI.
- Replacing every existing aggregate statistics page before the dashboards are
  proven useful.
