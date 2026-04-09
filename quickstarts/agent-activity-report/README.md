# agent-activity-report

Weekly composite report of development activity across Codex, Gemini CLI, and Goose open-source AI agent projects. Fetches GitHub metrics for each repo in parallel, computes comparative metrics, generates an LLM-powered narrative analysis, renders a styled HTML report, publishes to Azure Blob Storage, and sends a Slack notification with a link.

## Nodes

- **fetch-codex** -- Fetch GitHub metrics for the OpenAI Codex repository
- **fetch-gemini** -- Fetch GitHub metrics for the Google Gemini CLI repository
- **fetch-goose** -- Fetch GitHub metrics for the Block Goose repository
- **compute-metrics** -- Aggregate and compute comparative metrics across all three repos
- **generate-analysis** -- LLM-powered narrative analysis with health scores and momentum prediction
- **render-html** -- Render a styled HTML report with rankings, detail cards, and sparklines
- **publish-report** -- Upload the HTML report to Azure Blob Storage
- **notify** -- Send a Slack Block Kit notification with rankings summary and report link

## Dependencies

- **github** -- GitHub API (bearer token) for repo metrics
- **openai** -- OpenAI API (bearer token) for LLM analysis
- **azure-blob** -- Azure Blob Storage (SAS token) for report hosting
- **slack-webhook** -- Slack incoming webhook for notifications

## Trigger

- Manual
- Cron: weekly on Sunday at 20:00 UTC (`0 20 * * 0`)

## Prompts

1 LLM prompt (generate-analysis) and 2 templates (HTML report, Slack Block Kit notification).

## Prompts

1 prompt and 2 templates defined in `prompts.yaml`.
