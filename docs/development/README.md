# Development

1. Follow [local startup](local-development-startup.md) for Python 3.11, Node 22,
   PostgreSQL 18, Firebase configuration, and separate Flask/Vite terminals.
2. Read [CONTRIBUTING](../../CONTRIBUTING.md) for required checks and change conventions.
3. Use the [repository map](../architecture/repository-map.md) to find the owning module.
4. For editor work, follow the [editor guide](../json-editor/README.md) and
   [manual identity scenarios](json-editor-player-identity-test-checklist.md).

The [CI workflow](../../.github/workflows/ci-staging.yml) is the executable check
specification. Local tests use isolated PostgreSQL schemas; migration and archive
import checks must still run against a fresh disposable database to exercise real
Alembic history. A passing unit suite alone does not establish schema compatibility.

Browser smoke tests exercise route loading and editor interactions at desktop and
mobile sizes. Baseline capture is a separate deliberate operation; see
[baseline policy](../baselines/README.md). Neither local checks nor feature-branch
work deploy staging automatically.

## Browser suite setup and known limitations

Run `npm run test:e2e` from `frontend/` (or use `--prefix frontend` from the root).
The uploaded archive fixture in the suite is relative to that working directory.
Set a disposable local `DATABASE_URL` and ensure any processes reused on ports
5000/4173 point to that database. Flask and Vite use those ports in the default
Playwright configuration.

The checked-in historical import does not provide the GSC season 15 competition
setup expected by two standings scenarios. Those checks need the intended local
fixture data; an archive-only database does not exercise them successfully.
At the September 26, 2026 cleanup baseline (`24d67fd7`), the legacy
`/admin/aliases` redirect smoke and mobile track-pagination click also failed in
browser verification. These are existing product/test issues, not changes to
hide by replacing baselines or weakening assertions. Compare failures with the
starting revision when reviewing a behavior-preserving refactor, and track their
resolution in focused issues. The PostgreSQL application suite and CI build checks
remain required regardless of these additional browser limitations.
