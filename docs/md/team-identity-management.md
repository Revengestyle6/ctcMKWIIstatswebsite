# Team Identity Management

Administrators manage team names and tags from **Alias Management → Teams →
Identity**. Team identity has three levels:

- **Conventional identity:** the stable `teams.canonical_name` and
  `teams.canonical_tag` used for career-level identity and cross-season lookup.
- **Season identity:** each existing `team_season_entries.display_name` and
  `team_season_entries.clan_tag`, scoped to one season and division.
- **League identity link:** an import tag scoped to one league that explicitly maps
  that league's source data to the global team.

Season-specific dashboards display the matching season entry. Career scope uses
the latest season entry as context while retaining the conventional identity.
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
- Changing a canonical tag automatically records the previous canonical tag as
  an alias, so future imports using the old tag still resolve to the same team.
- Season tags are unique case-insensitively within their season and division.
- Editing one season entry does not modify the conventional identity or another
  season.
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
