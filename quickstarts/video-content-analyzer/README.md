# video-content-analyzer

Extract frames from video using an ffmpeg sidecar (with yt-dlp for YouTube downloads), deduplicate frames with perceptual hashing, analyze unique frames in batches with Claude Vision, and compile a templated narrative report with editorial audit.

## Nodes

- **ingest-video** -- Downloads video from a URL (supports YouTube via yt-dlp on the sidecar)
- **extract-frames** -- Sends video to the ffmpeg sidecar to extract frames at configured FPS
- **deduplicate-frames** -- Removes near-duplicate frames using perceptual hashing (Hamming distance)
- **analyze-frames** -- Sends deduplicated frames to Claude Vision in batches for content analysis
- **compile-report** -- Assembles frame analyses into a structured narrative report
- **audit-and-publish** -- Runs editorial quality audit on the report and publishes final output

## Sidecar

- **ffmpeg** -- HTTP wrapper around ffmpeg and yt-dlp on port 9000. Provides `/download-youtube`, `/extract-frames`, and `/health` endpoints.

## Dependencies

- `anthropic` -- Anthropic Claude API for Vision analysis (bearer token)
- `video-source` -- Dynamic HTTPS targets for video download
- `tentacular-rustfs` -- RustFS for frame and report storage
- `tentacular-postgres` -- Postgres for metadata
- `slack-webhook` -- Slack webhook for notifications

## Trigger

- **manual**

## Notes

Node source files are not yet scaffolded (workflow.yaml defines the DAG but `nodes/` directory does not exist).
