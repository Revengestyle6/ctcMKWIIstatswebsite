# Retired SQLite tooling

These source snapshots are retained only to explain and reproduce historical
Phase 0 data-cleanup decisions. They are deliberately stored as `.py.txt` files
outside `backend/` so they cannot be mistaken for supported operational tools.

The application, importer, maintenance commands, tests, CI, and deployment path
use PostgreSQL exclusively. The ignored SQLite database and backup files under
`backend/data/` remain preserved locally, but no active code opens them.
