# Architecture

The application turns reviewed Mario Kart Wii match documents into league-scoped
statistics. React handles navigation, editing, and visualization; Flask owns
validation and authorization; PostgreSQL owns operational state; the accepted JSON
archive preserves durable match evidence.

Read the [domain glossary](../../CONTEXT.md) first. Continue with the
[repository map](repository-map.md), [frontend guide](frontend.md),
[backend guide](backend.md), [data model](data-model.md), and
[data pipeline](data-pipeline.md) for implementation detail.

## System context

```mermaid
flowchart LR
    Visitor[Visitor or match submitter] -->|Browse and prepare match documents| Stats[Competition statistics application]
    Admin[Administrator] -->|Review and accept matches; manage identities| Stats
    Owner[Owner] -->|Manage administrator access| Stats
    Stats -->|Verify administrator identity| Firebase[Firebase Authentication]
    Stats -->|Resolve player profile by friend code| MKC[MKCentral registry]
    Source[Historical Table Bot JSON and reviewed registries] -->|Explicit bootstrap import| Stats
    Stats -->|Accepted match evidence| Archive[Durable JSON archive]
```

Google sign-in establishes identity. An active application administrator record
establishes authority. Anonymous editing and public review submission do not confer
permission to import a match. See [ADR 0004](../adr/0004-administrator-access-and-public-review-queue.md).

## Runtime modules and stores

```mermaid
flowchart TB
    subgraph Browser
        Shell[React shell, league context and navigation]
        Views[Lazy route modules and analytics views]
        Editor[Match editor module]
        Client[Shared HTTP client and Firebase session]
        Shell --> Views
        Shell --> Editor
        Views --> Client
        Editor --> Client
    end
    subgraph Flask
        Routes[Public, admin, review, access and operations routes]
        Read[Catalog and analytics query modules]
        Review[Match review and validation policy]
        Write[Acceptance and match management]
        Import[Archive and editor importer]
        Storage[Archive and media storage interfaces]
        Routes --> Read
        Routes --> Review
        Routes --> Write
        Write --> Review
        Write --> Import
        Write --> Storage
    end
    Client -->|JSON over /api| Routes
    Read --> DB[(PostgreSQL)]
    Review --> DB
    Import --> DB
    Storage --> Objects[(Local objects or Cloud Storage)]
    Review --> MKC[MKCentral]
```

The browser never opens PostgreSQL or writes an accepted archive object directly.
Archive and media storage each have real local and GCS adapters. Keeping their
interfaces stable gives local tests leverage over hosted failure cases without
introducing another application tier.

## Local and staging deployment

```mermaid
flowchart LR
    subgraph Local
        DevBrowser[Browser] --> Vite[Vite :3000]
        Vite -->|/api proxy| DevFlask[Flask :5000]
        DevFlask --> LocalPG[(PostgreSQL 18 :55432)]
        DevFlask --> LocalFiles[Ignored local archive and media]
    end
    subgraph Staging
        UserBrowser[Browser] --> Hosting[Firebase Hosting]
        Hosting -->|Static build and media| UserBrowser
        Hosting -->|/api rewrite| Run[Cloud Run: Flask and Gunicorn]
        Run --> SQL[(Cloud SQL: staging database)]
        Run --> GCS[(Staging archive and media buckets)]
        Secrets[Secret Manager and runtime settings] --> Run
    end
```

Staging is the currently documented hosted environment. The deployment workflow
exists and targets staging; production cutover remains a separate planned step.
Staging and production are designed to use separate databases/roles and buckets,
initially on one Cloud SQL instance. Local work uses disposable local PostgreSQL.
See [deployment](../operations/deployment.md) and [production gates](../roadmap/README.md).

The checked-in configuration is authoritative for routing and build behavior:
[firebase.json](../../firebase.json), [Vite](../../frontend/vite.config.ts),
[Dockerfile](../../Dockerfile), [start.sh](../../start.sh), and
[CI/staging workflow](../../.github/workflows/ci-staging.yml).

## Read request

```mermaid
sequenceDiagram
    participant User as Browser route
    participant Client as HTTP client
    participant Route as Flask route
    participant Query as Query module
    participant DB as PostgreSQL
    User->>Client: Load scoped data
    Client->>Route: GET /api/... with league and filters
    Route->>Route: Parse supported scope and validate parameters
    Route->>Query: Execute query interface
    Query->>DB: Read normalized match and identity facts
    DB-->>Query: Rows
    Query-->>Route: Serialized result
    Route-->>Client: JSON or structured error
    Client-->>User: Render, empty state, or error
```

Some reads use the process-local Flask cache. Mutation routes clear that cache;
this is not distributed invalidation across every Gunicorn worker or Cloud Run
instance. Track analytics has its own regular/played-match eligibility rules;
other match-derived views commonly support the regular/playoffs/all match set.
See [backend](backend.md) and [methodology](../features/dashboard-analytics-methodology.md).

## Write ownership and recovery

```mermaid
flowchart LR
    Draft[Browser draft] --> Compile[Compile deterministic match document]
    Compile --> Preview[Server validation and rollback-only preview]
    Compile --> Queue[Anonymous temporary review submission]
    Queue --> Decision[Administrator review]
    Preview --> Decision
    Decision --> Stage[Stage canonical bytes]
    Stage --> Commit[Commit match, identities and audit in PostgreSQL]
    Commit --> Promote[Promote immutable accepted object]
    Promote --> Complete[Archive complete]
    Promote --> Repair[Archive repair required]
    Repair --> Maintenance[Idempotent maintenance retry]
    Maintenance --> Complete
```

PostgreSQL and object storage do not share a transaction. A successful database
commit can be followed by failed object promotion; the match remains committed,
and durable archive state records the repair requirement. Retrying is part of the
interface, not permission to create a second match. The [editor workflow](../json-editor/workflow.md)
records exact response states, duplicates, queue decisions, edits, and deletes.

## Stable seams

| Module | Interface callers learn | Implementation kept local |
| --- | --- | --- |
| Frontend HTTP client | Origin, JSON/errors, token attachment and request contracts | Fetch and authorization headers |
| Match editor | Draft editing and compile/preview/submit workflow | Scores, race arrays, warnings, entry decisions and editor views |
| Match review | Proposed-entry resolution and approval interpretation | Catalog/identity lookup, identity links and MKCentral review facts |
| Acceptance | One accepted-match operation with idempotent result | Transaction ordering, audit, archive staging and promotion |
| Archive storage | Queue/stage/read/promote operations | Local filesystem or GCS object behavior |
| Analytics queries | Scoped serialized statistics | Joins, role eligibility, aggregates and display names |

Preserve these seams when making changes. Splitting a long function into many
pass-through modules does not add depth. Keep a rule with the module that owns it,
and test through the interface used by real callers. Current constraints and
future work belong in the [roadmap](../roadmap/README.md), not hypothetical adapters.
