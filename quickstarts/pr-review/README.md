# pr-review

Agentic PR review pipeline that runs parallel security and code scans, then synthesizes findings with Claude into a single review comment posted to the PR. Triggered by GitHub webhook on PR open/sync/reopen.

## Nodes

- **fetch-pr** -- Fetches PR metadata, diff, and file list from GitHub
- **semgrep-scan** -- Runs Semgrep static analysis on the diff
- **dep-review** -- Reviews dependency changes for known vulnerabilities
- **check-runs** -- Collects CI check run results for the PR head SHA
- **code-scan** -- Performs LLM-powered code review using Claude
- **synthesize** -- Merges all scan results and PR context into a unified review
- **post-review** -- Posts the synthesized review as a PR comment on GitHub

## Dependencies

- `github` -- GitHub API (bearer token)
- `anthropic` -- Anthropic Claude API (bearer token)

## Trigger

- **manual**
- **webhook** -- GitHub `pull_request` events (opened, synchronize, reopened)

## Prompts

1 prompt defined in `prompts.yaml`.
