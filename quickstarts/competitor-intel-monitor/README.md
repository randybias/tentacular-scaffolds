# competitor-intel-monitor

Tracks competitor web pages, news mentions, and GitHub activity on a 6-hour cycle. Fetches configured URLs, diffs against previous snapshots stored in RustFS, uses Claude to analyze the significance of changes, stores assessments in Postgres, and sends a digest to Slack when noteworthy changes are detected.

## Nodes

- **fetch-sources** -- Fetch current content from configured competitor URLs
- **diff-snapshots** -- Compare fetched content against previous snapshots in RustFS
- **analyze-changes** -- Use Claude to assess change significance and generate insights
- **store-assessments** -- Persist change assessments to Postgres
- **notify-digest** -- Send a Slack digest of significant changes

## Dependencies

- **probe-targets** -- Dynamic HTTPS targets for competitor web pages
- **tentacular-rustfs** -- RustFS for storing content snapshots
- **tentacular-postgres** -- PostgreSQL for storing assessments
- **anthropic** -- Anthropic API (bearer token) for change analysis
- **slack-webhook** -- Slack incoming webhook for digest notifications

## Trigger

- Manual
- Cron: every 6 hours (`0 */6 * * *`)

## Prompts

1 LLM prompt (analyze-changes) and 1 template (Slack digest).

## Prompts

1 prompt and 1 template defined in `prompts.yaml`.
