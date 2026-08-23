# MKCentral Player Name Synchronization

## Purpose

MKCentral is the preferred source for a player's current canonical display name.
The application resolves an MKW friend code through:

```text
GET https://mkcentral.com/api/registry/players?friend_code={friend_code}&detailed=true
```

Every profile learned from MKCentral is retained as both a typed `mkc_name` alias
and a typed `mkc_id` alias. The ID is the durable identity signal; names are not
unique on MKCentral. The latest MKCentral name normally has the highest automatic
canonical-name priority, while a per-player override lets an administrator
deliberately keep a manual canonical name without discarding MKCentral history.

MKCentral sometimes returns multiple apparent names in one `name` field, separated
by `|` or `/`. The raw value, including every separator, is always the stored
`mkc_name` alias and is the value used to decide whether MKCentral changed. During
refresh review, each non-empty trimmed segment and the complete raw value are
offered as canonical-name choices. Keeping the complete value covers cases where a
slash or pipe is genuinely part of one name.

## Data Model

`players.canonical_name_override` is a non-null boolean and defaults to `false` for
new and existing players.

- `false`: automatic priority is active. The newest `mkc_name` alias becomes the
  canonical name. If there is no MKCentral alias, the current canonical name and
  the existing JSON-derived fallback behavior remain unchanged.
- `true`: the current canonical name is retained when the override is enabled and
  can thereafter be changed only through the manual canonical-name control.
  MKCentral refreshes still add new `mkc_name` aliases.

`player_aliases.created_at` records when an alias was first entered, while
`last_observed_at` records the latest time the same value was observed. Existing
aliases are backfilled from their first-seen match timestamp where possible, then
from migration time. The uniqueness key remains `(player_id, alias_type,
alias_value)`, so seeing the same value again does not reset its first-entry time.
Automatic MKCentral priority uses `last_observed_at`, which correctly handles a
player changing from name A to B and later returning to A.

In addition to the existing `lounge_name`, `mii_name`, and `table_name` types:

- `mkc_name` stores every distinct name returned by MKCentral.
- `mkc_id` stores every distinct numeric profile ID returned by MKCentral. It is
  represented as an alias string so it receives the same first-entered and
  last-observed timestamps and remains visible in Alias Management.
- `canonical_name` stores a displaced canonical name. This applies both when an
  automatic MKCentral update replaces it and when an administrator manually
  replaces it.

`mkc_refresh_previews` stores bulk and individual review snapshots for 24 hours.
It contains the proposed results and summary, request/apply administrator IDs,
status, and decision timestamps. This makes refresh approval explicit and
auditable without changing player records during the request phase.

## Lookup Rules

Friend codes are attempted from most recently used to least recently used. Recency
uses `player_friend_codes.last_seen_match_id`, with the newest friend-code row as a
fallback when no match sighting exists. Lookup stops at the first valid profile.

Although the endpoint normally returns one player, the client does not trust that
assumption. It accepts only a result whose `friend_codes` contains the exact query
value with type `mkw`:

- one exact result: `found`;
- a successful response with no exact result: `not_found`, meaning that friend
  code has no associated MKCentral profile;
- multiple exact results: `ambiguous`, requiring investigation;
- timeout, connection/HTTP failure, invalid JSON, or an invalid response shape:
  `lookup_failed`.

Transient `429` and `5xx` responses are retried with bounded backoff. Bulk refresh
uses a bounded worker pool. `MKC_API_TIMEOUT_SECONDS` defaults to 6 seconds per
request and `MKC_REFRESH_WORKERS` defaults to 8, capped at 16.

## JSON Editor And Acceptance

When an unknown friend code has no existing-player candidate, new-entry validation
queries MKCentral and explains one of these outcomes:

- the new friend code corresponds to a named MKCentral player;
- MKCentral answered successfully but has no profile for the code;
- the request could not be completed; or
- the response was ambiguous.

The lookup is informational and does not silently map the friend code to an
existing local player. Administrators still approve creation or explicitly map the
friend code using the existing identity workflow. Acceptance repeats validation
to prevent a stale preview from being trusted.

For an approved new player with a found profile, the importer:

1. creates the player and friend-code record;
2. stores the MKCentral name and profile ID as `mkc_name` and `mkc_id` aliases;
   and
3. uses that MKCentral name as the initial canonical name unless the shared-name
   rule below selects a lounge-name fallback.

If the successful lookup finds no profile, or if MKCentral is unavailable, the
existing JSON-derived initial name is used and the reported lookup outcome remains
visible during review.

## Alias Management Workflow

The Players tab provides `Refresh all MKC names`, and each player detail provides
an individual refresh action. Both use the same two-phase workflow:

