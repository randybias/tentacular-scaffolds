## Why

Sidecar support needs production-ready scaffold quickstarts that demonstrate the feature end-to-end. These are the first sidecar-enabled scaffolds and serve as canonical examples for users and agents building sidecar workflows. Without scaffolds, users would have to build sidecar workflows from scratch with no reference implementation.

## What Changes

### Scaffold 1: video-frame-analyzer

A complete scaffold quickstart demonstrating CPU-bound media processing with an ffmpeg sidecar:

```
quickstarts/video-frame-analyzer/
  scaffold.yaml              # name, displayName, description, category: data-pipeline, complexity: moderate
  workflow.yaml              # sidecars + contract + nodes + edges + triggers
  params.schema.yaml         # video_url, fps, output_format parameters
  nodes/
    ingest-video.ts          # Fetch video to /shared/input/, POST to ffmpeg sidecar
    extract-frames.ts        # Call sidecar /extract-frames, collect frame paths
    analyze-frames.ts        # Send frames to Claude Vision, produce analysis
  tests/fixtures/
    ingest-video.json        # Input/expected for ingest node
    extract-frames.json      # Input/expected for extraction node
    analyze-frames.json      # Input/expected for analysis node (mock Claude response)
  contract-summary.md        # Derived: Anthropic API egress, ffmpeg sidecar on localhost:9000
  workflow-diagram.md        # Mermaid DAG: ingest -> extract -> analyze
  .secrets.yaml.example      # anthropic: $shared.anthropic
  README.md                  # Scaffold-specific usage notes
```

**Pattern validated:** CPU-bound media processing, large file I/O via shared volume, gVisor + PSA compatibility.

### Scaffold 2: Second Use Case (TBD)

A second scaffold demonstrating a different sidecar workload type. Top candidate is `web-page-archiver` (headless Chromium), which validates:
- Memory-heavy sidecar (different resource profile from ffmpeg)
- Sidecar requiring external network access (via contract dependency)
- Multi-sidecar pod capability

The PM and Architect will finalize the second use case. Alternatives include `doc-converter` (Pandoc) or a Python ML inference scaffold.

### Index Regeneration

- `scaffolds-index.yaml` regenerated via `scripts/build-index.sh` to include new scaffolds
- CI validation (`.github/workflows/validate.yaml`) passes for both scaffolds

## Requirements

1. `video-frame-analyzer` scaffold must include all standard scaffold files (scaffold.yaml, workflow.yaml, params.schema.yaml, nodes/, tests/fixtures/, contract-summary.md, workflow-diagram.md, .secrets.yaml.example, README.md)
2. `workflow.yaml` must use the new `sidecars:` top-level section from the tentacular spec
3. `scaffold.yaml` must follow existing conventions (category, tags, complexity fields)
4. `params.schema.yaml` must define video_url, fps, and output_format parameters
5. Node code must demonstrate the `fetch("http://localhost:PORT/path")` sidecar communication pattern
6. Node code must demonstrate shared volume file handoff (`/shared/input/`, `/shared/output/`)
7. `analyze-frames.ts` must include a mock fallback for demo/test contexts without an Anthropic API key
8. Test fixtures must provide realistic input/expected pairs for each node
9. Second scaffold must demonstrate a distinctly different sidecar workload type
10. `scaffolds-index.yaml` must be regenerated and include both new scaffolds
11. Both scaffolds must pass CI validation

## Acceptance Criteria

- [ ] `quickstarts/video-frame-analyzer/` directory exists with all standard files
- [ ] `scaffold.yaml` has correct metadata (name, displayName, category: data-pipeline, complexity: moderate)
- [ ] `workflow.yaml` declares an ffmpeg sidecar with port 9000 and health check
- [ ] `workflow.yaml` includes contract dependency for Anthropic API
- [ ] `params.schema.yaml` defines video_url, fps, output_format parameters
- [ ] `ingest-video.ts` fetches video and writes to `/shared/input/`
- [ ] `extract-frames.ts` calls ffmpeg sidecar at `localhost:9000`
- [ ] `analyze-frames.ts` sends frames to Claude Vision with mock fallback
- [ ] Test fixtures exist for all three nodes
- [ ] `contract-summary.md` documents egress and sidecar communication
- [ ] `workflow-diagram.md` contains Mermaid DAG
- [ ] Second use case scaffold exists with all standard files
- [ ] `scaffolds-index.yaml` regenerated with both new scaffolds
- [ ] `scripts/build-index.sh` runs successfully
- [ ] CI validation passes for both scaffolds
- [ ] `tntc scaffold init video-frame-analyzer my-video-wf` succeeds

## Scope

### In Scope

- `video-frame-analyzer` scaffold (all standard files)
- Second use case scaffold (all standard files, TBD selection)
- `scaffolds-index.yaml` regeneration
- CI validation

### Out of Scope

- Building the actual ffmpeg sidecar Docker image (separate deliverable)
- Building the second use case sidecar Docker image
- E2E cluster deployment testing (separate QA task)
- Changes to existing scaffolds
- Changes to `scripts/build-index.sh` itself (unless needed for new fields)

## Dependencies

- `tentacular/openspec/changes/sidecar-support/` -- the `sidecars:` spec field must be implemented before workflow.yaml can use it
