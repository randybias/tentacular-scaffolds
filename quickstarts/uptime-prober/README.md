# uptime-prober

Probe HTTP endpoints on a cron schedule, analyze results for failures, format a status report, and alert via Slack when any endpoint is down.

## Nodes

- **probe-endpoints** -- Sends HTTP requests to configured endpoints and records status/latency
- **analyze-results** -- Evaluates probe results and flags failures
- **format-report** -- Formats a human-readable status report
- **notify-slack** -- Posts the report to Slack (alerts on failures)

## Dependencies

- `probe-targets` -- Dynamic HTTPS/HTTP targets for endpoint probing
- `slack` -- Slack incoming webhook for alerts

## Trigger

- **manual**
- **cron** -- `*/5 * * * *` (every 5 minutes)
