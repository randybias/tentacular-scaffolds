# slack-channel-archiver

Archive Slack channel messages and file attachments to Postgres and RustFS with incremental sync. Runs hourly to maintain a searchable, persistent record of channel history.

## Nodes

- **fetch-messages** -- Fetches new messages from configured Slack channels since last checkpoint
- **store-messages** -- Stores message content and metadata in Postgres
- **store-attachments** -- Downloads and stores file attachments in RustFS
- **update-checkpoint** -- Updates the sync checkpoint timestamp for the next run

## Dependencies

- `slack-api` -- Slack Web API for message fetching (bearer token)
- `tentacular-rustfs` -- RustFS for attachment storage
- `tentacular-postgres` -- Postgres for message storage and checkpoints

## Trigger

- **manual**
- **cron** -- `0 * * * *` (hourly)
