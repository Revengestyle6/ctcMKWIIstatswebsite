# Playoff Support Implementation

This guide describes the current implementation. The original August 8, 2026
checkpoint recorded pending acceptance with real Season 3 playoff JSON; that
historical checkpoint is not proof of current deployment acceptance. Consult the
[staging inventory](../operations/phase-4-resource-inventory.md) for dated evidence
and the [JSON editor guide](../json-editor/README.md) for the complete current
editing and acceptance workflow.

## Delivered behavior

- Regular season remains the default for every match-derived statistic.
- Player statistics, team statistics, matchups, player/team dashboards, and match
  history expose a three-state `Regular season / Playoffs / All matches` control.
  The current `/tracks` and `/tracks/:trackId` analytics pages use regular-season
  results only. Track tabs within player/team dashboards still follow the parent
  dashboard's match set.
- Dashboard and match-history requests use an in-memory response cache and prefetch
  the other match sets after the selected result loads. Cached promises normally
  live for five minutes; successful mutation requests clear them, so reuse is not
  guaranteed for the entire session.
- Individual playoff matches retain the existing race, player, score, penalty, and
  table behavior.
- Match History adds grouped playoff series summaries with series score, state, and
  direct Match 1/2/3 navigation.
- Match History labels playoff matches with their round and match number. A division
  with one semifinal uses `SF M1` and `Semifinals`; a division with multiple
  semifinals uses `SF1 M1` / `Semifinals Series 1`, `SF2 M3`, and so on. Finals use
  `GF M1`. The blue detail breadcrumb follows the same abbreviation rule, while
  regular-season round labels use `M1`, `M2`, etc.
- The JSON editor adds match type, division playoff format, stage, series number,
  match-in-series number, and odd `best_of` controls. `best_of` defaults to 3.
- The division's playoff format must be configured in Database Management before
  playoff entry. The editor loads that context when season/division are selected
  and displays the saved format as read-only, even before a series exists.
- Stage remains selectable. Four-team semifinals allow series 1 or 2; finals and
  three-team semifinals normalize and lock the series number to 1. These values,
  with league/season/division, select the series being edited.
- For an existing series, the editor locks its saved best-of value and assigns the
  next sequential match number for a new match. A new series starts at Match 1.
  Participant, format, and sequence conflicts appear as validation errors;
  existing-match editing retains the match's series position.
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
  "format": "5v5",
  "races_played": 12,
  "tracks": [],
  "teams": {}
}
```

`playoff_format` is `three_team` or `four_team`; `playoff_stage` is `semifinals`
or `finals`. Playoff uploads omit `match_number`. The label is generated automatically and
the stored/displayed value is normalized
to community wording such as `Semifinals Series 1 — Match 1` or
`Finals — Match 1`.

Regular JSON remains compatible. Omitting `match_type` means `regular`, and a new
regular editor upload must provide a positive `match_number`. Historical archived
JSON that uses `week` remains import-compatible, and any historical
`match_label` is preserved.

## Division format and series model

Database Management configures the division's `division_playoff_configs` row
before a playoff match can be accepted. An upload cannot create a missing format
through new-entry approval. Three-team playoffs define one semifinal, one finals
bye, and three playoff teams. Four-team playoffs define two semifinals, no bye,
and four playoff teams. The configuration is division-scoped, so divisions in the
same season can use different formats. Standings already reports playoff
qualification and seed information.

`playoff_series` owns stage, series number, label, and best-of length.
`playoff_series_participants` owns its two global team IDs. Each `matches` row is
still independently queryable and links to the series with its match number.

## Validation sequence

Preview and final acceptance validate metadata and series context. Final
acceptance validates against the database inside its transaction; it also enforces
semifinal seeding when sufficient standings data exists:

1. Require two distinct resolved teams and a non-tied final score.
2. Require a configured division playoff format and a matching submitted format.
3. For a new semifinal series, reject a team already assigned to another semifinal.
   At final acceptance, enforce seeds 1-vs-4 and 2-vs-3 for four teams, or 2-vs-3
   for three teams, when standings supplies those seeds. Non-conference divisions
   with no regular results, and incomplete seed sets, skip this seeding check.
4. For an existing series, require the exact participant set and best-of value.
5. Require the next sequential, unused match number.
6. Reject another match once the wins-needed threshold has been reached.
7. Require all semifinals to be complete before creating finals.
8. For four teams, require the two semifinal winners in finals.
9. For three teams, require the semifinal winner plus a team that did not play in
   the semifinal. This finals validator does not compare that other team directly
   with the first-place seed, even though standings can report the seed.

An existing series row is locked during validation to close the most important
concurrent-upload race.

The editor checks existing-series context eagerly using `GET /api/playoff-series`,
uses that response to assign the next match number, and shows format, participant,
best-of, sequence, and clinched-series errors before requesting a preview. These
client checks are guidance. The server preview validates series context but does
not run `_validate_semifinal_seeding`; the transactional acceptance resolver does.
A successful preview is therefore not a guarantee that final acceptance succeeds.

## Public API

- Statistics endpoints with match-set support accept
  `match_set=regular|playoffs|all`; the dedicated track-analytics endpoints currently
  return regular-season results.
- `GET /api/matches` returns match type and optional series metadata.
- `GET /api/matches/:id` returns the same metadata with full match detail.
- `GET /api/playoff-series?season=s3&division=d1` returns division format and
  grouped series, participants, series wins, completion state, winner, and match
  navigation records.

Endpoints using the shared match-set parser return 400 for invalid values.
Omitting the value selects regular season. Browser URL parsing defaults an
unrecognized value to regular before sending a request.

## Extension points

- Format definitions live in `PLAYOFF_FORMATS` in `backend/playoff_service.py`.
  Adding an unusual future format can extend this registry and its eligibility
  validator without changing existing match facts.
- Structural counts are stored with the division configuration rather than inferred
  forever from a two-value enum.
- Series stages currently have a database check for semifinals/finals. A genuinely
  new bracket stage will require a migration, service validation, and UI label.
- Standings qualification and semifinal seed enforcement already exist. A future
  improvement could make the three-team finals validator require the actual
  first-place seed explicitly, while accounting for incomplete historical data.

## Verification

Automated PostgreSQL coverage includes metadata errors, playoff ties, duplicate
series match numbers, locked formats, immutable pairings, cross-semifinal team
conflicts, clinch enforcement, and match-set separation. The full frontend
TypeScript/Vite production build and browser smoke checks cover the frontend.
Environment acceptance should use representative Season 3 files for:

- both semifinal series in a four-team division;
- a two-match sweep and a three-match series;
- finals after both semifinal winners are known;
- a three-team division with one semifinal and the bye finalist; and
- visible comparisons of regular, playoff, and combined totals on every page that
  exposes a match-set control.
