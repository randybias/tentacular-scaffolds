# otel-error

OTel error validation scaffold that deliberately fails to verify error span status and health reporting. Used to confirm that failed nodes correctly set span status to ERROR and that the health endpoint reports the failure.

## Nodes

- **fail** -- Intentionally throws an error to produce an error span

## Dependencies

None.

## Trigger

- **manual**
