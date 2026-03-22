# Tentacular Scaffolds — Agent Instructions

Browsable library of production-ready scaffold quickstarts for the Tentacular platform — a security-first, agent-centric, DAG-based workflow builder and runner for Kubernetes. Published as a GitHub Pages site at [randybias.github.io/tentacular-scaffolds](https://randybias.github.io/tentacular-scaffolds).

## Related Repositories

| Repository | Purpose |
|------------|---------|
| [tentacular](https://github.com/randybias/tentacular) | Go CLI (`tntc`) + Deno workflow engine |
| [tentacular-mcp](https://github.com/randybias/tentacular-mcp) | In-cluster MCP server (Go, Helm chart) |
| [tentacular-skill](https://github.com/randybias/tentacular-skill) | Agent skill definition (Markdown) |
| [tentacular-scaffolds](https://github.com/randybias/tentacular-scaffolds) | Scaffold quickstart library (this repo) |

## How Scaffolds Are Used

Scaffolds are not meant to be edited directly in this repo. They are consumed via the `tntc` CLI:

```bash
tntc scaffold list                    # Browse available scaffolds
tntc scaffold init <scaffold> <name>  # Scaffold a new workflow from a quickstart
```

The CLI fetches scaffolds from this repo via GitHub raw URLs or local path. Direct contributions follow the process in `CONTRIBUTING.md`.

## Project Structure

- `scaffolds-index.yaml` — auto-generated metadata index of all scaffolds (do not edit manually)
- `quickstarts/` — one subdirectory per scaffold, each containing:
  - `scaffold.yaml` — scaffold metadata (name, category, complexity, etc.)
  - `workflow.yaml` — the workflow definition
  - `nodes/*.ts` — TypeScript node source files
  - `tests/fixtures/` — test fixture data (optional)
  - `.secrets.yaml.example` — documents required secrets (optional)
  - `README.md` — scaffold-specific documentation (optional)
- `scripts/build-index.sh` — regenerates `scaffolds-index.yaml` from scaffold metadata (requires `yq`)
- `site/` — GitHub Pages static site generation
  - `build.sh` — builds site data
  - `index.html` — site entry point

## Scaffold Metadata Format

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

## CI/CD

GitHub Actions handles validation and publishing:

- **On PR:** validates scaffold structure and metadata
- **On push to main:** regenerates `scaffolds-index.yaml` and deploys the GitHub Pages site

There is no Makefile or local build system. To regenerate the scaffolds index locally:

```bash
./scripts/build-index.sh
```

## Commit Messages

All repos use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
feat: add uptime-prober template
fix: correct node import in hn-digest
docs: update pr-review template README
```

## Versioning

All four repos use **lockstep versioning** — they are tagged with the same version number for every release, even if a repo has no changes. Tags use semantic versioning: `vMAJOR.MINOR.PATCH`. The catalog site deploys on push to main independently of version tags.

## Temporary Files

Use `scratch/` for all temporary files, experiments, and throwaway work. This directory is gitignored. Never place temp files in the project root or alongside source code.

## License

MIT (Mirantis, Inc.)
