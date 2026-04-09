# email-invoice-processor

Polls Gmail for invoice emails with PDF attachments, extracts structured data using Claude, validates line-item totals, and stores results in Postgres. Uses a checkpoint table to track processed emails and avoid duplicates.

## Nodes

- **poll-email** -- Query Gmail API for unprocessed invoice emails with attachments
- **store-originals** -- Store original PDF attachments in RustFS
- **extract-fields** -- Use Claude to extract structured invoice data from PDFs
- **validate-totals** -- Validate that line items sum to the invoice total
- **store-and-notify** -- Write validated records to Postgres and notify via Slack

## Dependencies

- **gmail** -- Gmail API (bearer token) for email polling
- **tentacular-rustfs** -- RustFS for storing original PDFs
- **tentacular-postgres** -- PostgreSQL for invoice records and checkpoints
- **anthropic** -- Anthropic API (bearer token) for field extraction
- **slack-webhook** -- Slack incoming webhook for notifications

## Trigger

- Manual
- Cron: every 10 minutes (`*/10 * * * *`)

## Prompts

1 LLM prompt (extract-fields) and 1 template (Slack notification).

## Prompts

1 prompt and 1 template defined in `prompts.yaml`.
