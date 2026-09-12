# Design audit and UI conventions

## Scope

This upgrade follows the Apple design skill's emphasis on clarity, deference to
content, predictable interaction, and restraint. It is a web analytics interface,
not an imitation of an operating system. Existing league logos, game imagery, team
colors, war-table formats, and statistical content retain the site's identity.

Reviewed surfaces: home, standings, player/team directories and dashboards, match
history, all four legacy analytics pages, JSON editor, administrator access,
database management, review queue, and database health. Desktop and mobile route
checks complement visual inspection of representative populated pages. Restricted
workflows use mocked administrator sessions and mutations for browser testing;
this is not a production sign-in or data-write verification.

## Findings and implemented changes

| Area | Finding | Implemented response |
| --- | --- | --- |
| Navigation | Moving between sections depended on returning home; page headers repeated navigation code. | One persistent, league-aware header with current-page indicators. Competition destinations stay directly visible; analytics and tools use labeled disclosures. Admin pages have a shared secondary navigation. |
| Home | Nested cards, a large repeated league selector, and competing sections made every destination similarly prominent. | One clear standings action, grouped descriptive link rows, and a shorter introduction. All existing destinations remain. |
| Visual hierarchy | Rotating full-screen imagery, bright table headers, mixed form colors, shadows, and overlapping header treatments competed with statistics. | Static low-opacity league artwork, quiet opaque content surfaces, system typography, consistent controls, and selective league-accent emphasis. |
| Standings | Long sections were hard to reach; the grid could expand beyond a narrow viewport. | Section links for league table, head-to-head, player averages, and playoffs; explicit one-column mobile grid; wide tables scroll within their own containers. |
| Directories | Minimum-width tables made basic discovery cumbersome on phones; dashboard links were less prominent than names. | Responsive tables, linked player/team names, larger Open targets, descriptive search placeholders, and result counts. Friend codes remain visible under player names on mobile. |
| Dashboards | Repeated branding and individually boxed metrics made a dense analytical page feel fragmented. | Shared title, identity, scope filters, results area, and a grouped metric strip. Existing tabs, filters, charts, and calculations stay in place. |
| Analytics | Legacy pages had different headers, spacing, and bright input controls. | Shared page heading aligned with each content container, shared filter panels, season/division controls, and segmented toggles. All existing analytics modes remain. |
| Music and broadcast | A first-visit music prompt interrupted the user's task; floating controls depended on hover. | Music stays available in an explicit keyboard/touch-accessible header disclosure, silent and unloaded until requested. Twitch remains available in a collapsed section, without autoplay. |
| Administration | Repeated back links did not communicate the relationship between management areas. | Shared administration navigation and consistent surfaces/forms. Existing validation, approval, confirmation, and permissions behavior is preserved. Dialog overlays remain above the header. |
| Accessibility | Page context, control IDs, focus, and motion handling were inconsistent. | Page-specific document titles, a skip link, visible focus, unique season/division IDs, keyboard-operable menus with Escape dismissal, dashboard state announcements, and reduced-motion/transparency/greater-contrast styles. |
| Maintainability | Similar presentation code was repeated across pages. | A single navigation catalog, shared header and page heading, shared surface/filter/metric/control styles, and removal of obsolete header, back-link, slideshow, and home-selector components. No new dependencies. |

## Patterns for future analytics

- Register new destinations in `frontend/src/config/navigation.ts`; the home directory
  and header share that catalog. Keep the primary navigation short. Add specialized
  analytics within the Analytics group or an existing dashboard, rather than another
  top-level button for each metric.
- Use `PageHeader` for a page title and optional explanation. Use `DashboardShell`
  for identity-centric views. Put headings inside the same width container as their
  content. Avoid additional fixed headers.
- Use `.filter-panel`, `SeasonDivisionSelector`, `MatchSetToggle`, and `RoleModeToggle`
  where appropriate. Scope controls should precede the results they affect. Keep URL
  and API semantics in the existing controllers, separate from presentation.
- Use `.ui-surface`, `.table-heading`, and `MetricGrid` with the tokens in `index.css`.
  Prefer spacing and dividers to nested cards. Reserve accent color for selection and
  action; retain meaningful team colors and positive/negative result distinctions.
- Add a graph only when it answers a distinct question. Label units, scope, and
  missing-data states. Preserve access to exact values and existing table views;
  do not make essential information hover-only or color-only.
- Keep dense tables locally scrollable, not the entire page. Do not remove data
  columns solely to fit a phone. Directories can rearrange metadata while retaining
  its content. Check narrow widths and long names with real data.
- Use native links, buttons, selects, and disclosures before introducing another
  library. Keep code route-split; load media only when appropriate. New motion must
  communicate a state change and respect reduced motion. No decorative spring or
  scroll animations were added in this upgrade.
- Preserve overlay stacking: page containers must not introduce a stacking context
  that traps modal dialogs below `SiteHeader`. Check confirmation controls on mobile.

## Guardrails and validation

Backend code, data models, canonical identities, statistical formulas, requests and
response contracts, authentication, Firebase configuration, deployment files, and
dependencies are unchanged by this UI upgrade. No migration or deployment is part
of the work. Existing dev servers were reused; no extra application ports were opened.

Biome/TypeScript checks and the production frontend build passed. All 78
desktop/mobile Playwright smoke checks passed. New coverage checks navigation menus and
league context, optional music controls, standings section links/viewport fit, and
administrative dialog layering. Existing checks exercise league switching,
competition status, filters, JSON validation/editing, and mocked review submissions.
The match-label assertion accepts both historical W and current M numbering.

Representative visual checks at 1440px and 390px cover home, standings, directory,
team dashboard, matches, player statistics, JSON editor, and administrator access.
Wide analytical tables intentionally retain horizontal scrolling within a container.
Historical Phase 0 screenshot baselines are not overwritten.

## Deliberately not expanded

- No new charts, metrics, search backend, onboarding wizard, theme picker, animation
  library, or icon library.
- No removal or merging of legacy analytics routes with newer dashboards. That
  requires a separate feature-parity assessment, not just a visual judgment.
- No rewrite of dense editor or administration workflows. Their existing safety
  steps and domain-specific controls take priority over cosmetic simplification.
- This is not a complete WCAG certification or a claim of cross-browser coverage.
  Follow-up accessibility testing should include screen readers, existing modal
  focus trapping, chart alternatives, custom team-color contrast, and Safari/iOS.
  A production smoke check with real authorized accounts remains appropriate after
  the normal deployment process; destructive workflows should use test data.
