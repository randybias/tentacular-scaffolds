# e2e-exoskeleton-test

Smoke test that validates all exoskeleton services: Postgres, RustFS, NATS, and SPIRE identity. Runs each service test sequentially, collects results, renders a pass/fail report, and notifies via Slack. Zero retries -- failures surface immediately.

## Nodes

- **test-postgres** -- Verify Postgres connectivity and basic CRUD operations
- **test-rustfs** -- Verify RustFS file storage read/write operations
- **test-nats** -- Verify NATS messaging pub/sub connectivity
- **test-spire** -- Verify SPIRE identity and SVID retrieval
- **collect-results** -- Aggregate pass/fail results from all service tests
- **render-report** -- Format results into a human-readable report
- **notify** -- Send the test report to Slack

## Dependencies

- **tentacular-postgres** -- PostgreSQL (exoskeleton service under test)
- **tentacular-rustfs** -- RustFS (exoskeleton service under test)
- **tentacular-nats** -- NATS (exoskeleton service under test)
- **slack-webhook** -- Slack incoming webhook for test report delivery
- **db-postgres** -- JSR `@db/postgres` driver package

## Trigger

- Manual only
