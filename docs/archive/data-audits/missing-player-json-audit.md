# Missing Player JSON Audit

## Summary

The canonical `.json` files contain **28 matches and 37 races** where:

- the race is within the match's declared `races_played` count;
- fewer than 10 players have a positive `race_positions` value; and
- at least one player has a nonzero `race_scores` value but a `null` or missing position.

This is the structural form of a missing or unplaced player result. Only one file
literally contains the text `Missing Player`:

- `backend/JSON/ctc/s1/d4/W4 u Nw.json`, races 11 and 12

Every canonical JSON has a same-basename `.txt` mirror, so the audit lists only
the JSON copy. Editing both copies independently would create duplicate work.

## Straightforward Missing/Unplaced Results

These races have fewer than 10 placed players and one or more plausible race
scores without positions. The editor should preserve these results and allow the
operator to assign them to a player or convert them to team-level missing-player
points.

| File | Race(s) | Unplaced result(s) |
| --- | --- | --- |
| `ctc/s1/d1_2/W1 Mi TMNG.json` | 5 | TMNG / TMNG Yasukuni: 3 |
| `ctc/s1/d1_2/W4 6c Mi.json` | 1, 2 | 6 / Stubbz: 3 each |
| `ctc/s1/d1_2/W6 Flag Mi.json` | 5 | Mi / Tectrox: 3 |
| `ctc/s1/d3/W1 SN SLAY.json` | 11 | SLAY / FolF: 3; SN / guero: 3 |
| `ctc/s1/d3/W1 u_s Ei.json` | 9 | us / Brighid: 3; us / Loocas: 3; Ei / Dragonfly993: 3 |
| `ctc/s1/d3/W1 u_s Ei.json` | 11 | Ei / Striker: 3 |
| `ctc/s1/d3/W10 fr u_s.json` | 5 | fr / Mini Pekka: 3 |
| `ctc/s1/d3/W10 fr u_s.json` | 11, 12 | fr / Ford: 3 each |
| `ctc/s1/d3/W5 Ei fr.json` | 12 | fr / Ford: 3 |
| `ctc/s1/d3/W6 u_s 80.json` | 1 | 80 / emasako/Tiger: 12 |
| `ctc/s1/d3/W8 [80] CPFG.json` | 12 | 80 / Lawrence: 3 |
| `ctc/s1/d3/W8 fr SLAY.json` | 5 | fr / Ford: 2 |
| `ctc/s1/d4/W2 G25 Zog.json` | 12 | Zog Zhit / billiam: 3 |
| `ctc/s1/d4/W4 u Nw.json` | 11, 12 | smu(10)/Missing Player(2): 3 each |
| `ctc/s1/d4/W6 Zog vf.json` | 1 | Zog Zhit / Zoot McSchmoove: 3 |
| `ctc/s1/d4/W8 Nw G25.json` | 5 | N / ardux: 12 |
| `ctc/s2/d2/W10 sts 07.json` | 12 | sts / Bally: 3 |
| `ctc/s2/d2/W4 sts ((((.json` | 5 | sts / JC: 3 |
| `ctc/s2/d2/W7 sts t.json` | 1 | sts / JC: 3 |
| `ctc/s2/d2/W9 Sv t.json` | 11, 12 | Sv / Gwynne005: 3 each |
| `ctc/s2/d3/W10 Flag Sf2.json` | 9 | Flag / Scoped: 3 |
| `ctc/s2/d3/W8 xv Flag.json` | 12 | xv / Gwynne005: 3 |
| `ctc/s2/d4/W6 SLAY2 vf.json` | 12 | vf / Kasperinos(11)warz(1): 3 |
| `ctc/s2/d4/W7 Mi2 SLAY.json` | 9 | SLAY / Kebjin: 6 |
| `ctc/s2/d4/W9 SN SLAY2.json` | 11, 12 | SLAY / half pint: 3 each |
| `ctc/s2/d5/W8 chid G25.json` | 12 | G25 / CT Inter: 3 |

## Substitution Overlap: Manual Review Required

These races contain two unplaced score rows for the same team, including a row
marked `subbed_out`. They must not automatically become two missing-player point
awards.

| File | Race(s) | Details |
| --- | --- | --- |
| `ctc/s1/d1_2/W8 Mi sts.json` | 7, 8 | gakpo/Merc: 3 and `#gakpo`: 3 |
| `ctc/s1/d4/W9 u vf.json` | 8 | Panko/warz: 3 and `#vf TX`: 3 |

## Impossible Race Scores: Manual Review Required

These values exceed the maximum score available in one race. They are likely GP
totals or parser alignment errors and should not be accepted as race points.

| File | Race | Unplaced value |
| --- | --- | --- |
| `ctc/s1/d4/W9 u vf.json` | 9 | vf / Panko/warz: 16 |
| `ctc/s2/d4/W3 Cy Mi2.json` | 9 | Cy / Inspector Gadget: 26 |
| `ctc/s2/d4/W9 vf Mi2.json` | 9 | vf / Rhydr: 23 |

## Detection Rule

For each race index from zero through `races_played - 1`:

1. Count players whose `race_positions[index]` is an integer greater than zero.
2. Find players whose `race_scores[index]` is nonzero while
   `race_positions[index]` is `null` or absent.
3. Report the race when both an unplaced score exists and fewer than 10 players
   have positions.

Important exclusions:

- Ignore array entries beyond `races_played`; some source files contain trailing
  aggregate data.
- Do not treat a zero score with no position as a missing result by itself.
- Flag scores greater than 15 rather than importing them automatically.
- Flag overlapping `subbed_out` rows rather than counting both scores.

## Editor Handling

The JSON editor preserves nonzero score/null-position rows as known-player
disconnect results. Their points remain attached to that player without inventing
a placement. The operator can also create these results intentionally.

For a team that starts with four players or continues with four after an
unreplaced disconnect, the editor creates a team-level missing-player result with
a reason. Those points count toward the team and race differential without
creating a fake player identity or occupying a finishing position.

The importer and editor recognize the literal `Missing Player` composite in
`W4 u Nw.json` and normalize its final two scores as team results. They are not
counted in `smu`'s individual total or analytics.

Before database ingestion, the three impossible-score races and the three
substitution-overlap races should be resolved against the original table or match
recording.
