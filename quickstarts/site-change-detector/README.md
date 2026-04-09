# site-change-detector

Monitor web pages for content changes on a schedule. Fetches pages, diffs against stored snapshots in RustFS/Postgres, summarizes changes with Claude, and delivers alerts to Slack.

## Nodes

- **fetch-pages** -- Fetches configured URLs and extracts page content
- **diff-snapshots** -- Compares fetched content against previous snapshots stored in RustFS/Postgres
- **summarize-changes** -- Summarizes detected changes using Claude
- **notify-slack** -- Posts change summaries to Slack

## Dependencies

- `probe-targets` -- Dynamic HTTPS/HTTP targets for page fetching
- `tentacular-rustfs` -- RustFS for snapshot storage
- `tentacular-postgres` -- Postgres for snapshot metadata
- `anthropic` -- Anthropic Claude API for change summarization (bearer token)
- `slack-webhook` -- Slack webhook for alerts

## Trigger

- **manual**
- **cron** -- `0 */4 * * *` (every 4 hours)

## Prompts

1 prompt and 1 template defined in `prompts.yaml`.
