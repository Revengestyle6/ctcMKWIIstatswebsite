# Issue tracker: GitHub

Issues and specs for this repo live in GitHub Issues. Use the `gh` CLI; infer
the repository from the GitHub git remote.

## Operations

- Create: `gh issue create --title "..." --body-file <file>`
- Read: `gh issue view <number> --comments`
- List: `gh issue list --state open --json number,title,body,labels,comments`
- Comment: `gh issue comment <number> --body-file <file>`
- Label: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

When a skill says "publish to the issue tracker", create a GitHub issue.
When it says "fetch the relevant ticket", read the GitHub issue and comments.

## Pull requests as a triage surface

**PRs as a request surface: no.** Set this to `yes` only if external pull
requests should enter the triage queue.

## Wayfinding

A wayfinding map is one issue labelled `wayfinder:map`. Child tickets are
GitHub sub-issues when available; otherwise link them from a task list in
the map and add `Part of #<map>` to each child. Use `wayfinder:<type>` labels
for research, prototype, grilling, and task tickets.

Represent blockers with GitHub issue dependencies when available, using
the blocker's database `id`, not its issue number. Otherwise put
`Blocked by: #<number>` at the top of the child body. Claim an unblocked,
unassigned child with `gh issue edit <number> --add-assignee @me`. Resolve
it by commenting with the answer, closing it, and adding a brief decision
and link to the map.
