# Feature Wishlist

This document captures larger product ideas that would build on the current stats database and frontend.

## 1. Match History Catalog

Goal: create a browsable match archive.

Basic flow:

1. Select season.
2. Select division.
3. Filter matches by team and other useful criteria.
4. Open a match detail page.

Possible filters:

- team
- week
- match date, if/when available
- track
- player
- source file/import status
- matches needing review
- close matches or blowouts
- penalty/no-penalty matches

Each match page should include:

- full war table
- season, division, week, and match label
- teams, final scores, penalties, and score difference
- track list in race order
- player scores, GP scores, race scores, and total scores
- player friend codes used in that match
- player run/bag status for each race, once that data is available
- source metadata, such as JSON file/source table refs/import notes
- links to team pages and player pages

This feature should make it easy to answer: “What happened in this war?” and “Where did this stat come from?”

## 2. Full Season/Team Catalog

Goal: create a season-specific team hub.

Basic flow:

1. Select season.
2. Select division.
3. Select team.
4. View the team page.

Team page content:

- team logo
- team name and clan tag
- season/division context
- team color
- full roster
- player names
- player friend codes
- player season averages
- races played
- team-wide average and record-style summary, if available
- top tracks and worst tracks
- most-used lineup or roster participation notes
- links to every match the team played that season

The match links should point into the Match History Catalog.

This page should make it easy to answer: “Who played for this team this season?” and “How did this team perform?”

## 3. Match JSON Editor

Goal: build an editor for creating, validating, and eventually submitting match JSON.

Initial version:

- upload an existing JSON file as a starting point
- allow starting from an empty form
- prefill the UI from uploaded JSON when provided
- edit all required match fields
- download the finished JSON
- preview the compiled JSON through the same SQL importer and Match History table renderer without committing database changes

Editable match fields:

- league
- season
- division
- week or match label
- number of races
- teams involved
- team tags, names, colors, scores, and penalties
- players involved
- player friend codes
- player lounge names, table names, Mii names, and flags
- player scores per race
- player positions per race
- GP scores
- player penalties
- team penalties
- tracks played per race
- player run/bag status per race
- table references/source refs
- review notes or import notes

Validation should catch:

- missing required fields
- missing or invalid week number
- malformed friend codes
- duplicate friend codes in the same match
- race count mismatches
- score/position length mismatches
- team total mismatches
- player total mismatches
- penalties not reflected in final scores
- unknown or duplicate tracks
- unresolved team aliases
- unresolved player identity issues

Unknown seasons, divisions, season/division team entries, player friend codes,
and tracks enter an explicit approval workflow instead of failing immediately.
The editor lists each proposed database addition with Approve and Reject
controls, and every item must be approved before preview or final ingestion.
Team proposals explicitly distinguish reusing an existing global team for a
new season/division from creating a completely new team, including a warning
when an unknown tag could be an unregistered alias.
The backend repeats this check against the submitted match so client-side state
cannot bypass it. Preview approvals create records only inside the rollback-only
preview transaction; final ingestion will reuse the same contract and persist
them only when the complete import commits successfully.

Implemented ingestion workflow:

- upload/import the finalized JSON directly from the app
- write the exact compiled JSON to
  `backend/JSON/{league}/{season}/{division}/{filename}.json`, creating missing
  directories as necessary
- use configured shared storage in production while preserving the same logical
  league/season/division archive layout
- ingest it into the database
- refresh analytics immediately
- show import success/failure details
- flag matches needing review instead of silently accepting questionable data
- display a live stream of committed database additions

Preview imports run inside a rollback-only database transaction. The backend
imports and serializes the match normally, returns the Match History detail
payload, and rolls back every inserted or updated row before responding. Final
submission reruns the same import in a new transaction and commits only after
server-side validation succeeds.

The editor now provides Discard Preview and Confirm Upload controls. Confirmed
uploads archive the canonical JSON, commit normalized records, return the new
match ID, and publish durable addition events. Exact retries return the existing
match rather than creating another one.

The upload workflow starts from `Review & Upload` in the Validation section.
The action is disabled until all red data errors are resolved; reviewable new
database entries remain amber and are handled by the approval dialog.

Permanent upload must coordinate the JSON archive and database carefully because
filesystem and SQL writes cannot share one atomic transaction. The proposed
staging, duplicate protection, recovery checks, confirmation UI, and ordered
implementation steps are documented in
[Match Upload And JSON Archive Implementation Plan](../archive/implementation-plans/match-upload-implementation-plan.md).

Longer-term goal:

Use this as the live workflow for next season. A user enters or uploads a completed match JSON, fills in any metadata that is not present in the JSON, submits it, and the site updates analytics live.

Recommended next work: add session-based administrator authentication and an
audited correction/replacement workflow, then configure shared persistent JSON
storage and optional Git synchronization for production.
