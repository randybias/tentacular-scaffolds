# video-frame-analyzer

Extract frames from a video using an ffmpeg sidecar, then analyze them with Claude Vision.

## What it does

1. **ingest-video** — Fetches a video from a URL and stages it to `/shared/input/video.mp4` on the shared emptyDir volume
2. **extract-frames** — POSTs to the ffmpeg sidecar (`localhost:9000/extract-frames`), which reads the video from `/shared/input/` and writes extracted JPEG frames to `/shared/output/`
3. **analyze-frames** — Reads the frame files from `/shared/output/`, sends them to Claude Vision as base64-encoded images, and returns a structured analysis; falls back to a mock analysis if no API key is configured

## Sidecar pattern demonstrated

This scaffold uses the **shared volume** data flow pattern: large binary files (video, frame images) travel via an emptyDir volume mounted at `/shared` in both the engine and sidecar containers. The engine stages the input file, the sidecar processes it, and the engine reads the results — all without transferring file contents over HTTP.

Contrast with `doc-converter` which uses pure HTTP body data flow for smaller text payloads.

## Quick start

```bash
tntc scaffold init video-frame-analyzer my-video-wf
cd my-video-wf

# Edit workflow.yaml: set config.video_url to a real MP4 URL
# Set your Anthropic API key in secrets.yaml

tntc deploy
tntc run
```

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `video_url` | example.com/sample.mp4 | URL of the MP4 video to analyze |
| `fps` | `1` | Frames per second to extract |
| `output_format` | `jpg` | Frame image format |
| `max_frames` | `10` | Max frames sent to Claude Vision (controls API cost) |

## Performance (from Track B research on eastus ARM64 cluster)

| Video | File Size | Duration | fps=1 | Frames | ffmpeg Time |
|-------|-----------|----------|-------|--------|-------------|
| Small | 968 KB | 10s | 1 | 10 | ~280ms |
| Medium | 46 MB | 60s | 1 | 60 | ~3s |
| Large | 112 MB | 300s | 1 | 300 | ~7.5s |

## Secrets

- `anthropic.api_key` — Claude API key for Vision analysis (optional; mock fallback used if absent)

## ffmpeg sidecar image

The sidecar image (`ghcr.io/randybias/tentacular-ffmpeg-sidecar:v1.0.0`) wraps ffmpeg with a
Python HTTP server exposing:

- `GET /health` — `{"status": "ok", "ffmpeg": "/usr/local/bin/ffmpeg"}`
- `POST /extract-frames` — request: `{"input": "/shared/input/video.mp4", "fps": 1, "output_dir": "/shared/output"}`, response: `{"frames": [...], "count": N, "duration_ms": M}`

The image runs on ARM64 and AMD64, compatible with gVisor and PSA restricted profile.

## Notes

- The shared volume is mounted at `/shared` in both engine and sidecar containers
- A `/tmp` emptyDir is also mounted for the ffmpeg sidecar (required for temp files with `readOnlyRootFilesystem: true`)
- Both containers run as uid 65534 (nobody) — files created on the shared volume are cross-readable
- Update the `video-source` contract dependency if you change `video_url` to a different hostname
