# github-digest

Fetches GitHub repository activity and creates a daily digest summary posted to Slack. A minimal three-node linear pipeline for basic repo monitoring.

## Nodes

- **fetch-repos** -- Fetch repository activity from the GitHub API
- **summarize** -- Summarize the fetched activity into a digest
- **notify** -- Post the digest to Slack via webhook

## Dependencies

- **github** -- GitHub API (bearer token) for repository data
- **slack** -- Slack incoming webhook for posting the digest

## Trigger

- Manual
- Cron: daily at 09:00 UTC (`0 9 * * *`)