1. Request all applicable profiles without modifying players.
2. Review totals for new, updated, unchanged, not-found, ambiguous, failed, and
   no-friend-code results, plus the players affected and proposed canonical names.
3. Optionally download the complete CSV report.
4. Reject the preview, or accept it to create aliases and apply eligible canonical
   changes in one transaction.

For a combined MKCentral name, the review panel requires no destructive parsing:
it displays the raw alias and lets the administrator select a separated name or
the complete value for canonical display. If a later refresh returns the same raw
MKCentral value, the result remains `unchanged` and the prior canonical selection
is retained. A different raw value is still classified as an MKCentral name
update, regardless of whether one separated segment happens to match the current
canonical name.

A preview is rejected during apply if it expired or if any included player's
canonical name, override setting, lounge name, MKCentral name history, or
MKCentral ID history changed after the preview. The administrator must refresh
again rather than apply stale decisions.

MKCentral names are not unique. When the current MKCentral name is shared by
multiple local player records, each non-overridden player uses their latest lounge
name as the automatic canonical name. The complete shared MKCentral name remains
stored as an alias, and each record retains its own MKCentral ID. A manual
canonical-name override still takes precedence. If the name stops being shared,
the normal MKCentral-name priority applies the next time canonical priority is
evaluated.

Enabling `Keep canonical name manual` retains the name currently displayed.
Disabling it immediately reapplies automatic priority, so the latest stored
MKCentral name becomes canonical when available. Manual canonical-name editing is
available only while the override is enabled.

The Friend codes section supports adding and removing MKW friend codes directly.
Codes must use `0000-0000-0000` format and remain globally unique: the API rejects
a code already attached to either the same player or another player, and the
database unique constraint remains the concurrency-safe final guard. Removing a
code requires an explicit confirmation because deletion is intended only for a
mistaken assignment. If the removed code was primary, the most recently used
remaining code becomes primary; if none remain, the primary friend code is cleared.
All additions and removals are audited.

### Merging duplicate player records

Any player can be merged into another player from the Players tab. Selecting a
destination opens a read-only comparison before any database change. The review
shows both player IDs, canonical names, override state, friend codes, aliases,
season/team entries, and counts of the historical rows that will move. `Reject`
closes the review without changing anything; `Confirm merge` applies the entire
merge in one transaction.

The destination record and its canonical-name override remain authoritative. If
automatic priority is active, it is reapplied after the aliases are combined; if
the override is active, the destination canonical name remains unchanged. The
source canonical name is retained as a `canonical_name` alias. Friend codes and
aliases move to the destination, exact duplicate aliases are consolidated with
their observation history preserved, overlapping player-season entries are
combined, and all match appearances and race results are repointed. The source
player is then permanently deleted. Pending individual MKCentral previews for the
removed source are rejected because they are no longer safe to apply.

A merge is blocked when both player records appear in the same match. In that
case, automatically combining them could turn two distinct match participants
into one identity, so the comparison names the conflicting match and disables
confirmation. Shared MKCentral names are strong review candidates but are never
merged automatically.

Database Health treats a shared normalized `mkc_name` as a dismissible warning,
because distinct MKCentral profiles may legitimately use the same name. A shared
`mkc_id` is a non-dismissible critical error because one MKCentral profile must
resolve to only one local player record. The player comparison and merge workflow
is the intended way to resolve a confirmed duplicate identity.

## API Surface

- `PATCH /api/admin/aliases/players/{player_id}/canonical-name-override`
- `POST /api/admin/aliases/players/{player_id}/friend-codes`
- `DELETE /api/admin/aliases/players/{player_id}/friend-codes/{friend_code_id}`
- `GET /api/admin/aliases/players/{player_id}/merge-comparison` with
  `target_player_id`
- `POST /api/admin/aliases/players/{player_id}/merge` with `target_player_id`
- `POST /api/admin/mkc-refresh-previews` with optional `player_id`
- `POST /api/admin/mkc-refresh-previews/{preview_id}/apply`, optionally with a
  `canonical_name_selections` object keyed by player ID
- `POST /api/admin/mkc-refresh-previews/{preview_id}/reject`

All endpoints require administrator authentication. Creating, accepting, and
rejecting previews, changing overrides, and completed player merges are written
to `admin_audit_logs`.

## Operations And Verification

Apply Alembic migrations `20260822_0009_mkc_player_names` and
`20260822_0010_alias_last_observed` before deploying the new backend. The backend
runtime includes `requests` for the outbound HTTPS client.

Important checks are covered in `backend/test_mkc_player_names.py`: recent-code
ordering, exact MKW filtering, empty successful responses, combined-name selection
and repeat detection, canonical override behavior, alias history, preview-only
non-mutation, and failure classification.
