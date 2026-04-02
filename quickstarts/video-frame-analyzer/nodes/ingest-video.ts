import type { Context } from "tentacular";

/** Output passed to extract-frames */
export interface IngestVideoOutput {
  video_path: string;
  size_bytes: number;
  source_url: string;
}

/**
 * Fetch a video from a URL and stage it to the shared volume at /shared/input/video.mp4.
 *
 * The ffmpeg sidecar reads from /shared/input/ — both containers mount the same emptyDir
 * volume at /shared, so files written here are immediately visible to the sidecar.
 */
export default async function run(
  ctx: Context,
  _input: unknown,
): Promise<IngestVideoOutput> {
  const cfg = ctx.config as Record<string, unknown>;
  const videoUrl = String(cfg["video_url"] ?? "");

  if (!videoUrl) {
    throw new Error("config.video_url is required");
  }

  ctx.log.info(`Fetching video from ${videoUrl}`);

  // Use globalThis.fetch for absolute URLs. dependency.fetch() prepends the
  // dependency's base URL, which doubles the URL for absolute paths.
  // The "video-source" dependency is declared in the contract so the engine
  // grants network access to the host — but fetch goes direct.
  const res = await globalThis.fetch(videoUrl);

  if (!res.ok) {
    throw new Error(`Failed to fetch video: HTTP ${res.status} from ${videoUrl}`);
  }

  const videoBytes = new Uint8Array(await res.arrayBuffer());
  const videoPath = "/shared/input/video.mp4";

  // Ensure input directory exists on the shared volume
  await Deno.mkdir("/shared/input", { recursive: true });

  // Write video bytes to shared volume — ffmpeg sidecar will read from here
  await Deno.writeFile(videoPath, videoBytes);

  ctx.log.info(`Staged ${videoBytes.length} bytes to ${videoPath}`);

  return {
    video_path: videoPath,
    size_bytes: videoBytes.length,
    source_url: videoUrl,
  };
}
