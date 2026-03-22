# Tentacular Scaffold Library

A browsable library of production-ready scaffold quickstarts for [Tentacular](https://github.com/randybias/tentacular). Scaffolds can be browsed on the web at [randybias.github.io/tentacular-scaffolds](https://randybias.github.io/tentacular-scaffolds) or installed via `tntc scaffold init`.

**Documentation:** [Catalog Usage Guide](https://randybias.github.io/tentacular-docs/guides/catalog-usage/) | [Scaffold Reference](https://randybias.github.io/tentacular-docs/reference/catalog/agent-activity-report/)

## Quick Start

```bash
# List all available scaffolds
tntc scaffold list

# Search scaffolds by keyword
tntc scaffold search monitoring

# View details about a specific scaffold
tntc scaffold info uptime-prober

# Scaffold a new workflow from a quickstart
tntc scaffold init hn-digest my-news-digest
```

## Ecosystem

| Repository | Description |
|---|---|
| [tentacular](https://github.com/randybias/tentacular) | CLI + workflow engine |
| [tentacular-mcp](https://github.com/randybias/tentacular-mcp) | MCP server for Kubernetes lifecycle |
| [tentacular-skill](https://github.com/randybias/tentacular-skill) | Claude Code skill for building workflows |
| [tentacular-scaffolds](https://github.com/randybias/tentacular-scaffolds) | Scaffold quickstart library (this repo) |
| [tentacular-docs](https://github.com/randybias/tentacular-docs) | [Documentation site](https://randybias.github.io/tentacular-docs) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a new scaffold to the library.

## License

Copyright (c) 2025-2026 Mirantis, Inc. All rights reserved. See [LICENSE](LICENSE).
