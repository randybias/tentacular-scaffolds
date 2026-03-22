import type { Context } from "tentacular";

interface UnifiedCustomerRecord {
  accountId: string;
  usage: Record<string, unknown> | null;
  tickets: Record<string, unknown> | null;
  billing: Record<string, unknown> | null;
  surveys: Record<string, unknown> | null;
  dataCompleteness: number;
}

interface NormalizeResult {
  customers: UnifiedCustomerRecord[];
  totalAccounts: number;
}

interface HealthScore {
  accountId: string;
  score: number;
  explanation: string;
  redFlags: string[];
  greenFlags: string[];
}

interface ScoreResult {
  scores: HealthScore[];
}

/** Use LLM to score each customer's health 1-100 based on all signals */
export default async function run(ctx: Context, input: unknown): Promise<ScoreResult> {
  const data = input as NormalizeResult;

  // Access dependency early for contract drift detection
  const anthropic = ctx.dependency("anthropic");

  if (data.customers.length === 0) {
    ctx.log.info("No customers to score");
    return { scores: [] };
  }
  if (!anthropic.secret) {
    ctx.log.warn("No anthropic.api_key -- using heuristic scoring");
    return { scores: heuristicScoring(data.customers) };
  }

  const systemPrompt = `You are a customer health scoring engine. For each customer, analyze all available signals and return a health score from 1 to 100.

Respond with a JSON array of objects:
[{
  "accountId": "string",
  "score": number (1-100, where 100 is healthiest),
  "explanation": "brief explanation",
  "redFlags": ["flag1", "flag2"],
  "greenFlags": ["flag1", "flag2"]
}]

Scoring guidelines:
- Usage decline + open escalations + failed payments = very high churn risk (score < 30)
- Declining NPS + reduced seats + low feature adoption = moderate risk (score 30-60)
- Growing usage + good NPS + expanding seats = healthy (score > 60)
- Weight missing data as neutral, note it in explanation`;

  // Process in batches of 10 to keep context manageable
  const scores: HealthScore[] = [];
  const batchSize = 10;

  for (let i = 0; i < data.customers.length; i += batchSize) {
    const batch = data.customers.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    ctx.log.info(`Scoring batch ${batchNum} (${batch.length} customers)`);

    const customerSummaries = batch.map((c) =>
      JSON.stringify({
        accountId: c.accountId,
        dataCompleteness: c.dataCompleteness,
        usage: c.usage,
        tickets: c.tickets,
        billing: c.billing,
        surveys: c.surveys,
      })
    ).join("\n\n");

    try {
      const res = await anthropic.fetch!("/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: customerSummaries }],
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        ctx.log.error(`Anthropic API failed for batch ${batchNum}: ${res.status} ${body}`);
        scores.push(...heuristicScoring(batch));
        continue;
      }

      const responseData = await res.json();
      const responseText = responseData.content?.[0]?.text ?? "[]";

      try {
        const parsed = JSON.parse(responseText) as HealthScore[];
        scores.push(...parsed);
      } catch {
        ctx.log.warn(`Failed to parse LLM response for batch ${batchNum}, using heuristics`);
        scores.push(...heuristicScoring(batch));
      }
    } catch (err) {
      ctx.log.error(`Batch ${batchNum} failed: ${err instanceof Error ? err.message : String(err)}`);
      scores.push(...heuristicScoring(batch));
    }
  }

  ctx.log.info(`Scored ${scores.length} customers`);
  return { scores };
}

/** Fallback heuristic scoring when LLM is unavailable */
function heuristicScoring(customers: UnifiedCustomerRecord[]): HealthScore[] {
  return customers.map((c) => {
    let score = 50;
    const redFlags: string[] = [];
    const greenFlags: string[] = [];

    if (c.usage) {
      const usage = c.usage as Record<string, number | string>;
      if (usage.trend === "declining") { score -= 15; redFlags.push("Declining usage"); }
      if (usage.trend === "increasing") { score += 10; greenFlags.push("Growing usage"); }
      if ((usage.featureAdoption as number) < 20) { score -= 10; redFlags.push("Low feature adoption"); }
    }

    if (c.tickets) {
      const tickets = c.tickets as Record<string, number>;
      if (tickets.escalations > 0) { score -= 10; redFlags.push(`${tickets.escalations} escalation(s)`); }
      if (tickets.avgSentiment < -0.5) { score -= 10; redFlags.push("Negative sentiment"); }
    }

    if (c.billing) {
      const billing = c.billing as Record<string, number | string>;
      if ((billing.failedPayments as number) > 0) { score -= 15; redFlags.push("Failed payments"); }
      if (billing.planChange === "canceling") { score -= 20; redFlags.push("Plan cancellation pending"); }
      if ((billing.mrrChange as number) > 0) { score += 5; greenFlags.push("MRR growing"); }
    }

    if (c.surveys) {
      const surveys = c.surveys as Record<string, number | string>;
      if ((surveys.latestNPS as number) >= 8) { score += 10; greenFlags.push("High NPS"); }
      if ((surveys.latestNPS as number) <= 4) { score -= 10; redFlags.push("Low NPS"); }
    }

    score = Math.max(1, Math.min(100, score));

    return {
      accountId: c.accountId,
      score,
      explanation: `Heuristic score based on ${c.dataCompleteness}% data completeness`,
      redFlags,
      greenFlags,
    };
  });
}
