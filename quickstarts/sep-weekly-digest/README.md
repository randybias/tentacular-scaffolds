# sep-weekly-digest

Weekly SEP (Software Enhancement Proposal) activity digest that tracks proposal lifecycle, analyzes trends with LLM-powered scoring, renders HTML reports, and publishes them to Azure Blob Storage with Slack notifications.

## Nodes

- **fetch-seps** -- Fetches SEP issues and metadata from GitHub
- **store-snapshots** -- Persists point-in-time SEP state snapshots to Postgres
- **analyze-activity** -- Analyzes week-over-week SEP activity and trends using OpenAI
- **generate-report** -- Generates a structured digest report from activity analysis
- **render-html** -- Renders the report as a styled HTML page
- **publish-report** -- Uploads the HTML report to Azure Blob Storage
- **notify** -- Sends Slack notifications with report link and key highlights

## Dependencies

- `github` -- GitHub API for SEP issue tracking (bearer token)
- `tentacular-postgres` -- Postgres for snapshot persistence
- `openai` -- OpenAI API for trend analysis (bearer token)
- `azure-blob` -- Azure Blob Storage for report hosting (SAS token)
- `slack-webhook` -- Slack webhook for notifications

## Trigger

- **manual**
- **cron** -- `0 20 * * 0` (Sundays at 8:00 PM)

## Prompts

1 prompt and 2 templates defined in `prompts.yaml`.
