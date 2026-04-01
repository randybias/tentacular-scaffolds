import type { Context } from "tentacular";
import type { IngestVideoOutput } from "./ingest-video.ts";

/** ffmpeg sidecar POST /extract-frames response */
interface ExtractFramesResponse {
  frames: string[];
  count: number;
  duration_ms: number;
  input: string;
  fps: number;
  output_dir: string;
}

/** Output passed to analyze-frames */
export interface ExtractFramesOutput {
  frames: string[];
  count: number;
  duration_ms: number;
}

/**
 * Extract frames from the staged video using the ffmpeg sidecar.
 *
 * POSTs a JSON request to the ffmpeg HTTP wrapper on localhost:9000.
 * The sidecar reads the video from /shared/input/ and writes frames to /shared/output/.
 * Both paths are on the shared emptyDir volume — no file transfer over the network.
 */
export default async function run(
  ctx: Context,
  input: unknown,
): Promise<ExtractFramesOutput> {
  const data = input as IngestVideoOutput;
  const cfg = ctx.config as Record<string, unknown>;
  const fps = Number(cfg["fps"] ?? 1);
  const outputDir = "/shared/output";

  ctx.log.info(
    `Extracting frames from ${data.video_path} at ${fps}fps → ${outputDir}`,
  );

  // Ensure output directory exists on the shared volume
  await Deno.mkdir(outputDir, { recursive: true });

  const reqBody = JSON.stringify({
    input: data.video_path,
    fps,
    output_dir: outputDir,
  });

  const res = await fetch("http://localhost:9000/extract-frames", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: reqBody,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(
      `ffmpeg sidecar error: HTTP ${res.status} — ${errBody.slice(0, 500)}`,
    );
  }

  const result = await res.json() as ExtractFramesResponse;

  ctx.log.info(
    `Extracted ${result.count} frames in ${result.duration_ms}ms`,
  );

  return {
    frames: result.frames,
    count: result.count,
    duration_ms: result.duration_ms,
  };
}
