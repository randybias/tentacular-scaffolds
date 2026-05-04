import type { Context } from "tentacular";
import type { DeduplicateFramesOutput } from "./deduplicate-frames.ts";

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
}

interface BatchAnalysis {
  batch_index: number;
  frame_range: [number, number];
  analysis: string;
}

export interface AnalyzeFramesOutput {
  batch_analyses: BatchAnalysis[];
  frames_analyzed: number;
  batches: number;
  model: string;
  title: string;
}

/**
 * Analyze deduplicated frames with batched Claude Vision API calls.
 * Each batch includes accumulated context from prior batches so the
 * analysis builds a coherent narrative across the full video.
 */
export default async function run(
  ctx: Context,
  input: unknown,
): Promise<AnalyzeFramesOutput> {
  const data = input as DeduplicateFramesOutput;
  const cfg = ctx.config as Record<string, unknown>;
  const analysisCfg = (cfg["analysis"] as Record<string, unknown>) ?? {};
  const maxFrames = Number(cfg["max_frames"] ?? 100);
  const batchSize = Number(analysisCfg["batch_size"] ?? 10);
  const contextPrompt = data.context_prompt;

  const framePaths = data.frames.slice(0, maxFrames);
  const totalBatches = Math.ceil(framePaths.length / batchSize);

  ctx.log.info(
    `Analyzing ${framePaths.length} frames in ${totalBatches} batches (batch_size=${batchSize})`,
  );

  const anthropic = ctx.dependency("anthropic");

  if (!anthropic.secret) {
    ctx.log.warn("No Anthropic API key configured — returning mock analysis");
    return mockAnalysis(framePaths.length, data.title);
  }

  const batchAnalyses: BatchAnalysis[] = [];
  let runningContext = "";

  for (let b = 0; b < totalBatches; b++) {
    const start = b * batchSize;
    const end = Math.min(start + batchSize, framePaths.length);
    const batchPaths = framePaths.slice(start, end);

    const frameImages: Array<{
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    }> = [];

    for (const framePath of batchPaths) {
      try {
        const bytes = await Deno.readFile(framePath);
        const chunks: string[] = [];
        for (let i = 0; i < bytes.length; i += 8192) {
          chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
        }
        const b64 = btoa(chunks.join(""));
        frameImages.push({
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: b64 },
        });
      } catch (err) {
        ctx.log.warn(`Skipping frame ${framePath}: ${err}`);
      }
    }

    if (frameImages.length === 0) continue;

    const contextPreamble = runningContext
      ? `Previous analysis context:\n${runningContext}\n\n`
      : "";

    const userPrompt =
      `${contextPreamble}These are frames ${start + 1}-${end} of ${framePaths.length} ` +
      `extracted from a video. ${contextPrompt}\n\n` +
      `Describe what is happening in these frames: key visual content, ` +
      `any text or slides visible, notable changes or events. ` +
      `End with a 2-sentence summary of this segment that can serve as ` +
      `context for analyzing the next batch of frames.`;

    const res = await anthropic.fetch!("/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropic.secret,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [...frameImages, { type: "text", text: userPrompt }],
          },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      if (res.status === 401 || res.status === 403) {
        ctx.log.warn("Anthropic API auth failed — returning mock analysis");
        return mockAnalysis(framePaths.length, data.title);
      }
      throw new Error(
        `Anthropic API error: ${res.status} — ${errText.slice(0, 300)}`,
      );
    }

    const completionRaw = (await res.json()) as Record<string, unknown>;
    const content = completionRaw["content"] as AnthropicResponse["content"] | undefined;
    const analysisText = content?.find((b) => b.type === "text")?.text?.trim() ?? "";

    batchAnalyses.push({
      batch_index: b,
      frame_range: [start, end - 1],
      analysis: analysisText,
    });

    // Extract the last two sentences as rolling context for next batch
    const sentences = analysisText.split(/(?<=[.!?])\s+/);
    runningContext = sentences.slice(-2).join(" ");

    ctx.log.info(
      `Batch ${b + 1}/${totalBatches} complete (frames ${start + 1}-${end})`,
    );
  }

  return {
    batch_analyses: batchAnalyses,
    frames_analyzed: framePaths.length,
    batches: batchAnalyses.length,
    model: "claude-3-haiku-20240307",
    title: data.title,
  };
}

function mockAnalysis(frameCount: number, title: string): AnalyzeFramesOutput {
  return {
    batch_analyses: [
      {
        batch_index: 0,
        frame_range: [0, frameCount - 1],
        analysis: `Mock analysis: ${frameCount} frames from video`,
      },
    ],
    frames_analyzed: frameCount,
    batches: 1,
    model: "mock",
    title,
  };
}
