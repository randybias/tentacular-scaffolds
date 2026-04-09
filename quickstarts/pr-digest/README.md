# pr-digest

Fetch recent GitHub pull requests, summarize them with Claude, and send a formatted digest to Slack. Designed to run daily to keep teams informed about PR activity.

## Nodes

- **fetch-prs** -- Fetches open/recent PRs from the GitHub API
- **analyze-prs** -- Summarizes PR activity and highlights using Claude
- **notify-slack** -- Posts the formatted digest to a Slack channel

## Dependencies

- `github` -- GitHub API (bearer token)
- `anthropic` -- Anthropic Claude API (API key)
- `slack` -- Slack incoming webhook

## Trigger

- **manual**
- **cron** -- `0 9 * * *` (daily at 9:00 AM)

## Prompts

1 prompt and 1 template defined in `prompts.yaml`.
