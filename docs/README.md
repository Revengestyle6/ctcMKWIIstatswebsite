# Documentation

Start with the [repository README](../README.md) to run the application and
[CONTRIBUTING](../CONTRIBUTING.md) to make and verify a change. The
[domain glossary](../CONTEXT.md) defines the competition and identity vocabulary.

## Reading paths

| Goal | Read in order |
| --- | --- |
| Join the project | [Local setup](development/local-development-startup.md) → [repository map](architecture/repository-map.md) → [architecture](architecture/README.md) |
| Understand a request | [Frontend](architecture/frontend.md) → [backend](architecture/backend.md) → [data model](architecture/data-model.md) |
| Work on the JSON editor | [Editor guide](json-editor/README.md) → [workflow](json-editor/workflow.md) → [validation](json-editor/validation.md) → [data sources](json-editor/data-sources.md) → [JSON format](json-editor/json-format.md) |
| Change analytics | [Data pipeline](architecture/data-pipeline.md) → [analytics methodology](features/dashboard-analytics-methodology.md) → [data model](architecture/data-model.md) |
| Operate staging | [Environment configuration](operations/environment-and-secrets.md) → [deployment](operations/deployment.md) → [operations guide](operations/README.md) |
| Prepare production | [Roadmap](roadmap/README.md) → [dated resource evidence](operations/phase-4-resource-inventory.md) → [accepted decisions](adr/README.md) |

## Reference areas

- **[Architecture](architecture/README.md)**: system context, runtime/deployment,
  module interfaces, dependency diagrams, request flow, and relational diagrams.
- **[JSON editor](json-editor/README.md)**: browser draft to server preview,
  administrator decisions, import, archive, edit, and failure recovery.
- **[Feature guides](features/README.md)**: analytics, playoffs, identities, names,
  league media, and team logos.
- **[Development](development/README.md)**: setup, verification, and manual editor
  regression scenarios.
- **[Operations](operations/README.md)**: staging, configuration, health,
  maintenance, deployment, and database access.
- **[Roadmap](roadmap/README.md)**: pending production gates and longer-term ideas.
- **[ADRs](adr/README.md)**: accepted decisions and their original trade-offs.
- **[Baselines](baselines/README.md)**: immutable historical regression evidence.
- **[Archive](archive/README.md)**: superseded plans and completed investigations.
- **[Agent guidance](../AGENTS.md)**: issue tracker, triage, and domain-document
  conventions; these complement contributor instructions.

## Documentation contract

Current behavior is documented from source. Each detailed guide links the modules
that own its rules; update that guide when changing the behavior. Mermaid diagrams
are editable Markdown and render on GitHub. Use a Mermaid-capable Markdown preview
locally; no generated diagram images need to be committed.

Keep current implementation, dated observations, and future plans distinct. Cloud
resource inventories are evidence from the date recorded, not live monitoring.
GitHub Issues are the task/spec tracker; roadmap documents describe direction and
exit criteria, not a second assignment queue. Preserve accepted ADR reasoning and
historical baselines when reorganizing documentation.
