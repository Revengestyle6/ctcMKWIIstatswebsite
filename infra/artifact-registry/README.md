# Artifact Registry And Cloud Build

Artifact Registry is Google Cloud's private package and Docker-image repository.
This project uses it to preserve immutable Flask API/job images in the same region
as Cloud Run. Digest pinning proves which exact bytes a job or service executes.

Cloud Build is the managed remote builder. It sends the repository's Docker build
context to Google Cloud, builds without relying on Docker Desktop, and pushes the
result into Artifact Registry. Automated builds explicitly use
`ctc-cloud-builder@mkw-stats.iam.gserviceaccount.com`, whose permissions are
limited to reading the submitted source, writing build logs, and pushing to this
repository. They do not use the Editor-privileged default Compute service account.

| Setting | Value |
| --- | --- |
| Project | `mkw-stats` |
| Region | `us-central1` |
| Repository | `ctc-backend` |
| Format | Docker |
| Tag policy | Immutable |
| Serving image digest | `sha256:3be6fc168e1a703d973b15aeca16d8efaa98bdca7a84517862ce2a0654a37e9b` |

Build from the repository root with a unique tag, then deploy by the returned
digest:

```bash
gcloud builds submit \
  --project=mkw-stats \
  --config=cloudbuild.yaml \
  --substitutions=_IMAGE_TAG=us-central1-docker.pkg.dev/mkw-stats/ctc-backend/api:UNIQUE_TAG \
  .
```

Do not reuse a tag or deploy a mutable tag reference. The repository intentionally
retains earlier build snapshots for audit and rollback until a retention policy is
reviewed.
