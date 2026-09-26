# Mario Kart Wii competition statistics

The project records league matches, resolves the people and teams behind their
historical names, and compares competitive results across seasons.

## Language

### Competition

**League**: A competition with its own seasons, team identities, and track catalog,
such as Custom Track Cup (CTC) or Grand Star Cup (GSC).

**Season**: One edition of a league's competition. A season code identifies an
edition within its league, not across all leagues.

**Division**: A competitive grouping within a season. Historical combined
divisions are distinct groupings, not aliases for either individual division.

**Conference**: One of the two team groupings in a conference-based division.

**Match**: A contest between two teams, recorded either as played races with any
penalties or as an awarded result without races. Historical source material can contain incomplete or malformed
contests that require review.
_Avoid_: War (except when quoting source material)

**Match number**: The positive number identifying a regular-season match in its
competition context; it is not a globally unique match identity.
_Avoid_: Week (when referring to the match number)

**Match label**: The human-readable description of a match, distinct from its
number and identity.

**Match set**: The selection of regular-season matches, playoff matches, or both
used for an analytics comparison.

**Playoff series**: An ordered best-of contest between two teams in a division's
semifinals or finals. Its individual matches are numbered within the series.

**Race**: One track played at a particular position in a match's race order.

**Track**: A named course in a league's catalog; a race is an occurrence of playing
that course.

### Identity and participation

**Player**: A person whose match history may span multiple friend codes and names.

**Friend code**: A twelve-digit game identifier used by a player. A player can
have multiple friend codes; a name alone does not establish identity.

**Canonical player name**: The chosen display name for a player across their
history, distinct from names observed in individual matches.

**Player alias**: An observed or reviewed name or external identifier associated
with a player, including lounge, table, Mii, and MKCentral names.

**Team**: A continuing team identity that can participate in multiple leagues and
seasons. Equal tags in different leagues do not establish that two teams are the
same identity.

**Team league identity**: The association of a team with the tag recognized in a
particular league.

**Team season entry**: A team's participation and presentation in a specific
season and division, including its season-specific name and tag.

**Player season entry**: A player's participation with a particular team season
entry. A player can have multiple entries when their participation changes.

**Roster**: The known player participation for a team season entry; it is not a
promise that every listed player appears in an individual match.

**Runner**: A player's racing role focused on finishing position and race points.

**Bagger**: A player's supporting race role, tracked separately from the runner
role. A low or zero score alone does not establish this role.

**Disconnection award**: Points credited for a race without a recorded finishing
position, distinct from an absent substitute who did not participate.

**Missing-player award**: Points credited to a team for a missing participant,
without assigning those points to a named player's race result.

**Special result**: A regular-season match recorded without played races: a free
win awards 150–0, and a mutual tie records 0–0.

### Match review

**Match document**: The recorded metadata, teams, players, and ordered race facts
for one match, before or after review.

**Review submission**: A proposed match document awaiting an administrator's
decision. Submission does not mean the match has been accepted.

**Entry approval**: An explicit decision about a proposed catalog addition or
identity link. A preview can explore the decision; only administrator acceptance
admits it to the statistics record.

**Accepted match**: A match admitted to the statistics record by an administrator.

**Accepted archive**: The durable audit record of accepted match documents.
_Avoid_: Review queue, temporary submission storage

**Health finding**: A detected integrity or data-quality concern in the statistics
record. Dismissing a finding records a review decision; it does not repair data.
