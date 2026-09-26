# CTC statistics frontend

Vite builds the React single-page application in this directory. Project-wide
setup, development, and verification commands are documented in the root
[`README.md`](../README.md). See the [frontend architecture guide](../docs/architecture/frontend.md)
for routes, state, requests, authentication, media, and staging behavior, and the
[JSON editor guide](../docs/json-editor/README.md) for its complete workflow and
validation reference.

Useful frontend-only commands:

```bash
npm ci
npm run dev
npm run check
npm run build
npm run test:e2e
```

Production builds are written to `frontend/build/`. Route modules are loaded on
demand so the initial bundle contains only the application shell and shared
libraries.
