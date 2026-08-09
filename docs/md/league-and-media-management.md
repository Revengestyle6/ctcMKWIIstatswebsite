# League and Media Management

The site currently supports `ctc` (Custom Track Cup) and `gsc` (Grand Star Cup).
The active league is application-wide, stored in the `league` query parameter and
remembered in versioned browser storage. Switching league preserves the current
route but clears season, division, match, team, opponent, and track selections so
identifiers from one league cannot leak into another.

## League configuration

`frontend/src/config/leagues.ts` is the single runtime catalog for league names,
descriptions, track-pool type, logo paths, theme colors, backgrounds, and optional
broadcast links. `frontend/media-manifest.json` is the single inventory of expected
background and shared-audio counts. Run `npm run verify:media` after changing media.

The provider in `frontend/src/context/LeagueContext.tsx` applies the league theme,
page metadata, favicon, URL state, and league-aware link construction. Public API
requests include `league`; the backend defaults omitted values to `ctc` for older
clients and always scopes analytics through `seasons.league_code`.

The JSON editor also derives its locked **League** metadata from this provider.
New drafts, cleared drafts, and uploaded JSON use the current site league. Review
queue submissions navigate to the league recorded in the submitted match before
opening the editor, preventing review data from being relabeled accidentally.

Track catalogs are isolated by league. The race editor downloads league ownership
in one catalog request, exposes only the active league in autocomplete, and uses
the hidden opposite-league entries for immediate conflict validation. Existing CTC
tracks cannot be approved in GSC and vice versa, including matches through known
aliases. A genuinely unknown track follows the ordinary new-entry approval flow
and is permanently assigned to the match's league when imported.

## Media layout

```text
frontend/public/media/
├── leagues/
│   ├── ctc/
│   │   ├── branding/logo.webp
│   │   └── backgrounds/001.webp ... 343.webp
│   └── gsc/
│       ├── branding/logo.webp and branding/favicon.png
│       └── backgrounds/001.webp ...
├── shared/
│   ├── site-icon.svg
│   └── team-logo-placeholder.svg
└── audio/shared/track-01.mp3 ... track-17.mp3
```

League branding and slideshow images are deployed with the frontend. Uploaded team
logos remain in the dedicated media bucket because they are administrator-managed,
mutable content. Firebase Hosting applies a one-day public cache header to
`/media/**`; filenames should change when the bytes of a long-lived branding asset
change if immediate cache invalidation is required.

## Adding the GSC media

1. Export the transparent GSC logo as
   `frontend/public/media/leagues/gsc/branding/logo.webp`.
2. Export base-game backgrounds as WebP files named sequentially `001.webp`,
   `002.webp`, and so on under `frontend/public/media/leagues/gsc/backgrounds/`.
3. Set `gsc.backgroundCount` and `gsc.requireLogo` in
   `frontend/media-manifest.json`.
4. Run `npm run verify:media`, `npm run check`, and `npm run build` from `frontend/`.

The full logo is used for page branding. GSC also has a browser-safe, transparent
64×64 PNG at `branding/favicon.png`; keeping the small tab asset separate avoids
browser inconsistencies with the full-resolution source image. If the full logo is
unavailable, page branding falls back to the league's text label and theme styling.

## Team identity across leagues

Players are already global people, so participation in both leagues does not create
separate player analytics identities. Teams are also capable of sharing one global
identity, but the link is explicit: **Alias Management → Teams → Identity → League
identity links** maps a tag in one league to the selected canonical team.

An equal raw tag in CTC and GSC is not proof that the teams are the same. Without an
explicit GSC link, the first GSC import creates a separate team. Add the GSC link
before that first import when the organization is known to be the same. The
`team_league_identities` table enforces one owner for a tag within a league while
allowing equal tags in different leagues to remain separate.
