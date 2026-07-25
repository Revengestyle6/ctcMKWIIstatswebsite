# Firebase Hosting Staging

Firebase Hosting serves the Vite-built React application from a global CDN with
managed TLS. It also provides a single browser origin for both the SPA and Flask
API by proxying `/api/**` to Cloud Run.

| Setting | Value |
| --- | --- |
| Project/site | `mkw-stats` |
| URL | `https://mkw-stats.web.app` |
| Build directory | `frontend/build` |
| API target | `ctc-stats-api-staging`, `us-central1` |
| First verified release | `1785003027409000` |

Routing order in `firebase.json` is intentional:

1. `/api/**` goes to Cloud Run.
2. All other unknown paths go to `/index.html` for React Router.

Firebase Hosting chooses the first matching rewrite. Never place the SPA catch-all
before the API rule.

Vite's `/assets/**` files have content hashes and receive a one-year immutable
cache policy. `index.html` uses `no-cache` because it contains the current asset
filenames. Images and music retain Hosting's default caching until bandwidth and
user behavior are measured.

Cloud Functions is not part of this topology and remains disabled. Deploy only
Hosting; do not enable or deploy unrelated Firebase products as a workaround for
CLI backend-discovery warnings.
