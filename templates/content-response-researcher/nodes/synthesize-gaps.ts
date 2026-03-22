import type { Context } from "tentacular";
import type { ArticleContent } from "./fetch-article.ts";
import type { ResearchOutput } from "./research-supporting.ts";

export interface ContrarianOpportunity {
  angle: string;
  evidence: string;
  why_it_matters: string;
}

export interface GapAnalysis {
  mainThesis: string;
  supportStrength: string;
  weaknesses: string[];
  unexploredAngles: string[];
  contrarian_opportunity: ContrarianOpportunity;
}

/** Fan-in input: one key per parent node name */
interface SynthesizeInput {
  "fetch-article": ArticleContent;
  "research-supporting": ResearchOutput;
  "research-contrary": ResearchOutput;
  "research-adjacent": ResearchOutput;
}

/** Anthropic Messages API response (minimal subset) */
interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
}

/** Synthesize all research into a gap analysis using LLM */
export default async function run(ctx: Context, input: unknown): Promise<GapAnalysis> {
  const data = input as SynthesizeInput;
  const article = data["fetch-article"];
  const supporting = data["research-supporting"];
  const contrary = data["research-contrary"];
  const adjacent = data["research-adjacent"];

  ctx.log.info(
    `Synthesizing gaps for "${article.title}" — ` +
    `supporting=${supporting.sources.length}, contrary=${contrary.sources.length}, ` +
    `adjacent=${adjacent.sources.length}`,
  );

  const anthropic = ctx.dependency("anthropic");
  if (!anthropic.secret) {
    ctx.log.warn("No anthropic API key, returning placeholder");
    return {
      mainThesis: article.title,
      supportStrength: "unknown (no AI available)",
      weaknesses: [],
      unexploredAngles: [],
      contrarian_opportunity: {
        angle: "N/A",
        evidence: "N/A",
        why_it_matters: "AI analysis unavailable",
      },
    };
  }

  const supportingList = supporting.sources
    .map((s) => `- ${s.title}: ${s.snippet.substring(0, 200)}`)
    .join("\n");

  const contraryList = contrary.sources
    .map((s) => `- ${s.title}: ${s.snippet.substring(0, 200)}`)
    .join("\n");

  const adjacentList = adjacent.sources
    .map((s) => `- ${s.title}: ${s.snippet.substring(0, 200)}`)
    .join("\n");

  const prompt = `You are an expert content strategist analyzing an article and research to find contrarian content opportunities.

## Original Article
Title: ${article.title}
URL: ${article.url}
Published: ${article.publishedDate}

Content (first 3000 chars):
${article.content.substring(0, 3000)}

## Supporting Research (agrees with thesis)
${supportingList || "None found."}

## Contrary Research (disagrees with thesis)
${contraryList || "None found."}

## Adjacent Research (tangential angles)
${adjacentList || "None found."}

## Your Task

Analyze the article and all research to produce a gap analysis. Respond ONLY with JSON:

{
  "mainThesis": "one-sentence summary of article's main argument",
  "supportStrength": "weak|moderate|strong — how well-supported is the thesis?",
  "weaknesses": ["list of specific logical gaps, missing evidence, or flawed assumptions"],
  "unexploredAngles": ["list of angles nobody is covering that are relevant"],
  "contrarian_opportunity": {
    "angle": "the single best contrarian angle for a response article",
    "evidence": "what evidence supports this contrarian take",
    "why_it_matters": "why readers should care about this angle"
  }
}`;

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
      mainThesis: article.title,
      supportStrength: "unknown",
      weaknesses: [],
      unexploredAngles: [],
      contrarian_opportunity: { angle: "N/A", evidence: "N/A", why_it_matters: "N/A" },
    };
  }

  try {
    const jsonStr = rawText.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
    const parsed = JSON.parse(jsonStr) as GapAnalysis;
    ctx.log.info(`Gap analysis complete — thesis strength: ${parsed.supportStrength}`);
    return parsed;
  } catch (err) {
    ctx.log.error(`Failed to parse AI response: ${rawText.slice(0, 200)}`);
    throw new Error(`AI returned invalid JSON: ${err}`);
  }
}
