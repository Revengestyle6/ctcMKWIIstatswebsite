# Multiple season entries for one canonical team

GSC season 16 introduces two entries belonging to Jx. in division 1. A canonical
team represents their continuing organization; each **team season entry** is a
separate competitor. A match between those entries is valid. This rule applies to
all leagues and seasons, without special-casing Jx. or season 16.

## Registration and identity rules

- A canonical team can register multiple entries in one season and division.
- Each division requires distinct season tags, compared case-insensitively.
  Different names alone cannot distinguish two sides with the same tag because
  match JSON uses tags as keys. Names may be identical when the tags differ.
- An identical name-and-tag pair for the same canonical team in the same season
  remains a duplicate registration, including across divisions.
- Match sides must resolve to different season entry IDs. Two spelling variants
  or aliases referring to the same entry cannot create a match against itself.
- Season tags take precedence over global canonical aliases. Unique season names
  can identify entries too. The editor does not choose an arbitrary sibling when
  a canonical name or tag is ambiguous; use the actual season tag.
- Existing single-entry imports retain canonical-tag fallback after a season tag
  is renamed. If there are multiple entries, an ambiguous canonical tag fails.
- Canonical identity still follows the existing newest-entry preference unless a
  manual override is active. Creating a sibling can therefore update the automatic
  canonical name/tag; enable the existing override when the organizational identity
  must remain Jx. independently of the latest entry.

Registration is owned by [competition_setup.py](../../backend/competition_setup.py)
and [CompetitionSetupManager.tsx](../../frontend/src/components/admin/CompetitionSetupManager.tsx).
The existing season/division/tag database constraint already permits siblings;
removing the service and form restrictions does not require changing that table.

## Reports and analytics investigation

| Surface | Previous assumption or behavior | Behavior with sibling entries |
| --- | --- | --- |
| Import and preview | Selected the first entry matching canonical team + season + division. League aliases could erase the distinguishing season tag. | Scoped tags resolve the exact entry. Both accepted match sides retain separate entry IDs and match-team IDs. Preview and entry detection reject two aliases resolving to one entry. |
| Standings, matchup matrix and tiebreaks | Already keyed by season entry ID. | Each sibling has its own row, points, record, differential and head-to-head results, including against the other sibling. |
| Conference schedule | Already counts distinct entry IDs and uses entry conference assignments. | The siblings follow the normal same-conference/cross-conference limits and each consumes one conference slot. The four-entry conference capacity is unchanged. |
| Division player leaderboard and eligibility | Already groups by player + season entry. Browser row keys used player + canonical team. | Participation and eligibility stay separate for each entry; browser keys now distinguish those rows when a player has appeared for both siblings in different matches. |
| Match history, score tables, penalties, awards and editing/deletion | Match rows and owned results use match-team IDs or season entry IDs. | Both entries remain separate, with their own scores, penalties, players and awards. Match deletion removes both owned sides while preserving catalog entries. |
| Canonical team overview and ranking | Opponent lookup excluded every row sharing the canonical team ID, producing missing opponents/results in a sibling match. | Opponents are the other match-team row. Canonical statistics combine entry appearances. A 12-race sibling match contributes two appearances and 24 team-race appearances: one win, one loss and opposite differentials. A tied match contributes two ties. This is one actual match, represented from both competing sides. |
| Canonical dashboard presentation | Arbitrarily borrowed one scoped entry's name/color/status/logo and duplicated recent-match keys. | When multiple scoped entries exist, the header uses canonical identity, lists the combined entries and explains appearance counting. Each recent row names its playing tag and uses its match-team ID. History badges use entry IDs. |
| Canonical opponent filter | Overview/roster rejected the same canonical ID; track matching could match the team's own side. | Selecting the same canonical ID selects matches against a different entry of that organization. Overview, roster and team-track filtering compare actual sides; ordinary matches against other organizations do not match this filter. |
| Canonical team roster | Combines players by canonical organization. | It continues to combine both entries for the organizational dashboard. The tag-based top-team-players report supplies an exact entry filter, including unaccounted scores. |
| Player dashboards, roles and bagger counterparts | Match results/counterparts already compare match-team IDs. Team filters represent canonical organizations. | Player career statistics retain both memberships; role and bagger comparisons work against the other side even when its canonical ID matches. Legacy player reports specifying a season tag filter the exact entry, including ranking and unaccounted aggregates. |
| Team average, top team tracks and top track teams reports | Already filter/group by season entry ID. | Siblings retain independent per-tag results. They do not combine race points and then divide by one distinct race count. |
| Track comparison and detail | Deduplicated race sides by canonical team ID, dropping the entire sibling race. Player team margins were also keyed by canonical ID. | Races retain both match-team IDs; track frequency counts the actual race once. Player margins come from their own match side. Team strengths/detail rows use season entries and separate baselines. |
| Canonical track filters | One canonical ID is the filter contract. | The filter includes both entries. Selected summary metrics average both side appearances; signed buckets include their opposite margins. Filter menus show the canonical organization once. Global race counts remain actual race counts; canonical team counts count organizations. |
| Unaccounted matches | Match-team rows and aggregate scores already retain sides. | The same entry resolution applies; standings and canonical overview include both sides when enabled. Entry roster/player filters also restrict aggregate rows. Track/placement analytics still exclude unaccounted matches because they have no race facts. |
| Playoff qualification and seeding | Standings seeds already contain entry IDs, but playoff policy reduced them to canonical IDs. | Semifinal pairings, participation in other series, finals advancement, wins and clinching all use season entry IDs. Two siblings can qualify independently, meet in one series or advance from different semifinals. |
| Playoff bracket presentation | Joined participants to every canonical entry in the division; wins/winner highlighting used canonical ID. | Exact participant-entry joins avoid duplicate participants. The API includes participant and winner entry IDs; the bracket highlights only the winning sibling. Canonical IDs remain available for profile links. |
| Logos and competition status | Already scoped to individual entries. | Each sibling retains its own logo/status. Deleting an unused sibling checks its own playoff participation rather than another sibling's. A dropped/disqualified entry does not change its sibling's status. |
| Canonical team merging | Consolidated entries solely because they occupied the same division. | Different season tags are preserved as separate entries. Identical scope/tag entries may still consolidate. Existing conservative blockers against merging organizations that already opposed each other remain in place. |
| Health checks and archive | Health counts match-team rows, not distinct canonical IDs; raw JSON archives retain the original document. | Two sibling match sides are valid. Accepted archives and fingerprints do not need a new JSON schema or canonical ID field. Replay resolves season tags from operational identity configuration as usual. |

