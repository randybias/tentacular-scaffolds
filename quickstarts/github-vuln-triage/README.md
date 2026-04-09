# github-vuln-triage

Aggregates Dependabot and CodeQL alerts across a GitHub org, enriches with repo context (customer-facing, environment, team), triages with AI, and auto-creates GitHub issues for actionable findings. Fans out from fetch (Dependabot + CodeQL in parallel) through deduplication, enrichment, and triage, then fans out again to create issues, alert on critical findings, and log everything.

## Nodes

- **fetch-dependabot** -- Fetch Dependabot alerts from all org repos
- **fetch-codescan** -- Fetch CodeQL code scanning alerts from all org repos
- **deduplicate** -- Merge and deduplicate alerts from both sources
- **enrich-context** -- Enrich alerts with repo metadata (customer-facing, environment, team)
- **triage** -- AI-powered severity triage using Claude
- **create-issues** -- Auto-create GitHub issues for actionable vulnerabilities
- **alert-critical** -- Send immediate Slack alerts for critical findings (includes issue links)
- **log-all** -- Log all triage decisions to Postgres/RustFS

## Dependencies

- **github** -- GitHub API (bearer token) for alerts and issue creation
- **tentacular-postgres** -- PostgreSQL for triage logs
- **tentacular-rustfs** -- RustFS for artifact storage
- **anthropic** -- Anthropic API (bearer token) for AI triage
- **slack-webhook** -- Slack incoming webhook for critical alerts

## Trigger

- Manual
- Cron: daily at 07:00 UTC (`0 7 * * *`)

## Prompts

1 LLM prompt (triage) and 2 templates (GitHub issue body, Slack critical alert).

## Prompts

1 prompt and 2 templates defined in `prompts.yaml`.
