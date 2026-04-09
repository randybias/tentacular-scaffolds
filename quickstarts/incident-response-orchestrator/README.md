# incident-response-orchestrator

Receives monitoring alerts, gathers context from incident history, runbooks, and recent deploys in parallel, classifies severity with Claude, then orchestrates response actions: creates a ticket, notifies Slack, publishes a NATS event, and pages on-call via PagerDuty. All actions are logged for audit. Uses a double fan-out/fan-in DAG pattern.

## Nodes

- **receive-alert** -- Ingest the monitoring alert payload
- **query-history** -- Query Postgres for related past incidents
- **fetch-runbook** -- Fetch the relevant runbook from RustFS
- **query-deploys** -- Query GitHub for recent deployments to the affected service
- **classify-and-brief** -- Use Claude to classify severity and generate an incident brief
- **create-ticket** -- Create a GitHub issue for the incident
- **notify-slack** -- Post the incident brief to Slack
- **publish-event** -- Publish an incident event to NATS
- **page-oncall** -- Page the on-call engineer via PagerDuty
- **log-actions** -- Log all response actions to Postgres for audit

## Dependencies

- **github** -- GitHub API (bearer token) for deploy history and ticket creation
- **tentacular-rustfs** -- RustFS for runbook storage
- **tentacular-postgres** -- PostgreSQL for incident history and audit logs
- **tentacular-nats** -- NATS for event publishing
- **anthropic** -- Anthropic API (bearer token) for severity classification
- **slack-webhook** -- Slack incoming webhook for incident notifications
- **pagerduty** -- PagerDuty API (bearer token) for on-call paging

## Trigger

- Manual only

## Prompts

1 LLM prompt (classify-and-brief) and 3 templates (GitHub ticket, Slack notification, NATS event).

## Prompts

1 prompt and 3 templates defined in `prompts.yaml`.
