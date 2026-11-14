# GP average audit

Open **Audit** next to Player GP Average on the standings page, or use
**Pages → GP average audit**. The URL preserves league, season, division, role,
eligibility filter, and an explicitly selected player/team season entry.

The left table uses the standings leaderboard's eligibility and ranking rules.
GPs and points have separate columns. A selected row opens the calculation on
the right; on smaller screens the audit follows the table. Search narrows the
current filtered list without changing ranks. The first matching row is selected
when the previous selection is unavailable.

Both cards have the same measured height, determined by the audit's natural
content height. The player table fits as many rows as the available height
allows and uses Previous/Next pagination instead of vertical scrolling. Opening
rules or review details, changing matches/GPs, and resizing the window adjust
the row budget automatically. Paging does not change the selected player;
selecting a row anchors that player on the visible page as capacity changes.
A minimum shared height keeps the controls, pagination, and one row usable in
loading, empty, and error states. The previous audit height is preserved while
a different player's audit loads. Horizontal table scrolling remains available
when needed on narrow screens.

The audit shows both roles, team participation, qualification, and per-match
role totals. The match dropdown and compact Previous/Next arrows show one match
at a time, with a position counter and review counts in the dropdown.
Navigation is hidden when there is only one match. Match breakdowns include the
selected player's recorded races, tracks, player count, placements, points, role,
and role source. Keyboard-accessible GP tabs show one GP at a time and scroll
horizontally for longer matches. The GP total and role subtotals sit directly
below the race table, followed by a muted whole-match total and role subtotals.
Shared role sources are shown once beside the tabs; mixed sources appear inline
beside each role badge. The Review column appears only when that GP has flags.
Aggregate GP records use the same navigation, while whole-match aggregate
records remain unsplit. Runner and bagger badges match the JSON editor’s
blue/white and amber/black role buttons. A review prompt selects its match and
GP, scrolls to, and focuses its exact race. Links open the full match or the
existing JSON editor workflow; the audit itself does not mutate records. The
editor link is shown only after the session confirms an authenticated admin or
owner. Public visitors retain access to the audit and full-match link.

The player header combines identity and scope. A compact participation line and
two-row role table show points, races, GPs, the average calculation, and
eligibility. Ineligible active players see the additional role races needed;
inactive teams retain their team-status reason. Calculation and review rules
are available in a collapsed disclosure. Reconciliation is a quiet status when
matching and a highlighted warning when mismatching.

The review section shows only a short empty-state line when no races are
flagged. Otherwise it previews up to three races. Expanding review reveals
reason filters and a longer list, with additional races available on demand.

## Calculation boundaries

Only regular-season played matches in the selected league, season, division,
and team season entry contribute. The audit uses the existing leaderboard and
role classification functions. Reviewed analytics exclusions stay excluded and
are labelled in the race breakdown. Team matches without selected-player
participation still appear because they can affect qualification.

Individual role GPs are role races divided by four. Team GPs count recorded
four-race blocks, including partial blocks, plus unaccounted match race
equivalents. The requirement is `ceil(team GPs × 2/3)` GPs, or four times that
many races, separately in each role. Inactive teams remain ineligible.

Match totals are independently summed and reconciled with the leaderboard's
role points, role race counts, and team GP denominator. Reconciliation confirms
that the explanation accounts for the leaderboard; it does not validate entry
accuracy against an external source.

Unaccounted matches show recorded GP/whole-match role totals and included DC
points. They do not invent unavailable tracks, placements, or race-level flags.

## Review rules

Flags are investigation prompts rather than corrections or confirmed errors.

- **9 or fewer players:** at most nine distinct players have valid recorded
  placements. This is observable finishing participation, not proof of the
  starting room size; position-less DC awards do not establish that size.
- **DC points:** the player has a recorded score without a placement. Zero-point
  DC records are included because they still count as participation.
- **Unusual role:** at least 12 classified role races exist and at least 80% are
  in one role; a participating race records the opposite role. This history
  includes only the selected team season entry in this season and division,
  including recorded aggregate participation. Tactical role changes and all-run
  races can legitimately produce flags.
- **Unknown role:** a participating race cannot be classified by the same rules
  used by standings and contributes to neither role.
- **Invalid score:** a participating race has a score outside the existing
  valid range. Standings excludes those points while retaining participation.

Excluded races and nonparticipation rows are visible in match breakdowns but do
not produce review prompts. The compact review list previews three races; expanding shows eight and reveals
reason filters, with additional races available on demand.

## Implementation and validation

- `backend/standings_audit.py`: scoped evidence, review flags, and reconciliation.
- `GET /api/standings/audit`: requires `player_id` and `team_season_entry_id`,
  with the same league/season/division query parameters as standings.
- `frontend/src/features/standings/`: shared leaderboard ranking/types and audit
  presentation.
- `backend/test_standings_audit.py`: PostgreSQL integration coverage for partial
  blocks, role scope, DC awards, exclusions, absent players, and aggregate data.
- `frontend/e2e/standings-audit.spec.ts`: desktop/mobile selection, filters,
  breakdowns, and repeat navigation to a flagged race without data mutation.
