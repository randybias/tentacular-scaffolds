# contract-clause-reviewer

Watches a Google Drive folder for new contracts, extracts text, performs parallel AI clause analysis across four legal dimensions, and generates consolidated risk reports. Fans out from text extraction to four parallel review nodes (liability, IP rights, termination, compliance) then fans in to synthesize a unified report.

## Nodes

- **poll-drive** -- Poll Google Drive folder for new contract documents
- **store-originals** -- Store original documents in RustFS
- **extract-text** -- Extract text content from contract documents
- **review-liability** -- AI review of liability and indemnification clauses
- **review-ip-rights** -- AI review of intellectual property ownership and licensing
- **review-termination** -- AI review of termination conditions and exit clauses
- **review-compliance** -- AI review of regulatory compliance (e.g., GDPR)
- **synthesize-report** -- Consolidate all review findings into a risk report
- **store-and-notify** -- Store the report and send Slack notification

## Dependencies

- **google-drive** -- Google Drive API (bearer token) for document polling
- **tentacular-rustfs** -- RustFS for storing original documents
- **tentacular-postgres** -- PostgreSQL for storing review results
- **anthropic** -- Anthropic API (bearer token) for clause analysis
- **slack-webhook** -- Slack incoming webhook for notifications

## Trigger

- Manual
- Cron: every 30 minutes (`*/30 * * * *`)

## Prompts

5 LLM prompts (review-liability, review-ip-rights, review-termination, review-compliance, synthesize-report) and 2 templates (report, Slack notification).

## Prompts

5 prompts and 2 templates defined in `prompts.yaml`.
