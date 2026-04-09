# doc-converter

Convert documents between formats using a pandoc sidecar, then summarize with Claude.

## What it does

1. **fetch-document** — Fetches a document from a URL (Markdown, HTML, RST, etc.), auto-detecting the format from the URL extension or Content-Type header
2. **convert-document** — POSTs the raw content to a `pandoc-server` sidecar running on `localhost:3030`, receives the converted output as a JSON response body
3. **summarize-output** — Sends a preview of the converted output to Claude for a brief 2-3 sentence summary; falls back to a mock summary if no API key is configured

## Sidecar pattern demonstrated

This scaffold uses the **HTTP body** data flow pattern: content travels as JSON in the request and response body, with no shared volume required. This is the simplest sidecar integration — just a `fetch()` call to `localhost:3030`.

Contrast with `video-frame-analyzer` which uses a shared emptyDir volume for large file handoff.

## Quick start

```bash
tntc scaffold init doc-converter my-doc-converter
cd my-doc-converter

# Edit workflow.yaml to point config.document_url at your document
# Optionally set your Anthropic API key in secrets.yaml

tntc deploy
tntc run
```

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `document_url` | Tentacular README | URL of document to fetch |
| `input_format` | `markdown` | pandoc input format |
| `output_format` | `html` | pandoc output format |
| `max_summary_chars` | `2000` | Max chars sent to Claude for summarization |

## Supported formats

pandoc supports 40+ input and output formats. Common pairs:

| From | To | Use case |
|------|----|----------|
| `markdown` | `html` | Render docs to HTML |
| `markdown` | `plain` | Strip markup |
| `html` | `markdown` | Convert web pages to Markdown |
| `rst` | `markdown` | Migrate RST docs |
| `markdown` | `latex` | Generate LaTeX source |

## Secrets

- `anthropic.api_key` — Claude API key for summarization (optional; mock fallback used if absent)

## Notes

- The pandoc sidecar starts `pandoc-server --port 3030` — no custom image needed
- `/version` is used as the readiness probe (returns pandoc version JSON)
- PDFs cannot be produced by pandoc-server (pandoc limitation in server mode)
- The `doc-source` contract dependency allows fetching from the configured host; update it if you change `document_url` to a different hostname

## Prompts

1 prompt defined in `prompts.yaml`.
