# Retired deployment descriptors

`railway.json.txt` selected Railway's Docker builder. `runtime.txt` selected the
Python version for the former buildpack-style deployment. Neither is consumed by
the current Cloud Run image or GitHub staging workflow. They are retained as
historical text alongside the retired Render configuration in
[sqlite-retired](../sqlite-retired/README.md).

Use [deployment](../../operations/deployment.md) and the root Dockerfile for the
supported runtime. Retiring a checked-in descriptor does not disconnect an external
provider integration; that is covered by the [legacy integration runbook](../../operations/legacy-deployment-cleanup.md).
