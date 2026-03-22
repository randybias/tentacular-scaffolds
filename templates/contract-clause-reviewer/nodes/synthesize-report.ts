import type { Context } from "tentacular";
import type { ExtractResult } from "./extract-text.ts";
import type { ReviewOutput } from "./review-liability.ts";

export interface RiskReport {
  overallRiskScore: number; // 1-10
  criticalFindings: string[];
  negotiationPoints: string[];
  summary: string;
  reviewsByType: Record<string, ReviewOutput>;
}

/** Fan-in input: one key per parent node name */
interface SynthesizeInput {
  "extract-text": ExtractResult;
  "review-liability": ReviewOutput;
  "review-ip-rights": ReviewOutput;
  "review-termination": ReviewOutput;
  "review-compliance": ReviewOutput;
}

/** Anthropic Messages API response (minimal subset) */
interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
}

/** Synthesize all 4 review outputs into a unified risk report using LLM */
export default async function run(ctx: Context, input: unknown): Promise<RiskReport> {
  const data = input as SynthesizeInput;
  const docs = data["extract-text"];
  const liability = data["review-liability"];
  const ipRights = data["review-ip-rights"];
  const termination = data["review-termination"];
  const compliance = data["review-compliance"];

  const totalFindings =
    liability.findings.length +
    ipRights.findings.length +
    termination.findings.length +
    compliance.findings.length;

  ctx.log.info(
    `Synthesizing risk report — ` +
    `liability=${liability.findings.length}, ip=${ipRights.findings.length}, ` +
    `termination=${termination.findings.length}, compliance=${compliance.findings.length}`,
  );

  const reviewsByType: Record<string, ReviewOutput> = {
    liability,
    "ip-rights": ipRights,
    termination,
    compliance,
  };

  const anthropic = ctx.dependency("anthropic");
  if (!anthropic.secret || totalFindings === 0) {
    ctx.log.warn(totalFindings === 0 ? "No findings to synthesize" : "No anthropic API key");
    return {
      overallRiskScore: totalFindings === 0 ? 1 : 5,
      criticalFindings: [],
      negotiationPoints: [],
      summary: totalFindings === 0
        ? "No clause findings detected. Manual review recommended."
        : "AI synthesis unavailable.",
      reviewsByType,
    };
  }

  const formatFindings = (review: ReviewOutput): string =>
    review.findings.length === 0
      ? "None found."
      : review.findings
          .map((f) => `- [${f.risk_level.toUpperCase()}] ${f.clause}\n  Location: ${f.location}\n  ${f.explanation}`)
          .join("\n");

  const docNames = docs.documents.map((d) => d.fileName).join(", ");

  const prompt = `You are a senior legal risk analyst synthesizing clause-level findings into an executive risk report.

## Documents Reviewed
${docNames}

## Liability & Indemnification Findings
${formatFindings(liability)}

## IP & Data Rights Findings
${formatFindings(ipRights)}

## Termination & Exit Findings
${formatFindings(termination)}

## Regulatory Compliance Findings
${formatFindings(compliance)}

## Your Task

Produce a unified risk assessment. Respond ONLY with JSON:
{
  "overallRiskScore": <1-10, where 1=minimal risk, 10=do not sign>,
  "criticalFindings": ["list of findings that must be addressed before signing"],
  "negotiationPoints": ["list of specific clauses to negotiate, with suggested changes"],
  "summary": "2-3 paragraph executive summary of the contract risk posture"
}

Rules:
- Be specific about clause references
- Critical findings = anything that could cause significant financial or legal exposure
- Negotiation points = concrete changes, not vague suggestions
- Score 1-3: low risk (standard terms). 4-6: moderate (some concerning clauses). 7-8: high (significant risk). 9-10: critical (do not sign without major changes)`;

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
    return {
      overallRiskScore: 5,
      criticalFindings: [],
      negotiationPoints: [],
      summary: "AI synthesis returned empty response.",
      reviewsByType,
    };
  }

  try {
    const jsonStr = rawText.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
    const parsed = JSON.parse(jsonStr);

    ctx.log.info(`Risk report synthesized — overall score: ${parsed.overallRiskScore}`);

    return {
      overallRiskScore: Math.max(1, Math.min(10, Number(parsed.overallRiskScore) || 5)),
      criticalFindings: (parsed.criticalFindings as string[]) ?? [],
      negotiationPoints: (parsed.negotiationPoints as string[]) ?? [],
      summary: (parsed.summary as string) ?? "",
      reviewsByType,
    };
  } catch (err) {
    ctx.log.error(`Failed to parse AI response: ${rawText.slice(0, 200)}`);
    throw new Error(`AI returned invalid JSON: ${err}`);
  }
}
