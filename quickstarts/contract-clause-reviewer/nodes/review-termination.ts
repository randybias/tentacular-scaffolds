import type { Context } from "tentacular";
import type { ExtractResult } from "./extract-text.ts";

export interface ClauseFinding {
  clause: string;
  location: string;
  risk_level: "low" | "medium" | "high" | "critical";
  explanation: string;
}

export interface ReviewOutput {
  reviewType: string;
  findings: ClauseFinding[];
}

/** Anthropic Messages API response (minimal subset) */
interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
}

/** Analyze contract text for termination rights, auto-renewal, exit terms, and notice periods */
export default async function run(ctx: Context, input: unknown): Promise<ReviewOutput> {
  const { documents } = input as ExtractResult;

  if (documents.length === 0) {
    ctx.log.info("No documents to review");
    return { reviewType: "termination", findings: [] };
  }

  ctx.log.info(`Reviewing ${documents.length} document(s) for termination clauses`);

  const anthropic = ctx.dependency("anthropic");
  if (!anthropic.secret) {
    ctx.log.warn("No anthropic API key, skipping termination review");
    return { reviewType: "termination", findings: [] };
  }

  const allFindings: ClauseFinding[] = [];

  for (const doc of documents) {
    if (!doc.fullText) continue;

    const prompt = `You are a legal contract analyst specializing in termination and exit provisions.

Analyze the following contract text and identify all termination, renewal, and exit clauses. For each clause found, assess the risk level.

Contract: ${doc.fileName}
Text:
${doc.fullText.substring(0, 15000)}

Respond ONLY with JSON:
{
  "findings": [
    {
      "clause": "the relevant clause text or summary",
      "location": "section/paragraph reference if identifiable",
      "risk_level": "low|medium|high|critical",
      "explanation": "why this clause matters and what risk it poses"
    }
  ]
}

Focus on:
- Termination for convenience (who can, notice period)
- Termination for cause (what constitutes cause, cure periods)
- Auto-renewal clauses and opt-out windows
- Notice period requirements
- Exit assistance / transition obligations
- Data return / destruction upon termination
- Survival clauses (what persists after termination)
- Early termination penalties or fees`;

    try {
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
        ctx.log.error(`Anthropic API error for ${doc.fileName}: ${res.status}`);
        continue;
      }

      const completionRaw = await res.json() as Record<string, unknown>;
      const content = completionRaw["content"] as AnthropicResponse["content"] | undefined;
      const rawText = content?.find((b) => b.type === "text")?.text ?? "";

      if (rawText) {
        const jsonStr = rawText.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
        const parsed = JSON.parse(jsonStr);
        allFindings.push(...(parsed.findings ?? []));
      }
    } catch (err) {
      ctx.log.warn(`Error reviewing ${doc.fileName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  ctx.log.info(`Found ${allFindings.length} termination findings`);
  return { reviewType: "termination", findings: allFindings };
}
