# Contributing to the Tentacular Catalog

## Adding a Template

1. Create a `templates/<name>/` directory.
2. Add a `template.yaml` with the required metadata (see format below).
3. Add your workflow files:
   - `workflow.yaml` (required)
   - `nodes/*.ts` (your workflow node source files)
   - `tests/fixtures/` (optional test fixtures)
   - `.secrets.yaml.example` (optional, documents required secrets)
   - `README.md` (optional, template-specific documentation)
4. Run `./scripts/build-index.sh` to regenerate `catalog.yaml`.
5. Submit a PR.

## template.yaml Format

```yaml
name: my-workflow
displayName: "My Workflow"
description: "What it does"
category: starter          # starter | data-pipeline | monitoring | automation | reporting
tags: [tag1, tag2]
author: your-github-handle
minTentacularVersion: "0.1.0"
complexity: simple         # simple | moderate | advanced
```

## Categories

| Category | Description |
|---|---|
| `starter` | Learning examples, minimal dependencies |
| `data-pipeline` | Fetch, transform, output data |
| `monitoring` | Health checks, metrics collection |
| `automation` | Triggered actions, PR reviews, webhooks |
| `reporting` | Digest generation, notifications |

## Complexity Levels

- **simple** -- Single node or minimal DAG, no external dependencies.
- **moderate** -- Multiple nodes, some external dependencies or secrets.
- **advanced** -- Complex DAG, multiple dependencies, cron triggers, error handling.

## Contract Format

Scaffolds declare external dependencies in the `contract:` block of `workflow.yaml`. Each dependency gets a named entry under `contract.dependencies` with protocol, host, port, and auth fields.

### Slack Dependency with Channel Declaration

Scaffolds that post to Slack via incoming webhook should include a `channels:` block inside the Slack dependency. This declares which channels the tentacle needs access to beyond its home enclave channel:

```yaml
contract:
  version: "1"
  dependencies:
    slack:
      protocol: https
      host: hooks.slack.com
      port: 443
      auth:
        type: webhook-url
        secret: slack.webhook_url
      channels:
        - name: default
          access: post
```

The `channels:` block is a list of objects with two fields:

| Field | Description |
|-------|-------------|
| `name` | Channel name. Use `default` for the enclave's primary channel. |
| `access` | Access level: `post` (send messages), `listen` (receive events), or `listen+post` (both). |

The `channels:` block is optional — scaffolds without it have no declared channel requirements beyond what the webhook URL itself provides. When a tentacle needs to post to a specific named channel, set `name` to the channel name (e.g., `incidents`, `alerts`) instead of `default`.
