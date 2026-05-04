import type { Context } from "tentacular";

/** Runtime input passed via wf_run */
export interface IngestVideoInput {
  video_url: string;
  title?: string;
  context_prompt?: string;
}

export interface IngestVideoOutput {
  video_path: string;
  size_bytes: number;
  source_url: string;
  title: string;
  context_prompt: string;
}

const YOUTUBE_PATTERNS = [
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
];

function extractYouTubeId(url: string): string | null {
  for (const pattern of YOUTUBE_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/** Sidecar port for ffmpeg + yt-dlp operations */
const SIDECAR_PORT = 9000;

/**
 * Fetch a video from a URL and stage it to /shared/input/video.mp4.
 * Supports YouTube URLs (resolved via Piped/Invidious APIs)
 * and direct MP4 URLs. Per-run fields (video_url, title, context_prompt)
 * come from runtime input via wf_run.
 */
export default async function run(
  ctx: Context,
  input: unknown,
): Promise<IngestVideoOutput> {
  // wf_run sends input as a byte array due to MCP json.RawMessage schema —
  // decode if we receive an array of numbers instead of a plain object
  let parsed = input ?? {};
  if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "number") {
    const decoded = new TextDecoder().decode(new Uint8Array(parsed as number[]));
    parsed = JSON.parse(decoded);
  }
  const data = parsed as Partial<IngestVideoInput>;
  const cfg = ctx.config as Record<string, unknown>;
  const reportCfg = (cfg["report"] as Record<string, unknown>) ?? {};

  const videoUrl = data.video_url ?? "";
  let title = data.title ?? "";
  const contextPrompt = data.context_prompt ??
    "Analyze the visual content of this video.";

  if (!videoUrl) {
    throw new Error("input.video_url is required — pass it via wf_run input");
  }

  const videoPath = "/shared/input/video.mp4";
  await Deno.mkdir("/shared/input", { recursive: true });

  const ytId = extractYouTubeId(videoUrl);

  if (ytId) {
    ctx.log.info(`Detected YouTube video ID: ${ytId} — downloading via sidecar yt-dlp`);

    // Use the ffmpeg sidecar's /download-youtube endpoint.
    // yt-dlp runs outside gVisor so JS signature deciphering works.
    const dlRes = await globalThis.fetch(`http://localhost:${SIDECAR_PORT}/download-youtube`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: videoUrl, output: videoPath }),
    });

    if (!dlRes.ok) {
      const err = await dlRes.text();
      throw new Error(`yt-dlp download failed: ${err}`);
    }

    const dlData = await dlRes.json() as { output: string; size_bytes: number; title: string };
    ctx.log.info(`Downloaded ${dlData.size_bytes} bytes via yt-dlp in sidecar`);

    if (!title && dlData.title) {
      title = dlData.title;
    }

    return {
      video_path: videoPath,
      size_bytes: dlData.size_bytes,
      source_url: videoUrl,
      title: title || "Video Analysis Report",
      context_prompt: contextPrompt,
    };
  }

  // Direct URL path
  ctx.log.info(`Fetching video from ${videoUrl}`);
  const res = await globalThis.fetch(videoUrl);

  if (!res.ok) {
    throw new Error(`Failed to fetch video: HTTP ${res.status} from ${videoUrl}`);
  }

  const videoBytes = new Uint8Array(await res.arrayBuffer());
  await Deno.writeFile(videoPath, videoBytes);

  ctx.log.info(`Staged ${videoBytes.length} bytes to ${videoPath}`);

  return {
    video_path: videoPath,
    size_bytes: videoBytes.length,
    source_url: videoUrl,
    title: title || String(reportCfg["title"] ?? "Video Analysis Report"),
    context_prompt: contextPrompt,
  };
}
