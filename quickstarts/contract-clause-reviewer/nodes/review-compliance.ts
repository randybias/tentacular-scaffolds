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

/** Analyze contract text for regulatory compliance (GDPR, SOX, HIPAA as configured) */
export default async function run(ctx: Context, input: unknown): Promise<ReviewOutput> {
  const { documents } = input as ExtractResult;

  if (documents.length === 0) {
    ctx.log.info("No documents to review");
    return { reviewType: "compliance", findings: [] };
  }

  const frameworks = (ctx.config.compliance_frameworks as string[]) ?? ["GDPR"];
  ctx.log.info(`Reviewing ${documents.length} document(s) for compliance: ${frameworks.join(", ")}`);

  const anthropic = ctx.dependency("anthropic");
  if (!anthropic.secret) {
    ctx.log.warn("No anthropic API key, skipping compliance review");
    return { reviewType: "compliance", findings: [] };
  }

  const allFindings: ClauseFinding[] = [];

  for (const doc of documents) {
    if (!doc.fullText) continue;

    const frameworksList = frameworks
      .map((f) => {
        switch (f.toUpperCase()) {
          case "GDPR":
            return "- GDPR: data processing agreements, data subject rights, cross-border transfers, DPO requirements, breach notification";
          case "SOX":
            return "- SOX: internal controls, audit trail requirements, financial reporting accuracy, record retention";
          case "HIPAA":
            return "- HIPAA: protected health information, BAA requirements, security safeguards, breach notification";
          default:
            return `- ${f}: general compliance requirements`;
        }
      })
      .join("\n");

    const prompt = `You are a legal contract analyst specializing in regulatory compliance.

Analyze the following contract text for compliance with these regulatory frameworks:
${frameworksList}

Contract: ${doc.fileName}
Text:
${doc.fullText.substring(0, 15000)}

Respond ONLY with JSON:
{
  "findings": [
    {
      "clause": "the relevant clause text or summary (or 'MISSING' if required clause is absent)",
      "location": "section/paragraph reference if identifiable",
      "risk_level": "low|medium|high|critical",
      "explanation": "compliance gap or concern and remediation suggestion"
    }
  ]
}

For each framework, check for:
- Required clauses that are present (note if they are adequate or insufficient)
- Required clauses that are MISSING (these are typically high/critical risk)
- Clauses that conflict with regulatory requirements`;

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

  ctx.log.info(`Found ${allFindings.length} compliance findings`);
  return { reviewType: "compliance", findings: allFindings };
}
