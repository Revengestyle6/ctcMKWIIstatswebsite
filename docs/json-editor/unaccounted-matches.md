# Unaccounted matches

An unaccounted match is a played match whose race JSON is unavailable. Its accepted
final scores still belong in standings and individual totals. Select **Match data
coverage → Limited coverage** in the JSON editor, then enter the ordinary
competition metadata, teams, players, and team penalties. Existing team/player pickers,
identity approvals, preview, public review submission, administrator acceptance,
archive repair, corrections, and deletion use the same workflow as race JSON.

## Entry modes

**GP points** is the default. Enter runner and bagger points and race counts for
each player in each GP. Four races form a GP; a final shortened GP uses the remaining
race count. Substitutes and role switches can share a period, but a player cannot
have more combined role races than the period contains.
The compact player table shows one row per GP, with runner and bagger points and
race counts side by side. The player total updates as scores change. The team
penalty remains in the team header; this form has no player penalty field.
Player point entry panels start collapsed, including newly added players. The
header shows the player name, total, runner/bagger points and race counts, and each
GP's total and role split. These summaries update as scores change. Select the
header to expand or collapse the inputs; entered scores are preserved. Panels can
be toggled independently with a click or the keyboard. Total entry shows role
totals without inventing a GP breakdown. Expanded panels have a horizontal divider
between the summary header and the point entry inputs.

**Total points** is a fallback when GP splits are unknown. Enter the same role
points and race counts once for the match. A total entry never supplies GP splits.
Changing match data coverage or entry mode clears scores and missing player points
after confirmation; identity and metadata fields remain available. Reducing the match race count can
leave out-of-range GP entries, which validation rejects until corrected.

Role points **include** disconnection awards. Expand **DC points (optional)** to
record how much of that score was awarded; it is not added again. Blank DC inputs
default to zero. Collapsing the section preserves entered DC points, and its summary
shows any recorded DC total. Role race counts include races
receiving disconnection points, consistent with scored-race participation elsewhere
in the editor. **Missing player points** are separate team-only points with a period
and reason (`short_roster`, `unreplaced_disconnect`, or `unknown`). Never assign
these awards to an individual player.

Player final total = sum of role points − player penalty.
Team final total = sum of player final totals + missing player points − team penalty.
The compiler derives these totals and the backend verifies them. Points/counts,
awards, and penalties must be finite nonnegative integers; player final totals may
be negative after penalties. Role points are at most 15 per credited race, and the
DC portion is at most the role points. Team participation cannot exceed the
format's available player slots. Friend codes, duplicate identities, scope/team
membership, self-match prevention, conference scheduling, and playoff progression
retain their existing checks.

## Document fields

Set `score_source: "unaccounted"`, `entry_mode: "gp"` or `"totals"`, a positive
`races_played`, and `tracks: []`. `result_type` must be `played`; free wins and mutual
ties are separate special results. A team format such as `5v5` is required.

Each player has `aggregate_scores`, for example:

```json
{
  "gp_number": 1,
  "role": "runner",
  "points": 42,
  "races": 4,
  "disconnection_points": 3
}
```

There is at most one row for each player/period/role. GP numbers start at 1 in GP
mode. Total mode uses `gp_number: 0` for the entire match; zero does not identify an
unknown or invented GP. Zero-point participation must still have its actual race
count. Empty/unused roles can have zero points and zero races.

Each team can have `aggregate_awards`, for example:

```json
{"gp_number": 1, "points": 6, "reason": "short_roster"}
```

Total mode awards also use period 0. Unaccounted documents cannot contain track or
player race arrays, legacy `gp_scores` containing race values, or race-based
missing-player results. Aggregate fields are rejected on accounted documents.
Ordinary names, friend codes, colors, room references, metadata, and penalties
retain their existing document conventions.

## Storage and analytics boundaries

Match metadata, identities, accepted scores, penalties, and provenance use the
existing tables. Aggregate facts use three dedicated tables:

- `unaccounted_matches`: one match marker and its entry mode.
- `unaccounted_player_scores`: player/period/role points, race counts, and DC portion.
- `unaccounted_team_awards`: team/period points and missing-player reason.

Neither mode creates `races`, `race_player_results`, `race_team_results`, or track
catalog entries. The accepted aggregate document remains in the same immutable
JSON archive. Correction and deletion remove all aggregate-owned rows before
replacing/removing the common match records. A correction can replace an
unaccounted document with actual race JSON after it becomes available.

| Calculation/view | GP entry | Total entry |
| --- | --- | --- |
| Standings, match outcomes, final scores, divisional individual totals | Included | Included |
| Player/team overview, roster ranking, role points and points per credited race | Optional | Optional |
| GP-number averages and best complete role GP | Optional | Excluded |
| Specific race numbers, tracks, score/placement distributions, wins/podiums, bag-point occurrence, counterpart comparisons | Excluded | Excluded |
| Traditional match score table | GP columns, role totals, DC portions, awards | Role totals, DC portions, awards; no GP columns |

The **Include unaccounted matches** checkbox on player/team dashboards and player/
team individual statistics pages defaults off. Its URL/API field is
`include_unaccounted=true` (the API also accepts `1`, `false`, and `0`). Scope,
team/opponent, role, and match-set filters still apply; cache keys include this
choice. Track-only pages do not offer inclusion because neither mode has track
facts. Standings and divisional indivs always include accepted unaccounted results.
Their eligibility uses entered role race counts as race-equivalent GPs for totals,
without inventing period splits.

Role summary responses expose `unaccounted_matches`, `unaccounted_points`, and
`unaccounted_races`. Placement, bag-point occurrence, counterpart statistics, and
role-classification coverage keep their accounted-race populations and denominators
even when aggregate totals are included. GP averages add sums and race counts
directly from GP entries; total entries never enter that query. Best GP requires
four credited races in the selected role.

Labels include **Unaccounted · GP** or **Unaccounted · totals** in review/history/
dashboard match lists. Match displays explicitly identify the absent race/track
data. Standings and individual rows identify included unaccounted matches. GP and
total scorecards do not display race charts or invented track rows. The database
health race-count check recognizes the unaccounted marker rather than reporting
these intentionally absent races as corruption.

## Verification and rollout

Apply Alembic revision `20261010_0018` before running the updated backend. Existing
accounted matches require no data conversion. The production runtime and reader
roles inherit the established schema default privileges.

`backend/test_unaccounted_matches.py` exercises validation, storage isolation,
role/GP/totals analytics, standings/indivs, correction/deletion, queue isolation, and
authentication. Browser smoke coverage exercises GP defaults, editing, DC awards,
missing player points, collapsible player panels, total fallback, preview compilation,
and analytics URL selection, plus GP/total scorecards without race charts. Run the normal
[development checks](../development/README.md), including
fresh PostgreSQL migration/import and frontend checks/build. No staging/production
deployment is implied by local verification.
