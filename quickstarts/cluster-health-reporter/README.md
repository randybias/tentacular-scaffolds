# cluster-health-reporter

Generates a daily cluster health report from historical data collected by the companion `cluster-health-collector` scaffold. Queries Postgres for health history, analyzes trends with Anthropic Claude, and sends a formatted report to Slack.

## Nodes

- **query-health-history** -- Query Postgres for recent cluster health snapshots
- **analyze-trends** -- Use Claude to analyze health trends and identify anomalies
- **send-report** -- Format and send the report to Slack

## Dependencies

- **tentacular-postgres** -- PostgreSQL for reading health history
- **anthropic** -- Anthropic API (API key) for trend analysis
- **slack** -- Slack incoming webhook for report delivery

## Trigger

- Manual
- Cron: daily at 15:00 UTC (`0 15 * * *`)

## Prompts

1 LLM prompt (analyze-trends) and 1 template (Slack report).

## Prompts

1 prompt and 1 template defined in `prompts.yaml`.
