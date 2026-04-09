# otel-multi-node

OTel span hierarchy validation scaffold with a 3-node DAG. Verifies that parent-child span relationships are correctly propagated across node boundaries when data flows through a multi-step pipeline.

## Nodes

- **fetch-data** -- Fetches sample data from httpbin.org
- **transform** -- Transforms the fetched data (string manipulation)
- **notify** -- Logs the final result as a notification

## Dependencies

- `httpbin` -- httpbin.org for test HTTP requests

## Trigger

- **manual**
