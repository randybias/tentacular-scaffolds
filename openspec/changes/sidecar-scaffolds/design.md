# Design: Sidecar Scaffolds — tentacular-scaffolds/

## Overview

Create two production-ready scaffold quickstarts that validate the sidecar pattern across different workload profiles. These are the first sidecar-enabled scaffolds in the catalog.

---

## 1. Scaffold: `video-frame-analyzer`

**Category:** `data-pipeline`
**Complexity:** `moderate`
**Pattern:** CPU-bound media processing, large file I/O via shared volume

### File List

```
quickstarts/video-frame-analyzer/
├── scaffold.yaml
├── workflow.yaml
├── params.schema.yaml
├── nodes/
│   ├── ingest-video.ts
│   ├── extract-frames.ts
│   └── analyze-frames.ts
├── tests/
│   └── fixtures/
│       ├── ingest-video.json
│       ├── extract-frames.json
│       └── analyze-frames.json
├── contract-summary.md
├── workflow-diagram.md
├── .secrets.yaml.example
└── README.md
```

### `scaffold.yaml`

```yaml
name: video-frame-analyzer
displayName: "Video Frame Analyzer"
description: "Extract frames from video using an ffmpeg sidecar and analyze with Claude Vision"
category: data-pipeline
tags: [sidecar, ffmpeg, video-processing, llm-synthesis, shared-volume]
author: randybias
minTentacularVersion: "0.7.0"
complexity: moderate
```

### `workflow.yaml`

```yaml
name: video-frame-analyzer
version: "1.0"
description: "Extract frames from video using ffmpeg sidecar, analyze with Claude Vision"

sidecars:
  - name: ffmpeg
    image: ghcr.io/randybias/tentacular-ffmpeg-sidecar:v1.0.0
    port: 9000
    healthPath: /health
    resources:
      requests:
        cpu: 500m
        memory: 256Mi
      limits:
        cpu: 1000m
        memory: 512Mi

triggers:
  - type: manual

nodes:
  ingest-video:
    path: ./nodes/ingest-video.ts
  extract-frames:
    path: ./nodes/extract-frames.ts
  analyze-frames:
    path: ./nodes/analyze-frames.ts

edges:
  - from: ingest-video
    to: extract-frames
  - from: extract-frames
    to: analyze-frames

config:
  timeout: 300s
  retries: 0
  video_url: "https://example.com/sample.mp4"
  fps: 1
  output_format: jpg
  max_frames: 10

contract:
  version: "1"
  dependencies:
    anthropic:
      protocol: https
      host: api.anthropic.com
      port: 443
      auth:
        type: bearer-token
        secret: anthropic.api_key
    video-source:
      protocol: https
      host: example.com
      port: 443
```

**Key design points:**
- `sidecars:` is top-level, separate from `contract:`
- `video-source` dependency allows the engine to fetch the video via HTTPS
- `anthropic` dependency for Claude Vision analysis in the final node
- DAG: `ingest-video` -> `extract-frames` -> `analyze-frames` (linear pipeline)

### Node Signatures

**`ingest-video.ts`**
- Input: `{ config }` (video_url from workflow config)
- Action: Fetch video from URL, write to `/shared/input/video.mp4`
- Output: `{ video_path: "/shared/input/video.mp4", size_bytes: number }`

**`extract-frames.ts`**
- Input: `{ video_path }` from ingest-video
- Action: POST to `http://localhost:9000/extract-frames` with `{ input: video_path, fps: config.fps, output_dir: "/shared/output" }`
- Output: `{ frames: string[], count: number, duration_ms: number }`

