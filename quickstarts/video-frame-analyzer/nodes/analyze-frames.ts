import type { Context } from "tentacular";
import type { ExtractFramesOutput } from "./extract-frames.ts";

/** Anthropic Messages API response (minimal subset) */
interface AnthropicResponse {
  content: Array<{ type: string; text?: string; source?: unknown }>;
}

/** Final output of the video-frame-analyzer workflow */
export interface AnalyzeFramesOutput {
  analysis: string;
  frames_analyzed: number;
  model: string;
}

/**
 * Read extracted frames from /shared/output/ and send them to Claude Vision for analysis.
 *
 * Sends up to config.max_frames frames as base64-encoded images in a single Claude request.
 * Falls back to a mock analysis when the Anthropic API key is unavailable, so this scaffold
 * works in test and demo contexts without credentials.
 */
export default async function run(
  ctx: Context,
  input: unknown,
): Promise<AnalyzeFramesOutput> {
  const data = input as ExtractFramesOutput;
  const cfg = ctx.config as Record<string, unknown>;
  const maxFrames = Number(cfg["max_frames"] ?? 10);

  const framePaths = data.frames.slice(0, maxFrames);

  ctx.log.info(
    `Analyzing ${framePaths.length} of ${data.count} frames (max_frames=${maxFrames})`,
  );

  // Read frame bytes and base64-encode for the Vision API
  const frameImages: Array<{ type: "image"; source: { type: "base64"; media_type: string; data: string } }> = [];
  for (const framePath of framePaths) {
    try {
      const bytes = await Deno.readFile(framePath);
      const b64 = btoa(String.fromCharCode(...bytes));
      frameImages.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: b64 },
      });
    } catch (err) {
      ctx.log.warn(`Skipping frame ${framePath}: ${err}`);
    }
  }

  if (frameImages.length === 0) {
    throw new Error("No frames could be read from /shared/output/");
  }

  // --- Call Anthropic Messages API with Vision ---
  const anthropic = ctx.dependency("anthropic");

  if (!anthropic.secret) {
    ctx.log.warn("No Anthropic API key configured — returning mock analysis");
    return mockAnalysis(framePaths.length);
  }

  const res = await anthropic.fetch!("/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropic.secret,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            ...frameImages,
            {
              type: "text",
              text:
                `These are ${frameImages.length} frames extracted from a video at 1 frame per second. ` +
                `Please provide a concise analysis of the video content: what is happening, ` +
                `who or what is visible, any notable events or changes across frames, ` +
                `and a brief overall summary.`,
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    // Fall back to mock if auth fails (missing/invalid API key)
    if (res.status === 401 || res.status === 403) {
      ctx.log.warn("Anthropic API auth failed — returning mock analysis");
      return mockAnalysis(framePaths.length);
    }
    throw new Error(`Anthropic API error: ${res.status} — ${errText.slice(0, 300)}`);
  }

  const completionRaw = await res.json() as Record<string, unknown>;
  const content = completionRaw["content"] as AnthropicResponse["content"] | undefined;
  const rawText = content?.find((b) => b.type === "text")?.text?.trim() ?? "";

  if (!rawText) {
    ctx.log.warn("Empty AI response — returning mock analysis");
    return mockAnalysis(framePaths.length);
  }

  ctx.log.info(`Analysis complete (${rawText.length} chars)`);

  return {
    analysis: rawText,
    frames_analyzed: frameImages.length,
    model: "claude-opus-4-6",
  };
}

function mockAnalysis(frameCount: number): AnalyzeFramesOutput {
  return {
    analysis: `Mock analysis: ${frameCount} frames extracted from video`,
    frames_analyzed: frameCount,
    model: "mock",
  };
}
