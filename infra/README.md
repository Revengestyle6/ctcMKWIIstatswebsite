# Managed infrastructure runbooks

These documents describe the accepted Firebase/Google Cloud topology and recorded
resource configuration. Use the [deployment guide](../docs/operations/deployment.md)
for release order and the [dated inventory](../docs/operations/phase-4-resource-inventory.md)
for provisioning evidence. They are not an infrastructure-as-code reconciler.

| Area | Runbook |
| --- | --- |
| Workload identities and separation | [IAM](iam/README.md) |
| GitHub keyless deployment | [Workload Identity Federation](iam/github-actions-wif.md) |
| Static routing, headers and Hosting | [Hosting](hosting/README.md) |
| Flask runtime and jobs | [Cloud Run](run/README.md) |
| Immutable backend images | [Artifact Registry](artifact-registry/README.md) |
| Archive, media and export retention | [Storage](storage/README.md) |
| Runtime credentials | [Secrets](secrets/README.md) |

Staging and production use distinct application identities and data permissions.
Normal development uses local PostgreSQL and local storage adapters. Follow the
[production gates](../docs/roadmap/README.md) before any cutover.
