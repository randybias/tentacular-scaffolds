# uptime-tracker

Probe HTTP endpoints every 5 minutes and store time-series results in Postgres. Includes a separate report path for generating weekly uptime and latency reports with Claude-powered analysis, published to RustFS and Slack.

## Nodes

### Probe path (runs on cron)

- **probe-endpoints** -- Sends HTTP requests to configured endpoints, records status and latency
- **store-results** -- Persists probe results as time-series data in Postgres
- **alert-failures** -- Sends Slack alerts for any failed probes

### Report path (triggered manually)

- **aggregate-weekly** -- Queries Postgres for weekly uptime and latency aggregates
- **generate-report** -- Generates a narrative uptime report using Claude
- **publish-report** -- Publishes the report to RustFS and notifies via Slack

## Dependencies

- `probe-targets` -- Dynamic HTTPS/HTTP targets for endpoint probing
- `tentacular-postgres` -- Postgres for time-series storage
- `tentacular-rustfs` -- RustFS for report storage
- `anthropic` -- Anthropic Claude API for report generation (bearer token)
- `slack-webhook` -- Slack webhook for alerts and report notifications

## Trigger

- **manual**
- **cron** -- `*/5 * * * *` (every 5 minutes)

## Prompts

1 prompt and 3 templates defined in `prompts.yaml`.
