import type { Context } from "tentacular";
import type { GapAnalysis } from "./synthesize-gaps.ts";

export interface OutlineSection {
  heading: string;
  keyPoints: string[];
  supportingEvidence: string[];
}

export interface ResponseOutline {
  titleOptions: string[];
  thesis: string;
  sections: OutlineSection[];
  contrarian_hook: string;
  estimated_word_count: number;
}

/** Anthropic Messages API response (minimal subset) */
interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
}

/** Generate a structured response outline from the gap analysis using LLM */
export default async function run(ctx: Context, input: unknown): Promise<ResponseOutline> {
  const gapAnalysis = input as GapAnalysis;

  ctx.log.info(`Generating outline for contrarian angle: "${gapAnalysis.contrarian_opportunity.angle}"`);

  const anthropic = ctx.dependency("anthropic");
  if (!anthropic.secret) {
    ctx.log.warn("No anthropic API key, returning placeholder outline");
    return {
      titleOptions: ["Response to: " + gapAnalysis.mainThesis],
      thesis: gapAnalysis.contrarian_opportunity.angle,
      sections: [],
      contrarian_hook: gapAnalysis.contrarian_opportunity.angle,
      estimated_word_count: 0,
    };
  }

  const prompt = `You are an expert content strategist creating a response article outline.

## Gap Analysis
Main thesis of original: ${gapAnalysis.mainThesis}
Support strength: ${gapAnalysis.supportStrength}

Weaknesses identified:
${gapAnalysis.weaknesses.map((w) => `- ${w}`).join("\n") || "None"}

Unexplored angles:
${gapAnalysis.unexploredAngles.map((a) => `- ${a}`).join("\n") || "None"}

Best contrarian opportunity:
- Angle: ${gapAnalysis.contrarian_opportunity.angle}
- Evidence: ${gapAnalysis.contrarian_opportunity.evidence}
- Why it matters: ${gapAnalysis.contrarian_opportunity.why_it_matters}

## Your Task

Create a structured OUTLINE (not a full draft) for a response article. Respond ONLY with JSON:

{
  "titleOptions": ["3 compelling title options"],
  "thesis": "one-sentence thesis for the response",
  "sections": [
    {
      "heading": "section heading",
      "keyPoints": ["bullet points of key arguments"],
      "supportingEvidence": ["specific data, quotes, or sources to cite"]
    }
  ],
  "contrarian_hook": "the opening hook that grabs attention by challenging conventional wisdom",
  "estimated_word_count": 1500
}

Rules:
- 4-6 sections
- Each section should have 2-4 key points
- Include specific evidence references, not vague gestures
- The hook should be provocative but intellectually honest
- Target 1200-2000 words`;

  const res = await anthropic.fetch!("/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropic.secret,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`);
  }

  const completionRaw = await res.json() as Record<string, unknown>;
  const content = completionRaw["content"] as AnthropicResponse["content"] | undefined;
  const rawText = content?.find((b) => b.type === "text")?.text ?? "";

  if (!rawText) {
    ctx.log.warn("No AI response, returning placeholder");
    return {
      titleOptions: ["Response to: " + gapAnalysis.mainThesis],
      thesis: gapAnalysis.contrarian_opportunity.angle,
      sections: [],
      contrarian_hook: gapAnalysis.contrarian_opportunity.angle,
      estimated_word_count: 0,
    };
  }

  try {
    const jsonStr = rawText.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
    const parsed = JSON.parse(jsonStr) as ResponseOutline;
    ctx.log.info(`Outline generated — ${parsed.sections.length} sections, ~${parsed.estimated_word_count} words`);
    return parsed;
  } catch (err) {
    ctx.log.error(`Failed to parse AI response: ${rawText.slice(0, 200)}`);
    throw new Error(`AI returned invalid JSON: ${err}`);
  }
}
