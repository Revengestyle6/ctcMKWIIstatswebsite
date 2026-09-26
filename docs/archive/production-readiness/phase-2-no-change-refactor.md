# Phase 2 No-Change Refactor

- Completed: July 19, 2026
- Outcome: behavior-preserving application refactor complete; ready for Phase 3

## Organization And Readability

- Replaced the monolithic Flask entry point with an application factory, extension
  module, public/admin blueprints, and shared request helpers.
- Split catalog and match-detail queries from legacy-compatible analytics.
- Split player and team dashboard analytics behind the existing compatibility
  facade.
- Split match-history rendering from route state and data loading.
- Split JSON editor validation and upload contracts from the stateful editor UI.
- Applied Ruff and Biome formatting across maintained Python and frontend source.

## Speed And Bloat

- Lazy-loaded every frontend route and the global music player. Heavy editor,
  health, and match-history code is no longer part of every route's initial chunk.
- Centralized frontend JSON request and error handling.
- Removed Terser and build-time gzip plugins in favor of Vite's faster built-in
  minifier, eliminating 18 development packages.
- Updated the resolved frontend dependency tree to patched React Router, Vite,
  Rollup, PostCSS, and React plugin releases; both production and full-tree npm
  audits report zero known vulnerabilities.
- Removed Node, curl, and unused frontend output from the API image; added a
  non-root runtime user and cacheable dependency layer.
- Reduced the measured Docker image from 269,231,325 bytes to 70,729,759 bytes
  (73.7%). The build context fell from 104.04 MB to 378.37 kB.

## Reproducible Checks

- Added pinned Ruff and Biome configuration plus explicit check/format commands.
- Added backend formatting, linting, tests, fixtures, and frontend checks to the
  transitional deployment workflow before publishing.
- Kept Phase 0 fixtures and screenshots immutable.

## Verification

- Ruff lint and format checks passed.
- Biome lint/format and strict TypeScript checks passed.
- All 62 backend unit tests passed.
- All 17 Phase 0 API fixtures matched exactly.
- The Vite production build passed with route-specific chunks.
- All 20 Playwright desktop/mobile route smoke tests passed.
- A clean npm security audit passed with zero known vulnerabilities.
- The optimized Docker image built, imported 244 matches and 268 players, returned
  HTTP 200 from `/api/seasons`, and ran as UID/GID `app` rather than root.

Phase 3 remains responsible for PostgreSQL/Alembic, durable object storage,
Firebase administrator authentication, same-origin production API routing,
portable health queries, production-safe errors, request IDs, and structured logs.
