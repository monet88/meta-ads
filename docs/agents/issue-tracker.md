# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues in `monet88/meta-ads`. Use the `gh` CLI for all operations.

## Repository

- URL: https://github.com/monet88/meta-ads.git
- GitHub owner/repo: `monet88/meta-ads`

## Conventions

- **Create an issue**: `gh issue create --repo monet88/meta-ads --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --repo monet88/meta-ads --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --repo monet88/meta-ads --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --repo monet88/meta-ads --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --repo monet88/meta-ads --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --repo monet88/meta-ads --comment "..."`

Use `--repo monet88/meta-ads` so commands do not depend on local git remote state.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `monet88/meta-ads`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --repo monet88/meta-ads --comments`.
