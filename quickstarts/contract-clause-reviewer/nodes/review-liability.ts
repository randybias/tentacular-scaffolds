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

/** Analyze contract text for liability and indemnification clauses */
export default async function run(ctx: Context, input: unknown): Promise<ReviewOutput> {
  const { documents } = input as ExtractResult;

  if (documents.length === 0) {
    ctx.log.info("No documents to review");
    return { reviewType: "liability", findings: [] };
  }

  ctx.log.info(`Reviewing ${documents.length} document(s) for liability clauses`);

  const anthropic = ctx.dependency("anthropic");
  if (!anthropic.secret) {
    ctx.log.warn("No anthropic API key, skipping liability review");
    return { reviewType: "liability", findings: [] };
  }

  const allFindings: ClauseFinding[] = [];

  for (const doc of documents) {
    if (!doc.fullText) continue;

    const prompt = `You are a legal contract analyst specializing in liability and indemnification.

Analyze the following contract text and identify all liability and indemnification clauses. For each clause found, assess the risk level.

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
- Unlimited liability exposure
- Indemnification obligations (one-sided vs mutual)
- Cap on damages (or lack thereof)
- Consequential/indirect damages exclusions
- Insurance requirements
- Hold harmless provisions`;

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

  ctx.log.info(`Found ${allFindings.length} liability findings`);
  return { reviewType: "liability", findings: allFindings };
}
