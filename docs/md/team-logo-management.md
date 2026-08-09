# Team Logo Management

Administrators manage team logos from **Alias Management → Teams → Logos**. The
logo UI shares the canonical-team search and selection workflow but uses dedicated
team-logo API endpoints; logo operations are not aliases.

## Display Resolution

For a season-scoped dashboard, the backend selects the highest-priority active
logo for that team and season. If none exists, it selects the highest-priority
active default logo (`season_id IS NULL`), then the shared placeholder. Career
scope uses the default logo and then the placeholder. Equal priorities resolve to
the newest `team_logo_id`.

Uploading a logo automatically activates it and deactivates the previous active
logo in the same scope. Other seasons and the default scope are unaffected.
Inactive records remain available in the admin history and can be restored.

## Upload Contract

- Accepted input: PNG, JPEG, or WebP.
- Maximum upload size: 5 MiB.
- Maximum decoded size: 16 million pixels.
- Output: lossless WebP, preserving transparency and aspect ratio.
- Maximum output dimensions: 1024 by 1024 pixels.
- Object keys are content-addressed under `team-logos/{team_id}/`.
- Re-uploading identical content reactivates the existing record rather than
  creating a duplicate.

Only seasons in which the selected team has a `team_season_entries` record are
available as upload scopes. Every create/update is administrator-authenticated,
written to the admin audit log, and clears application response caches.

## Storage

Local development defaults to `backend/data/media`, which is ignored runtime
state. Set `MEDIA_STORAGE_ROOT` to override it. Staging and production require
`MEDIA_STORAGE_PROVIDER=gcs` and `MEDIA_GCS_BUCKET` for a dedicated media bucket.
The Cloud Run runtime identity needs object create/read access to that bucket.

The deployed bucket mapping is:

- staging: `mkw-stats-staging-media`, accessed only by `ctc-api-staging`;
- production: `mkw-stats-prod-media`, accessed only by `ctc-api-prod`.

Each runtime has bucket-scoped `roles/storage.objectCreator` and
`roles/storage.objectViewer`. It cannot delete media objects.

The public content endpoint is `/api/team-logos/{team_logo_id}/content`. Responses
use immutable one-year browser caching because each uploaded object key is derived
from its normalized content. Existing repository-managed paths below
`frontend/public/images/team-logos/` remain supported for backward compatibility.

The media bucket is separate from the immutable accepted-match archive. Database
records remain the source of truth for scope, alt text, priority, and active state;
object storage contains only normalized image bytes.
