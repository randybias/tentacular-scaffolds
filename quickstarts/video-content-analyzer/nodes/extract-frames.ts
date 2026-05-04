import type { Context } from "tentacular";
import type { IngestVideoOutput } from "./ingest-video.ts";

interface ExtractFramesResponse {
  frames: string[];
  count: number;
  duration_ms: number;
  input: string;
  fps: number;
  output_dir: string;
}

export interface ExtractFramesOutput {
  frames: string[];
  count: number;
  duration_ms: number;
  title: string;
  context_prompt: string;
}

/**
 * Extract frames from the staged video using the ffmpeg sidecar.
 * POSTs to localhost:9000/extract-frames. Files flow via /shared/ volume.
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
    `Extracting frames from ${data.video_path} at ${fps}fps`,
  );

  await Deno.mkdir(outputDir, { recursive: true });

  const res = await globalThis.fetch("http://localhost:9000/extract-frames", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: data.video_path,
      fps,
      output_dir: outputDir,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(
      `ffmpeg sidecar error: HTTP ${res.status} — ${errBody.slice(0, 500)}`,
    );
  }

  const result = (await res.json()) as ExtractFramesResponse;

  ctx.log.info(
    `Extracted ${result.count} frames in ${result.duration_ms}ms`,
  );

  return {
    frames: result.frames,
    count: result.count,
    duration_ms: result.duration_ms,
    title: data.title,
    context_prompt: data.context_prompt,
  };
}
