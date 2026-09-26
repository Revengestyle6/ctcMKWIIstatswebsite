# Legacy Deployment Integration Cleanup

## Purpose

Use this runbook with a repository administrator and the collaborator who owns or
understands the previous hosting setup. It removes obsolete Vercel and GitHub
Pages automation from GitHub without changing the current Firebase Hosting,
Cloud Run, Cloud SQL, or GitHub Actions staging deployment.

The authoritative shared deployment is:

- Environment: `staging`
- Frontend origin: `https://mkw-stats.web.app`
- Backend: `ctc-stats-api-staging` in Cloud Run
- Deployment workflow: `.github/workflows/ci-staging.yml`

Do not remove or rename the `staging` environment, disconnect the
`ci-staging.yml` workflow, or change the Google Workload Identity Federation
configuration during this cleanup.

## Why Cleanup Is Needed

GitHub deployment cards and pull-request notices can be created by external
GitHub Apps even when no corresponding workflow remains in the repository.
Deleting an old workflow file therefore does not disconnect Vercel or unpublish
GitHub Pages.

Verified July 25, 2026:

| Item | Current behavior | Classification |
| --- | --- | --- |
| `staging` environment | Records the current Firebase/Cloud Run deployment and links to `mkw-stats.web.app` | Keep |
| `Production` environment | Receives current deployment records from `vercel[bot]` | Disconnect Vercel, then remove if no longer needed |
| `Preview` environment | Receives pull-request deployment records from `vercel[bot]` | Disconnect Vercel, then remove if no longer needed |
| `github-pages` environment | Remains enabled through GitHub's generated Pages workflow | Unpublish, then remove if no longer needed |
| `easygoing-comfort / production` | Legacy environment created January 2026; current owner/purpose not established | Review with collaborator before deletion |
| `exciting-ambition / production` | Legacy environment created January 2026; current owner/purpose not established | Review with collaborator before deletion |
| `copilot` environment | Associated with the current Copilot pull-request reviewer | Keep unless Copilot review is intentionally retired |
| Repository website metadata | Still advertises the old Vercel URL | Change to `https://mkw-stats.web.app` |

The `Preview` and `Production` records are not harmless cached labels. Vercel was
still building commits, publishing Vercel URLs, creating GitHub deployment
records, and commenting on pull requests when this inventory was taken.

## Safety Rules

1. Disconnect integrations before deleting their GitHub environments. Otherwise,
   the integration can recreate the environment on its next event.
2. Disconnect the Vercel project from this repository instead of uninstalling
   the Vercel GitHub App globally. A global uninstall could affect unrelated
   repositories.
3. Do not delete the Vercel project during the initial cleanup. Disconnecting Git
   is reversible and stops automatic deployments while preserving the old site
   for comparison.
4. Do not delete `staging`, its deployment history, or the current GitHub Actions
   workflow.
5. Confirm ownership of the two unusually named legacy environments with the
   collaborator before deleting them.

## Cleanup Procedure

### 1. Disconnect The Old Vercel Project

In the Vercel dashboard:

1. Open project `ctc-mkwii-statistics-season-1`.
2. Open **Settings**.
3. Select **Git**.
4. Under **Connected Git Repository**, confirm that the repository is
   `Revengestyle6/ctcMKWIIstatswebsite`.
5. Select **Disconnect**.

Why: disconnecting stops automatic production and preview builds, Vercel checks,
deployment-status notices, and bot comments for new repository activity.

Do not delete the Vercel project during this meeting unless both collaborators
agree that its deployment history and old URL have no remaining value.

Reference:
[Vercel Git settings](https://vercel.com/docs/project-configuration/git-settings).

### 2. Unpublish GitHub Pages

In GitHub:

1. Open the repository.
2. Select **Settings**, then **Pages**.
3. Find the current published-site notice.
4. Open its three-dot menu.
5. Select **Unpublish site** and confirm.

Why: removing the checked-in Pages workflow did not disable GitHub's generated
`pages-build-deployment` workflow. Unpublishing removes the active Pages site and
prevents it from appearing as the current deployment.

Reference:
[Unpublishing a GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/unpublishing-a-github-pages-site).

### 3. Correct Repository Website Metadata

On the repository home page:

1. Edit the **About** section.
2. Replace the old Vercel website URL with
   `https://mkw-stats.web.app`.
3. Save the change.

Why: the About link is repository metadata. It is independent of deployment
workflows and does not update when the hosting platform changes.

### 4. Correct The Pinned Deployment Cards

Open the repository's **Deployments** page:

1. Unpin `Production`.
2. Unpin `github-pages`.
3. Pin `staging`.
4. Confirm that the pinned `staging` card links to
   `https://mkw-stats.web.app`.

Why: pinned cards control which environments GitHub emphasizes. Pinning does not
deploy, stop, or route the application; it only changes the deployment dashboard.

Reference:
[Viewing deployment history](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/view-deployment-history).

### 5. Review And Optionally Delete Obsolete Environments

After Vercel is disconnected and Pages is unpublished, open
**Settings → Environments**.

Safe deletion candidates after confirmation:

- `Production`
- `Preview`
- `github-pages`

Collaborator review required before deletion:

- `easygoing-comfort / production`
- `exciting-ambition / production`

Keep:

- `staging`
- `copilot`, while Copilot pull-request review remains enabled

Deleting an environment cleans up its configuration. Historical deployment
activity can remain visible in GitHub, but no new Vercel or Pages records should
appear after their integrations are disconnected.

## Verification Checklist

Complete these checks after cleanup:

- [ ] Repository About link opens `https://mkw-stats.web.app`.
- [ ] `staging` is pinned on the Deployments page.
- [ ] The pinned `staging` deployment links to `mkw-stats.web.app`.
- [ ] The GitHub Pages site is unpublished.
- [ ] The Vercel project no longer lists this repository as connected.
- [ ] A new pull request runs `CI and staging deployment`.
- [ ] A new pull request does not receive a Vercel preview deployment or bot
      comment.
- [ ] Merging a tested pull request creates a successful `staging` deployment.
- [ ] The staging workflow still completes its Firebase Hosting and Cloud Run
      health checks.
- [ ] No Firebase, Cloud Run, Cloud SQL, Artifact Registry, or WIF resource was
      removed during cleanup.

Record the review:

| Field | Value |
| --- | --- |
| Review date | |
| Repository administrator | |
| Collaborator | |
| Vercel disconnected | |
| GitHub Pages unpublished | |
| Environments deleted | |
| Follow-up items | |

## Expected Remaining History

Old Vercel and Pages deployments may continue to appear in GitHub's historical
timeline. That history is evidence of earlier deployment activity and is not the
same as an active integration. Success means that new repository activity creates
only the intended CI and `staging` deployment records.

