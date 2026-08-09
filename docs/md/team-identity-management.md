# Team Identity Management

Administrators manage team names and tags from **Alias Management → Teams →
Identity**. Team identity has two levels:

- **Conventional identity:** the stable `teams.canonical_name` and
  `teams.canonical_tag` used for career-level identity and cross-season lookup.
- **Season identity:** each existing `team_season_entries.display_name` and
  `team_season_entries.clan_tag`, scoped to one season and division.

Season-specific dashboards display the matching season entry. Career scope uses
the latest season entry as context while retaining the conventional identity.
When a requested season has no entry, the conventional identity is the fallback.
Imported season names that merely repeat their tag are also treated as placeholders
and fall back to the conventional name. A genuinely distinct season name remains
the primary dashboard label, with the conventional identity shown underneath.

## Editing Rules

- Names and tags are required; names allow up to 200 characters and tags up to 64.
- Canonical tags are unique case-insensitively across teams and cannot collide
  with another team's managed alias.
- Changing a canonical tag automatically records the previous canonical tag as
  an alias, so future imports using the old tag still resolve to the same team.
- Season tags are unique case-insensitively within their season and division.
- Editing one season entry does not modify the conventional identity or another
  season.
- A season display tag that also occurs in source JSON must be registered in the
  team's Aliases tab. Aliases provide import resolution and remain globally unique;
  season display tags are presentation metadata scoped to a division.
- The UI edits existing participation entries; match import remains responsible
  for creating a team's first entry in a new season/division.

Imports reuse an existing season entry by stable `team_id`, season, and division
before considering its mutable tag. This prevents a later upload from creating a
duplicate entry after an administrator changes a season display tag.

All identity changes require administrator authentication, produce audit events,
and clear cached dashboard responses.
