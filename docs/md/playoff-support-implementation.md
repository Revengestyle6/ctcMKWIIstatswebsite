# Playoff Support Implementation

Status: implemented locally on August 8, 2026; pending user acceptance with real
Season 3 playoff JSON.

## Delivered behavior

- Regular season remains the default for every match-derived statistic.
- Player, team, track, matchup, dashboard, and match-history views expose a
  three-state `Regular season / Playoffs / All matches` control.
- Dashboard and match-history requests use an in-memory response cache and prefetch
  the other match sets after the selected result loads, so repeat toggles do not
  recompute or reload unchanged data during the session.
- Individual playoff matches retain the existing race, player, score, penalty, and
  table behavior.
- Match History adds grouped playoff series summaries with series score, state, and
  direct Match 1/2/3 navigation.
- Match History labels playoff matches with their round and match number. A division
  with one semifinal uses `SF M1` and `Semifinals`; a division with multiple
  semifinals uses `SF1 M1` / `Semifinals Series 1`, `SF2 M3`, and so on. Finals use
  `GF M1`. The blue detail breadcrumb follows the same abbreviation rule, while
  regular-season matches retain their `W1`, `W2`, etc. labels.
- The JSON editor adds match type, division playoff format, stage, series number,
  match-in-series number, and odd `best_of` controls. `best_of` defaults to 3.
- For an existing division, the editor loads the saved playoff context as soon as
  season and division are selected. Stage and semifinal series number remain
  selectable because together with league, season, and division they identify which
  series is being edited. Finals always normalize and lock the series number to 1.
  When the resulting selection matches an existing series, the editor locks
  its saved playoff format and best-of value and automatically assigns its next
  sequential match number. A new series starts at Match 1 without displaying
  locks; conflicting format or stage/series selections appear as validation errors.
  Participant mismatches remain validation errors without adding persistent helper
  text that changes the metadata grid layout.
- Playoff metadata issues carry field ownership. Format, stage, series number,
  match-in-series, and best-of errors appear directly beneath the affected control
  with an invalid-state border while remaining visible in the main Validation panel.

## Editor JSON metadata

An uploaded playoff JSON keeps its existing table data and adds top-level metadata:

```json
{
  "league": "ctc",
  "season": "s3",
  "division": "d1",
  "match_type": "playoff",
  "playoff_format": "four_team",
  "playoff_stage": "semifinals",
  "playoff_series_number": 1,
  "series_match_number": 1,
  "best_of": 3,
  "match_label": "uploaded source label",
  "format": "5v5",
  "races_played": 12,
  "tracks": [],
  "teams": {}
}
```

`playoff_format` is `three_team` or `four_team`; `playoff_stage` is `semifinals`
or `finals`. Playoff uploads omit `match_number`. The stored/displayed label is normalized
to community wording such as `Semifinals Series 1 — Match 1` or
`Finals — Match 1`.

Regular JSON remains compatible. Omitting `match_type` means `regular`, and a new
regular editor upload must provide a positive `match_number`. Historical archived
JSON that uses `week` remains import-compatible.

## Division format and series model

The first approved playoff match creates and locks a `division_playoff_configs`
row. Three-team playoffs define one semifinal, one finals bye, and three playoff
teams. Four-team playoffs define two semifinals, no bye, and four playoff teams.
The configuration is division-scoped, so divisions in the same season may choose
different formats and future standings can read playoff eligibility structure.

`playoff_series` owns stage, series number, label, and best-of length.
`playoff_series_participants` owns its two global team IDs. Each `matches` row is
still independently queryable and links to the series with its match number.

## Validation sequence

Preview and final acceptance validate metadata. Final acceptance repeats all
database-dependent validation inside its transaction:

1. Require two distinct resolved teams and a non-tied final score.
2. Create the division format only after explicit new-entry approval, or require
   the submitted format to match the locked value.
3. For a new semifinal series, reject a team already assigned to another semifinal.
4. For an existing series, require the exact participant set and best-of value.
5. Require the next sequential, unused match number.
6. Reject another match once the wins-needed threshold has been reached.
7. Require all semifinals to be complete before creating finals.
8. For four teams, require the two semifinal winners in finals.
9. For three teams, require the semifinal winner plus a team that did not play in
   the semifinal. Current data cannot independently prove that team was first-place;
   live standings can strengthen this check later.

An existing series row is locked during validation to close the most important
concurrent-upload race.

The editor performs the same existing-series checks eagerly using
`GET /api/playoff-series`, uses that response to assign the next match number, and
shows format, participant, best-of, sequence, and clinched-series errors before
requesting a preview. These client checks are guidance only; the preview and
acceptance paths remain the authoritative enforcement and cannot be bypassed by
modifying the browser request.

## Public API

- Existing statistics endpoints accept `match_set=regular|playoffs|all`.
- `GET /api/matches` returns match type and optional series metadata.
- `GET /api/matches/:id` returns the same metadata with full match detail.
- `GET /api/playoff-series?season=s3&division=d1` returns division format and
  grouped series, participants, series wins, completion state, winner, and match
  navigation records.

Invalid match-set values return 400. Omitting the value always selects regular
season.

## Extension points

- Format definitions live in `PLAYOFF_FORMATS` in `backend/playoff_service.py`.
  Adding an unusual future format can extend this registry and its eligibility
  validator without changing existing match facts.
- Structural counts are stored with the division configuration rather than inferred
  forever from a two-value enum.
- Series stages currently have a database check for semifinals/finals. A genuinely
  new bracket stage will require a migration, service validation, and UI label.
- Future live standings should connect the three-team bye finalist to the first-place
  regular-season team and use the division configuration to mark current playoff
  positions.

## Verification

Automated PostgreSQL coverage includes metadata errors, playoff ties, duplicate
series match numbers, locked formats, immutable pairings, cross-semifinal team
conflicts, clinch enforcement, and match-set separation. The full frontend
TypeScript/Vite production build passes. Final
acceptance should use representative Season 3 files for:

- both semifinal series in a four-team division;
- a two-match sweep and a three-match series;
- finals after both semifinal winners are known;
- a three-team division with one semifinal and the bye finalist; and
- visible comparisons of regular, playoff, and combined totals on each statistics
  page.