The aggregate choice is deliberate: organizational dashboards answer questions
about the canonical team's combined participation, while standings, season-tag
reports and playoff results describe the separate competitors. For example, a
Jx.A win by 10 against Jx.B appears as +10 and −10 in the combined dashboard, with
a 50% win rate and a zero mean differential for that match. It does not award both
entries a win or treat the opponent as unknown.

## JSON editor validation

The season team pool uses entry IDs for selected/occupied state, so choosing Jx.A
does not disable Jx.B. Duplicate season tags and duplicate resolved entries remain
errors. Existing duplicate friend-code/player checks remain: the same person cannot
occupy both sides of one match simply because the canonical organization is shared.

Roster requests include `team_season_entry_id` as well as canonical `team_id` and
the league/season/division. A legacy roster request without an entry ID still works
when exactly one entry exists; if several exist it asks the caller to choose an
entry instead of returning the first roster. Player membership responses include
every entry, and unusual-team warnings compare entry IDs. Moving a player from
Jx.A to Jx.B therefore produces the normal roster-assignment warning.

Playoff browser validation checks the established pair of entry IDs. Swapping
Jx.B for a third Jx. entry is still a pairing error even though all three share a
canonical ID. Server import and acceptance repeat the authoritative pairing and
clinching checks. Approval of a new entry never waives the distinct-side rule.

See [editor validation](../json-editor/validation.md) and
[editor data sources](../json-editor/data-sources.md).

## Migration and rollout

[Revision 20261011_0019](../../backend/migrations/versions/20261011_0019_playoff_participant_entries.py)
adds a required season-entry reference to playoff participants and changes unique
participation from series + canonical team to series + season entry. It backfills
existing participants through their series' season/division. Missing or ambiguous
legacy entries abort the migration rather than guessing. The downgrade preserves
data and fails if a sibling series cannot satisfy the former uniqueness rule.

Apply the migration before running the new backend. The frontend and backend must
be updated together because editor and bracket contracts now carry entry IDs.
Existing source JSON needs no rewrite. No GSC registration is created automatically;
register the intended tags/names under the existing canonical team.

## Verification

- [Sibling integration tests](../../backend/test_sibling_team_entries.py) cover
  same-division registration, duplicate rejection, actual race JSON import,
  distinct standings and match detail, combined overview/ranking, exact roster
  pools, multiple player memberships, signed track/player margins, entry-specific
  top-player reports, unaccounted scores and sibling playoff clinching.
- [Editor validation tests](../../frontend/e2e/sibling-team-validation.spec.ts)
  cover valid sibling opposition, same-entry aliases, ambiguous canonical lookup
  and replacing an established playoff participant with another sibling.
- Existing competition setup, identity, editor-player, standings, dashboard,
  playoff, match-management and archive-import suites provide historical
  compatibility coverage.
- Migration verification includes an existing two-participant series backfill,
  downgrade, clean upgrade, Alembic schema-drift check and full archive import in
  a disposable PostgreSQL database.
