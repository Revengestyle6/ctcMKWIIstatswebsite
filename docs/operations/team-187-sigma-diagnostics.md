# Team 187: uppercase sigma diagnosis

Investigation date: October 25, 2026 (America/New_York). Live evidence was read
from `ctc_staging` in read-only transactions. The code changes described below
are local working-tree changes, not deployment evidence. No live team identity
was changed during this investigation.

## Live identity and edit history

Zero Tolerance is team **187**, GSC S16 D2 season entry **347**. Its current
canonical and season tags are `ZE`; automatic canonical identity is enabled.
It still owns league identity **252**, `gsc / ZΣ`, and also owns league identity
**316**, `gsc / ZE`. Its global alias **56** is `ZΣ`.

Successful audit records establish this history:

| Audit ID | Event | UTC time |
| --- | --- | --- |
| 1289 | Created team 187 as `ZΣ` / Zero Tolerance | October 11, 2026, 19:37:47 |
| 1351 | Registered entry 347 as `ZΣ` in GSC S16 D2 | October 12, 2026, 03:08:24 |
| 1413 | Changed entry 347 from `ZΣ` to `ZE` | October 17, 2026, 12:07:04 |

The canonical tag followed the season edit, and the old spelling was preserved
as an alias. This was a stored identity edit, not a display font substituting
Latin E for Greek sigma. No conflicting owner of `gsc / ZΣ` was found. These
successful audit events do not record failed requests, so they cannot identify
every endpoint involved in the earlier reported failures.

## Reproduced cause

The application mixed three incompatible Unicode comparisons:

| Input | Python `lower()` | Python `casefold()` | Live PostgreSQL `lower()` |
| --- | --- | --- | --- |
| `ZΣ` | `zς` | `zσ` | `zσ` |
| `Zσ` | `zσ` | `zσ` | `zσ` |
| `Zς` | `zς` | `zσ` | `zς` |

Python's whole-string lowercasing applies contextual final-sigma rules.
Casefolding additionally collapses the two lowercase sigma forms. PostgreSQL's
existing `lower(...)` indexes in this database do neither of those things.

For example, the old identity lookup compared `lower(tag)` with the already
Python-lowercased input `ZΣ`. It searched for `zς` while the existing indexed
value was `zσ`. Missing that row caused an attempted duplicate insert and
`uq_team_league_identity_code_tag_ci` rejected it. Importing with an explicit
team ID still executed the broken league-identity existence check, so the ID
link alone could not prevent the duplicate insert.

The minimal pre-fix reproduction inserted one local `gsc / ZΣ` identity and
called `add_league_identity` for that same team and spelling. It raised a
PostgreSQL `UniqueViolation` instead of the expected validation error. The
same reproduction passes after the fix, without attempting a duplicate insert.

## Audit of previous fixes

- **`de7ea1ff`, September 26 — “Fixed casefold/lower inconsistency between
  backend and database.”** Replaced Python `casefold()` with Python `lower()`
  in database lookups. This repaired the tested lowercase-final-sigma spelling
  `βς`, but Python `lower()` still transforms uppercase terminal `Σ`
  contextually. The regression exercised lowercase `βς`, not uppercase `ZΣ`.
- **`b99f6c27`, October 11 — “Fixed another lowercase sigma issue.”** Correctly
  moved both operands into SQL for team creation and season registration in
  `competition_setup.py`. Its tests included `ZΣ`, but exercised those setup
  functions only. Importer existence checks, new-entry review, identity edits,
  alias ownership checks, and analytics lookup still used the earlier pattern.
- Team merge preview already compared season scopes using SQL `lower()`, but
  merge execution used Python `casefold()` for season-entry keys. Thus preview
  could report distinct `ZΣ` and `Zς` entries while execution consolidated them.
- New-entry approval keys used whole-string Python `lower()`, which could give
  new `ZΣ` and `Zς` tags the same approval key. They now receive distinct keys
  according to the database's comparison rules.
- Browser whole-string `toLowerCase()` had the same contextual-sigma behavior.
  It could fail to match `zσ` to registered `ZΣ`, or incorrectly treat distinct
  registered `ZΣ` and `Zς` entries as duplicate tags.

## Implemented correction

Keep existing stored spellings and existing database uniqueness rules. Apply
PostgreSQL `lower()` to **both operands** of team identity SQL comparisons.
Use [database_text.py](../../backend/database_text.py) for Python-side identity
keys, including alias resolution, new-entry approvals, canonical identity
changes, reviewed cross-league links, and team merges. Known alias strings are
normalized in batches and immutable text conversions are cached per session;
no mutable identity/ownership results are cached.

The importer, preview/review detection, identity and alias management, team
search, match filters, analytics team lookup and playoff filters use those
rules. Merge preview and execution consequently agree about distinct entries.
No sigma-specific replacement, transliteration, team-ID exception, duplicate
check bypass, or database index change is used.

[identityText.ts](../../frontend/src/identityText.ts) uses context-free,
single-code-point lowercase for editor comparisons, registration duplicate
checks and team-pool filtering. This avoids whole-string contextual casing and
full lowercase expansions. Backend PostgreSQL comparisons remain authoritative
for ownership and uniqueness; regression cases check the same results against
PostgreSQL, including `Σ`, `σ`, `ς`, `İ`, `ẞ` and supplementary-plane characters.
Browser and database Unicode/collation versions must be considered when changing
this comparison policy or runtime; the client is not an authorization boundary.

The current database considers `ZΣ` and `Zσ` equivalent, but `Zς` distinct.
Changing that policy to full Unicode casefolding would require a separate
collision audit and migration. This repair preserves the existing policy.

## Verification and operational consequence

Regression coverage is in
[test_unicode_team_identity.py](../../backend/test_unicode_team_identity.py)
and [unicode-team-identity.spec.ts](../../frontend/e2e/unicode-team-identity.spec.ts).
It covers registration → preview → import, duplicate/ownership validation,
alias promotion, season-tag collision checks, analytics and playoff filters,
separate approvals for distinct new tags, merge preservation, and editor
validation on desktop/mobile Chromium.

A regression recreates the live structure (`ZE` season tag, owned `ZΣ` league
identity and global alias), restores its season tag to `ZΣ`, and imports a
match without adding a duplicate team or season entry. Automatic canonical
identity changes to `ZΣ`, the old `ZE` spelling remains available, and stable
team/entry IDs are preserved.

After deployment, entry 347 can be edited through the normal audited identity
workflow to restore its season tag to `ZΣ`; its automatic canonical tag will
follow. Neither deleting nor merging team 187 is needed. The live tag remains
`ZE` at the end of this read-only investigation.

## Local validation results

- Full backend suite: **219 tests passed**, including nine Unicode regressions.
- Desktop/mobile Chromium: **112 checks passed**, including the Unicode editor
  cases and existing review-warning/special-result-edit cases.
- Fresh disposable PostgreSQL 18 database: migrations applied, Alembic reported
  no schema drift, and the historical importer accepted **244 matches**.
- Ruff lint/format, frontend Biome/TypeScript checks and production build passed.
- Installed runtimes were Python **3.12.3** and Node **24.15.0**. The repository's
  CI runtimes, Python 3.11 and Node 22, were unavailable locally; those exact
  runtime checks and deployment checks were not run. No deployment was attempted.
