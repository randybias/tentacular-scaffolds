# github-security-digest

Daily digest of Dependabot and code scanning alerts across GitHub repositories with LLM-powered prioritization. Fetches alerts, deduplicates against previously seen alerts in Postgres, uses Claude to prioritize and summarize, then posts to Slack.

## Nodes

- **fetch-alerts** -- Fetch Dependabot and code scanning alerts from GitHub API
- **deduplicate-store** -- Deduplicate alerts against Postgres history
- **prioritize-summarize** -- Use Claude to prioritize alerts by severity and exploitability
- **notify-slack** -- Post the prioritized digest to Slack

## Dependencies

- **github** -- GitHub API (bearer token) for security alerts
- **tentacular-postgres** -- PostgreSQL for alert deduplication history
- **anthropic** -- Anthropic API (bearer token) for prioritization
- **slack-webhook** -- Slack incoming webhook for digest delivery

## Trigger

- Manual
- Cron: daily at 07:00 UTC (`0 7 * * *`)

## Prompts

1 LLM prompt (prioritize-summarize) and 1 template (Slack notification).

## Prompts

1 prompt and 1 template defined in `prompts.yaml`.