**`analyze-frames.ts`**
- Input: `{ frames, count }` from extract-frames
- Action: Read frames from `/shared/output/`, send to Claude Vision API (up to `max_frames`), synthesize analysis
- Mock fallback: When Anthropic API key unavailable, return mock analysis (like pr-review's synthesize node)
- Output: `{ analysis: string, frames_analyzed: number, model: string }`

### `params.schema.yaml`

```yaml
version: "1"
description: "Parameters for the video-frame-analyzer scaffold"

parameters:
  video_url:
    path: config.video_url
    type: string
    description: "URL of the video to analyze"
    required: false
    default: "https://example.com/sample.mp4"
    example: "https://storage.example.com/meeting-recording.mp4"

  fps:
    path: config.fps
    type: number
    description: "Frames per second to extract (1 = one frame per second of video)"
    required: false
    default: 1
    example: 2

  output_format:
    path: config.output_format
    type: string
    description: "Output image format for extracted frames"
    required: false
    default: "jpg"
    example: "png"

  max_frames:
    path: config.max_frames
    type: number
    description: "Maximum number of frames to send to Claude Vision (controls API cost)"
    required: false
    default: 10
    example: 20
```

### Test Fixtures

**`tests/fixtures/ingest-video.json`**
```json
{
  "input": {},
  "expected": {
    "video_path": "/shared/input/video.mp4",
    "size_bytes": 968000
  }
}
```

**`tests/fixtures/extract-frames.json`**
```json
{
  "input": {
    "video_path": "/shared/input/video.mp4"
  },
  "expected": {
    "frames": ["/shared/output/frame_0001.jpg"],
    "count": 10,
    "duration_ms": 283
  }
}
```

**`tests/fixtures/analyze-frames.json`**
```json
{
  "input": {
    "frames": ["/shared/output/frame_0001.jpg"],
    "count": 10
  },
  "expected": {
    "analysis": "Mock analysis: 10 frames extracted from video",
    "frames_analyzed": 10,
    "model": "mock"
  }
}
```

### `.secrets.yaml.example`

```yaml
anthropic: $shared.anthropic
```

### `contract-summary.md`

```markdown
# Contract Summary: video-frame-analyzer

## External Dependencies
- **anthropic** — Claude Vision API (api.anthropic.com:443, bearer-token auth)
- **video-source** — Video file source (example.com:443, no auth)

## Sidecar Containers
- **ffmpeg** — Frame extraction service (localhost:9000, ghcr.io/randybias/tentacular-ffmpeg-sidecar:v1.0.0)

## Shared Volume
- `/shared/input/` — Video files staged by engine
- `/shared/output/` — Frames extracted by ffmpeg sidecar
```

### `workflow-diagram.md`

```markdown
# Workflow DAG: video-frame-analyzer

\`\`\`mermaid
graph LR
    A[ingest-video] --> B[extract-frames]
    B --> C[analyze-frames]

    subgraph "Sidecar: ffmpeg :9000"
        S[ffmpeg HTTP API]
    end

    B -.->|POST /extract-frames| S
    S -.->|frames via /shared| B
\`\`\`
```

---

## 2. Scaffold: `web-page-archiver`

**Category:** `data-pipeline`
**Complexity:** `moderate`
**Pattern:** Memory-intensive rendering, network-dependent sidecar, different resource profile

### Why Chromium / Headless Browser

This is the ideal second use case because it validates different dimensions than ffmpeg:

| Dimension | video-frame-analyzer (ffmpeg) | web-page-archiver (Chromium) |
|-----------|-------------------------------|------------------------------|
| Resource profile | CPU-bound | Memory-bound |
| Data flow | Large files via shared volume | Small payloads via HTTP body |
| External network | Sidecar has no external deps | Sidecar needs web access (contract dep) |
| gVisor stress test | Standard syscalls | Complex syscalls (Chromium sandbox) |
| Image size | ~160MB | ~400MB+ |

### File List

```
quickstarts/web-page-archiver/
├── scaffold.yaml
├── workflow.yaml
├── params.schema.yaml
├── nodes/
│   ├── fetch-urls.ts
│   ├── capture-pages.ts
│   └── generate-archive.ts
├── tests/
│   └── fixtures/
│       ├── fetch-urls.json
│       ├── capture-pages.json
│       └── generate-archive.json
├── contract-summary.md
├── workflow-diagram.md
├── .secrets.yaml.example
└── README.md
```

### `scaffold.yaml`

```yaml
name: web-page-archiver
displayName: "Web Page Archiver"
description: "Capture web pages as PDF/screenshot using a headless Chromium sidecar"
category: data-pipeline
tags: [sidecar, chromium, web-scraping, pdf-generation, headless-browser]
author: randybias
minTentacularVersion: "0.7.0"
complexity: moderate
```

### `workflow.yaml`

```yaml
name: web-page-archiver
version: "1.0"
description: "Archive web pages as PDF snapshots using headless Chromium sidecar"

sidecars:
  - name: chromium
    image: ghcr.io/randybias/tentacular-chromium-sidecar:v1.0.0
    port: 9001
    healthPath: /health
    resources:
      requests:
        cpu: 500m
        memory: 512Mi
      limits:
        cpu: 1000m
        memory: 1Gi

triggers:
  - type: manual

nodes:
  fetch-urls:
    path: ./nodes/fetch-urls.ts
  capture-pages:
    path: ./nodes/capture-pages.ts
  generate-archive:
    path: ./nodes/generate-archive.ts

edges:
  - from: fetch-urls
    to: capture-pages
  - from: capture-pages
    to: generate-archive

config:
  timeout: 600s
  retries: 0
  urls:
    - "https://example.com"
  output_format: pdf
  viewport_width: 1280
  viewport_height: 720

contract:
  version: "1"
  dependencies:
    target-sites:
      protocol: https
      host: example.com
      port: 443
```

**Key design points:**
- Chromium sidecar needs more memory (512Mi-1Gi) than ffmpeg (256Mi-512Mi)
- `target-sites` contract dependency gives the sidecar (via pod-level NetworkPolicy) external web access
- No Anthropic dependency — this scaffold is pure rendering, no LLM
- Port 9001 (different from ffmpeg's 9000) — validates multi-sidecar port uniqueness

### Node Signatures

**`fetch-urls.ts`**
- Input: `{ config }` (urls list from workflow config)
- Action: Validate and normalize URL list
- Output: `{ urls: string[], count: number }`

**`capture-pages.ts`**
- Input: `{ urls }` from fetch-urls
- Action: For each URL, POST to `http://localhost:9001/capture` with `{ url, format: config.output_format, viewport: { width, height } }`. Write results to `/shared/output/`.
- Output: `{ captures: Array<{ url: string, path: string, size_bytes: number }>, count: number }`

**`generate-archive.ts`**
- Input: `{ captures }` from capture-pages
- Action: Read captured files from `/shared/output/`, generate a manifest/index of all captures
- Output: `{ archive_path: string, total_pages: number, total_size_bytes: number }`

### `params.schema.yaml`

```yaml
version: "1"
description: "Parameters for the web-page-archiver scaffold"

parameters:
  urls:
    path: config.urls
    type: array
    description: "List of URLs to archive as PDF/screenshot"
    required: false
    default: ["https://example.com"]
    example: ["https://docs.example.com", "https://blog.example.com"]

  output_format:
    path: config.output_format
    type: string
    description: "Output format for page captures"
    required: false
    default: "pdf"
    example: "png"

  viewport_width:
    path: config.viewport_width
    type: number
    description: "Browser viewport width in pixels"
    required: false
    default: 1280
    example: 1920

  viewport_height:
    path: config.viewport_height
    type: number
    description: "Browser viewport height in pixels"
    required: false
    default: 720
    example: 1080
```

### `.secrets.yaml.example`

```yaml
# No secrets required — this scaffold uses public URLs only.
# Add auth secrets here if archiving authenticated pages.
```

### Chromium Sidecar Image

The sidecar image (`ghcr.io/randybias/tentacular-chromium-sidecar`) should expose:

- `GET /health` — returns `{"status": "ok"}`
- `POST /capture` — accepts `{ url, format, viewport }`, returns `{ path, size_bytes }` or streams the file
- `POST /screenshot` — shorthand for PNG capture
- `POST /pdf` — shorthand for PDF capture

Base image candidates: `browserless/chromium`, `ghcr.io/nicholasgasior/puppeteer-chromium`, or custom based on `node:20-slim` + Puppeteer.

**gVisor compatibility note:** Chromium's internal sandbox uses `clone()` and `seccomp()` syscalls that historically had issues with gVisor. Modern gVisor (2024+) supports these. The `--no-sandbox` Chromium flag is required when running as non-root (uid 65534) inside a container — this is safe because gVisor provides the outer sandbox.

---

## 3. Index Regeneration

After creating both scaffolds, run:

```bash
cd tentacular-scaffolds && scripts/build-index.sh
```

This regenerates `scaffolds-index.yaml` with entries for both new scaffolds. Verify:

```bash
yq eval '.scaffolds[] | select(.name == "video-frame-analyzer")' scaffolds-index.yaml
yq eval '.scaffolds[] | select(.name == "web-page-archiver")' scaffolds-index.yaml
```

---

## 4. CI Validation

Both scaffolds must pass the existing `.github/workflows/validate.yaml` CI workflow, which checks:
- `scaffold.yaml` has required fields
- `workflow.yaml` passes `tntc validate`
- `params.schema.yaml` is valid
- All node files referenced in `workflow.yaml` exist
- Test fixtures exist for all nodes

---

## 5. File Changes Summary

| File | Action |
|------|--------|
| `quickstarts/video-frame-analyzer/` | Create — full scaffold (12 files) |
| `quickstarts/web-page-archiver/` | Create — full scaffold (12 files) |
| `scaffolds-index.yaml` | Regenerate via `scripts/build-index.sh` |
