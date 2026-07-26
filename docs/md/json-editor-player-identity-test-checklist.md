# JSON Editor Player Identity UI Test Checklist

Use this checklist to verify the team roster pool and existing-player identity
mapping features through the browser.

Unless a test explicitly says to upload, use a disposable match and stop after
database preview. Tests 12 and 13 intentionally write records and should normally
be performed against the local development database.

## 1. Automatic Friend-Code Checking

- [x] Enter a valid friend code that already exists in the database.
- [x] Confirm it automatically displays `Confirmed: [canonical name]`.
- [x] Confirm there is no manual **Check database** button.
- [x] Enter an unknown but correctly formatted friend code.
- [x] Confirm it automatically reports that approval is required.
- [x] Change a confirmed player's friend code to an unknown valid friend code.
- [x] Confirm the player card remains in the same lineup position while its
      verification status changes.
- [x] Enter an incorrectly formatted friend code.
- [x] Confirm validation reports the invalid friend code.

## 2. Team Roster Pool Availability

- [x] Select a valid league, season, and division.
- [x] Select a team known to exist in that exact scope.
- [x] Confirm **Team roster pool** appears in the team's card.
- [x] Change the metadata to an invalid scope.
- [x] Confirm the roster pool disappears.
- [x] Change the team tag to an unknown team.
- [x] Confirm the roster pool does not appear.

## 3. Team Roster Pool Contents

- [x] Expand the roster pool.
- [x] Confirm the listed players belong to the selected team, season, and division.
- [x] Confirm each available record displays its canonical name.
- [x] Confirm each available record displays its player ID.
- [x] Confirm each available record displays its most recently seen friend code.
- [x] Confirm the Mii name appears when it exists on the player-season entry.
- [x] For a roster with more than six players, confirm the roster filter works.

## 4. Adding a Roster Player

- [x] Click **Add to lineup** for an available player.
- [x] Confirm the player card receives the most recently seen friend code.
- [x] Confirm the lounge name is populated from the player-season entry.
- [x] Confirm the table name is populated from the stored lounge name.
- [x] Confirm the Mii name is populated from the player-season entry.
- [x] Confirm the flag is populated when one is recorded.
- [x] Confirm the player automatically displays as database-confirmed.
- [x] Confirm the roster option changes to **In match**.
- [x] Confirm the player becomes available in the Race Entry player pool.

## 5. Duplicate-Player Prevention

- [x] Attempt to add the same roster player twice.
- [x] Confirm the second addition is disabled or rejected.
- [x] Manually add another friend code that belongs to the same player.
- [x] Confirm validation prevents the same player entity from appearing twice in
      the match.
- [x] Confirm both affected player cards display an inline duplicate-player error
      instead of appearing database-confirmed.
- [x] Enter the exact same friend code on a new card and confirm that card displays
      an explicit inline friend-code conflict.

## 6. Removing and Moving Roster Players

- [x] Remove a player that was added through the roster pool.
- [x] Confirm the player disappears from the lineup.
- [x] Confirm the player disappears from the Race Entry player pool.
- [x] Reopen the team roster pool.
- [x] Confirm the removed player can be added again.
- [x] Add the player and use **Change Team**.
- [x] Confirm their names, friend code, flag, and race results remain intact.

### Unusual Team Assignment Warning

- [x] Add a database-confirmed player to a team other than the team recorded for
      that player in the selected league, season, and division.
- [x] Confirm validation names the player, their recorded team, and their current
      match team in a warning.
- [x] Generate the preview and confirm upload remains disabled until the warning
      acknowledgment checkbox is selected.
- [x] Confirm selecting the acknowledgment allows the rare legitimate assignment
      to be uploaded.
- [x] Move the player back to their recorded team and confirm the warning disappears.

## 7. Creating a Genuinely New Player

- [x] Manually add a valid friend code that has never appeared before.
- [x] Use a lounge name that does not exactly match an existing player.
- [x] Click **Review and Upload**.
- [x] Confirm the review entry offers **Create player**.
- [x] Confirm the review entry offers **Map to existing player**.
- [x] Confirm the review entry offers **Reject**.
- [x] Select **Create player**.
- [x] Confirm the match can proceed to database preview.
- [x] Do not perform the final upload for this test.

## 8. Mapping to an Existing Player

- [x] Add an unknown friend code and a new lounge name.
- [x] Open the new-entry review dialog.
- [x] Click **Map to existing player**.
- [x] Search using part of an existing player's canonical name.
- [x] Confirm results display canonical name, player ID, and known friend codes.
- [x] Select the intended player.
- [x] Confirm the proposal changes to **Approve link**.
- [x] Approve the link.
- [x] Confirm the match can proceed to database preview.
- [x] Do not perform the final upload for this test.

## 9. Searching by Player ID

- [x] Begin the mapping workflow for an unknown friend code.
- [x] Search using only an exact numeric player ID.
- [x] Confirm the correct player appears.
- [x] Select and approve the player.
- [x] Confirm the selected player ID appears in the reviewed link.

## 10. Changing or Cancelling a Mapping

- [x] Map an unknown friend code to an existing player.
- [x] Click **Map to different player**.
- [x] Select a different player.
- [x] Confirm the proposed player and approval entry change.
- [x] Click **Create new player instead**.
- [x] Confirm the entry returns to the new-player workflow.
- [x] Select **Reject**.
- [x] Confirm preview remains blocked while the entry is rejected.

## 11. Resolving an Identity Conflict

- [x] Use a lounge name known to match multiple historical players, if one is
      available.
- [x] Confirm ordinary approval is blocked for the conflicting identity.
- [x] Search for and select the correct existing player.
- [x] Confirm the conflict becomes an approvable player link.
- [x] Approve the link and confirm preview becomes available.

## 12. Existing Player in a New Team/Season Scope

This test intentionally writes to the database.

- [ ] Use the local development database.
- [ ] Map a new friend code to a player who has not appeared for the selected team
      and season.
- [ ] Approve the link and complete the final upload.
- [ ] Open **Alias Management** and select that player.
- [ ] Confirm the player ID did not change.
- [ ] Confirm the new friend code appears.
- [ ] Confirm the new lounge, table, and Mii names appear as aliases.
- [ ] Confirm a new player-season entry exists for the selected team and scope.
- [ ] Confirm no duplicate player entity was created.

## 13. Existing Player Already in the Same Scope

This test intentionally writes to the database.

- [ ] Use the local development database.
- [ ] Map a new friend code to a player already recorded for the exact team,
      season, and division.
- [ ] Approve the link and complete the final upload.
- [ ] Open **Alias Management** and select that player.
- [ ] Confirm the player ID did not change.
- [ ] Confirm the new friend code appears.
- [ ] Confirm the new names appear as aliases.
- [ ] Confirm the existing player-season entry contains the latest names and flag.
- [ ] Confirm no duplicate player-season entry was created.

## 14. Editor State Resets

- [ ] Create an identity mapping and then remove that player before previewing.
- [ ] Confirm the removed player's mapping does not appear during later review.
- [ ] Create an identity mapping and then change the player's friend code.
- [ ] Confirm the new friend code receives a fresh review entry.
- [ ] Click **Clear**.
- [ ] Confirm roster, identity, approval, and mapping state are reset.
- [ ] Load a different JSON file.
- [ ] Confirm no state from the previous file remains.

## Completion Record

- Tester:
- Date:
- Environment and URL:
- Branch or commit:
- Browser:
- Failed checklist items:
- Follow-up issues:
