# multi-source-churn-detector

Aggregate usage analytics, support tickets, billing data, and survey responses to score customer health and detect churn risk. Runs daily with LLM-powered analysis and weekly report generation.

## Nodes

- **fetch-usage** -- Pulls product usage metrics from the analytics API
- **fetch-tickets** -- Pulls support ticket history from the support API
- **fetch-billing** -- Pulls billing and payment data from Stripe
- **fetch-surveys** -- Pulls NPS/CSAT survey responses from the survey API
- **normalize-signals** -- Normalizes and merges signals from all four sources
- **score-health** -- Scores customer health using Claude based on normalized signals
- **store-scores** -- Persists health scores to Postgres and RustFS
- **route-alerts** -- Sends Slack alerts for at-risk accounts
- **generate-weekly-report** -- Produces a weekly churn risk summary report

## Dependencies

- `analytics-api` -- Usage analytics API (bearer token)
- `support-api` -- Support ticket API (bearer token)
- `stripe` -- Stripe billing API (bearer token)
- `survey-api` -- Survey/NPS API (bearer token)
- `tentacular-rustfs` -- RustFS object storage
- `tentacular-postgres` -- Postgres for score persistence
- `anthropic` -- Claude API for health scoring
- `slack-webhook` -- Slack webhook for alerts

## Trigger

- **manual**
- **cron** -- `0 8 * * *` (daily at 8:00 AM)

## Prompts

2 prompts and 3 templates defined in `prompts.yaml`.
