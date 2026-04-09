# lead-enrichment-pipeline

Enrich new leads from Google Sheets with company, person, and website data in parallel, score them against an Ideal Customer Profile using Claude, and route qualified leads to Postgres and Slack.

## Nodes

- **poll-sheet** -- Polls Google Sheets for new lead rows
- **enrich-company** -- Fetches company data from the enrichment API
- **enrich-person** -- Fetches person/contact data from the enrichment API
- **enrich-website** -- Scrapes and extracts signals from the lead's website
- **score-leads** -- Scores enriched leads against ICP criteria using Claude
- **store-and-route** -- Stores scored leads in Postgres and sends Slack alerts for qualified leads

## Dependencies

- `google-sheets` -- Google Sheets API (bearer token)
- `enrichment-api` -- External enrichment API (bearer token)
- `probe-targets` -- Dynamic HTTPS targets for website scraping
- `tentacular-postgres` -- Postgres for lead storage
- `anthropic` -- Claude API for ICP scoring
- `slack-webhook` -- Slack webhook for notifications

## Trigger

- **manual**
- **cron** -- `*/5 * * * *` (every 5 minutes)

## Prompts

2 prompts and 1 template defined in `prompts.yaml`.
