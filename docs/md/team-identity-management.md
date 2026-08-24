# Team Identity Management

Administrators manage team names and tags from **Alias Management → Teams →
Identity**. Team identity has three levels:

- **Canonical identity:** `teams.canonical_name` and `teams.canonical_tag`, which
  automatically follow the newest season identity unless a manual override is active.
- **Season identity:** each existing `team_season_entries.display_name` and
  `team_season_entries.clan_tag`, scoped to one season and division.
- **League identity link:** an import tag scoped to one league that explicitly maps
  that league's source data to the global team.

Season-specific dashboards display the matching season entry. Career scope uses
the latest season entry as context while retaining the canonical identity.
When a requested season has no entry, the conventional identity is the fallback.
Imported season names that merely repeat their tag are also treated as placeholders
and fall back to the conventional name. A genuinely distinct season name remains
the primary dashboard label, with the conventional identity shown underneath.

## Editing Rules

- Names and tags are required; names allow up to 200 characters and tags up to 64.
- Canonical tags are display metadata and can match on separate global teams.
  Managed aliases remain global and cannot collide with another team's alias.
- League identity tags are unique case-insensitively within a league. Matching tags
  in different leagues remain separate unless an administrator links both to the
  same global team.
- With no league preference, the newest recorded season identity across CTC and
  GSC supplies the canonical name and tag. A CTC or GSC preference limits that
  choice to the newest identity in that league, falling back to the newest overall
  identity when the preferred league has no entries.
- A manual canonical-identity override retains the current name and tag. Manual
  canonical edits require the override, just like player canonical-name edits.
- Changing an automatic or manually overridden canonical tag records the previous
  canonical tag as an alias when it does not conflict with another team.
- Season tags are unique case-insensitively within their season and division.
- Editing one season entry does not modify another season. It updates the canonical
  identity when that entry wins the automatic preference rule.
- A source JSON tag should be registered under League identity links. The general
  Aliases tab remains available for intentional global spelling variants.
- The UI edits existing participation entries; match import remains responsible
  for creating a team's first entry in a new season/division.

Imports first resolve `(league_code, raw tag)` through `team_league_identities`, then
reuse an existing season entry by stable `team_id`, season, and division
before considering its mutable tag. This prevents a later upload from creating a
duplicate entry after an administrator changes a season display tag.

All identity changes require administrator authentication, produce audit events,
and clear cached dashboard responses.

## Team Merging

**Alias Management → Teams** can review and merge a source team into a destination
team. The review shows both identity histories and the affected aliases, league
links, season entries, player memberships, matches, playoff entries, and logos.
The merge:

- keeps the destination team ID, league preference, and override setting;
- moves distinct aliases, league identity links, season identities, and logos;
- repoints season-linked player and match history and playoff participants;
- consolidates entries occupying the same season and division, with the
  destination season identity winning; and
- recalculates the destination canonical identity unless its override is enabled.

A merge is blocked when both records appear in the same match or as participants
in the same playoff series. This prevents teams that genuinely competed against
each other from being collapsed accidentally. Every completed merge is audited as
`team.merged`.

The administrator endpoints are:

- `GET /api/admin/aliases/teams/{source_id}/merge-comparison`
- `POST /api/admin/aliases/teams/{source_id}/merge`
- `PATCH /api/admin/teams/{team_id}/canonical-league-preference`
- `PATCH /api/admin/teams/{team_id}/canonical-identity-override`
