# cluster-health-collector

Collects Kubernetes cluster health data every 5 minutes and stores snapshots in Postgres. Designed to work as the data source for the companion `cluster-health-reporter` scaffold.

## Nodes

- **fetch-cluster-state** -- Query cluster health metrics (node status, pod counts, resource usage)
- **store-health-data** -- Write the health snapshot to Postgres

## Dependencies

- **tentacular-postgres** -- PostgreSQL for storing health snapshots

## Trigger

- Manual
- Cron: every 5 minutes (`*/5 * * * *`)
