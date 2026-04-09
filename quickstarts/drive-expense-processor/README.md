# drive-expense-processor

Watches a Google Drive folder for receipt uploads, extracts expense data with AI, validates the records, and logs them to both Postgres and Google Sheets. Supports configurable expense categories (Travel, Meals, Software, Office, Equipment, Other).

## Nodes

- **poll-drive** -- Poll Google Drive folder for new receipt uploads
- **store-originals** -- Store original receipt files in RustFS
- **extract-fields** -- Use Claude to extract structured expense data from receipts
- **validate-record** -- Validate extracted fields (amounts, categories, dates)
- **store-and-notify** -- Write to Postgres and Google Sheets, notify via Slack

## Dependencies

- **google-drive** -- Google Drive API (bearer token) for receipt polling
- **google-sheets** -- Google Sheets API (bearer token) for expense logging
- **tentacular-rustfs** -- RustFS for storing original receipts
- **tentacular-postgres** -- PostgreSQL for structured expense records
- **anthropic** -- Anthropic API (bearer token) for field extraction
- **slack-webhook** -- Slack incoming webhook for notifications

## Trigger

- Manual
- Cron: every 15 minutes (`*/15 * * * *`)

## Prompts

1 LLM prompt (extract-fields) and 1 template (Slack notification).

## Prompts

1 prompt and 1 template defined in `prompts.yaml`.
