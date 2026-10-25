# JayZ identity diagnosis

Investigated October 12, 2026 using read-only queries against `ctc_staging`,
the database behind the public site, and the application's read-only merge
comparison. No live data was changed.

## Finding

Team 117 is an orphan duplicate created while importing the same GSC S15 D3
team represented by team 113. The ASCII `a` and Greek `α` spellings were
registered as separate league identities.

| Record | Team 113 | Team 117 |
| --- | --- | --- |
| Canonical name | Dinner with JayZ | JαyZ |
| Current canonical tag | JαyZ | JαyZ |
| GSC league identity | JayZ (identity 129) | JαyZ (identity 135) |
| Season entries | GSC S15 D3, entry 189 | None |
| Match appearances | 10 | None |
| Player memberships | Existing roster | None |
| Logos / playoff participation | Preserved with team 113 | None |

## Provenance

All events below occurred September 22, 2026; times are America/New_York.

1. 12:26 PM: `team.created` created team 113 as Dinner with JayZ, tag `JayZ`.
   Entry 189 was then registered in GSC S15 D3 with that tag.
2. 12:40 PM: `team.season_identity_updated` changed entry 189's tag from
   `JayZ` to `JαyZ`. The league identity remained `JayZ`.
3. 12:52 PM: acceptance of match 811, `M1 @sglc vs JαyZ`, logged creation
   of team 117 and GSC identity 135. Database addition logs 2220 and 2221
   identify these additions explicitly.
4. Match 811 and the nine other current regular-season matches are attached
   to entry 189/team 113. Team 117 has no competing history.

The older importer loaded league identities and global aliases without season
entry aliases. It therefore created a team for the unmatched Greek-alpha tag.
Its subsequent season-entry lookup reused entry 189 by division and tag,
without checking that the entry belonged to the newly created canonical team.
This left the new team and league identity orphaned.

The recent preview selected team 113 from the season entry, then attempted to
register its `JαyZ` league identity. Identity 135 already owned that tag on team
117, causing the unique-constraint failure. This is an identity split, not a
Greek-alpha lowercase conversion error.

## Proposed repair

Merge source team **117** into target team **113** using the existing audited
team-merge operation. The read-only comparison reports:

- One league identity to move: identity 135, GSC `JαyZ`.
- No season entries, match appearances, player memberships, aliases, logos,
  or playoff participants to move from team 117.
- No overlapping matches, overlapping series, or merge blockers.

The resulting team 113 would own both GSC spellings, `JayZ` and `JαyZ`, while
retaining entry 189 and all ten existing matches. The temporary importer bypass was removed after this diagnosis confirmed an
orphan duplicate. The importer continues enforcing league identity ownership;
the proposed merge addresses the underlying data conflict. The proposed live
merge has not been performed.
