# otel-llm-echo

OTel GenAI validation scaffold that makes a minimal Anthropic API call to verify that GenAI-specific span attributes (model, token counts, etc.) are correctly produced by the instrumentation layer.

## Nodes

- **llm-call** -- Sends a simple prompt to the Anthropic API and returns the response

## Dependencies

- `anthropic` -- Anthropic Claude API (bearer token)

## Trigger

- **manual**

## Prompts

1 prompt defined in `prompts.yaml`.
