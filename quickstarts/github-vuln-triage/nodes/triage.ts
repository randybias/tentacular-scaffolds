import type { Context } from "tentacular";
import type { EnrichOutput, EnrichedAlert } from "./enrich-context.ts";

export interface TriagedAlert extends EnrichedAlert {
  priority: "critical_action" | "high_track" | "low_log";
  triageReason: string;
  suggestedRemediation: string;
}

export interface TriageOutput {
  criticalAction: TriagedAlert[];
  highTrack: TriagedAlert[];
  lowLog: TriagedAlert[];
  totalTriaged: number;
  org: string;
}

/** Anthropic Messages API response (minimal subset) */
interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
}

/** LLM-powered triage: prioritize alerts based on severity, repo criticality, and exposure */
export default async function run(ctx: Context, input: unknown): Promise<TriageOutput> {
  const data = input as EnrichOutput;

  if (data.alerts.length === 0) {
    ctx.log.info("No alerts to triage");
    return { criticalAction: [], highTrack: [], lowLog: [], totalTriaged: 0, org: data.org };
  }

  ctx.log.info(`Triaging ${data.alerts.length} enriched alerts`);

  const anthropic = ctx.dependency("anthropic");

  if (!anthropic.secret) {
    // Fallback: rule-based triage without LLM
    ctx.log.warn("No anthropic API key, using rule-based triage");
    return ruleBasedTriage(data);
  }

  // Build alert summary for LLM
  const alertSummary = data.alerts.map((a, i) => (
    `[${i}] ${a.source}/${a.repo}#${a.alertId}: ${a.severity} - ${a.identifier} - "${a.summary}"\n` +
    `    CVSS: ${a.cvss} | Customer-facing: ${a.repoContext.customer_facing} | ` +
    `Env: ${a.repoContext.environment} | Team: ${a.repoContext.team}`
  )).join("\n");

  const prompt = `You are a security engineer triaging vulnerability alerts. Prioritize based on:
- Severity (critical > high > medium > low)
- Repo criticality (customer_facing + production = highest)
- CVSS score
- Exposure (public-facing services > internal tools)

## Alerts to Triage
${alertSummary}

## Respond with JSON (array of objects, one per alert index):
[
  {
    "index": 0,
    "priority": "critical_action|high_track|low_log",
    "reason": "brief explanation of priority decision",
    "remediation": "specific remediation steps"
  }
]

Rules:
- critical_action: needs immediate GitHub Issue + Slack alert. Use for: critical/high severity in customer-facing production repos, or any CVSS >= 9.0
- high_track: needs tracking in weekly report. Use for: medium severity in production, or high severity in internal repos
- low_log: log only. Use for: low severity, or anything in non-production environments`;

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
      ctx.log.error(`Anthropic API error: ${res.status}, falling back to rule-based triage`);
      return ruleBasedTriage(data);
    }

    const completionRaw = await res.json() as Record<string, unknown>;
    const content = completionRaw["content"] as AnthropicResponse["content"] | undefined;
    const rawText = content?.find((b) => b.type === "text")?.text ?? "";

    if (!rawText) {
      ctx.log.warn("Empty AI response, using rule-based triage");
      return ruleBasedTriage(data);
    }

    const jsonStr = rawText.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
    const triageDecisions: Array<{ index: number; priority: string; reason: string; remediation: string }> = JSON.parse(jsonStr);

    const criticalAction: TriagedAlert[] = [];
    const highTrack: TriagedAlert[] = [];
    const lowLog: TriagedAlert[] = [];

    for (const decision of triageDecisions) {
      const alert = data.alerts[decision.index];
      if (!alert) continue;

      const triaged: TriagedAlert = {
        ...alert,
        priority: decision.priority as TriagedAlert["priority"],
        triageReason: decision.reason,
        suggestedRemediation: decision.remediation,
      };

      switch (triaged.priority) {
        case "critical_action":
          criticalAction.push(triaged);
          break;
        case "high_track":
          highTrack.push(triaged);
          break;
        default:
          lowLog.push(triaged);
      }
    }

    ctx.log.info(`Triage complete — critical: ${criticalAction.length}, high: ${highTrack.length}, low: ${lowLog.length}`);
    return { criticalAction, highTrack, lowLog, totalTriaged: data.alerts.length, org: data.org };
  } catch (err) {
    ctx.log.error(`LLM triage failed: ${err instanceof Error ? err.message : String(err)}`);
    return ruleBasedTriage(data);
  }
}

/** Fallback rule-based triage without LLM */
function ruleBasedTriage(data: EnrichOutput): TriageOutput {
  const criticalAction: TriagedAlert[] = [];
  const highTrack: TriagedAlert[] = [];
  const lowLog: TriagedAlert[] = [];

  for (const alert of data.alerts) {
    const isProduction = alert.repoContext.environment === "production";
    const isCustomerFacing = alert.repoContext.customer_facing;
    const isCritical = alert.severity === "critical" || alert.cvss >= 9.0;
    const isHigh = alert.severity === "high" || alert.cvss >= 7.0;

    let priority: TriagedAlert["priority"];
    let reason: string;

    if (isCritical && isProduction && isCustomerFacing) {
      priority = "critical_action";
      reason = `Critical severity in customer-facing production repo (CVSS: ${alert.cvss})`;
    } else if (isCritical || (isHigh && isProduction)) {
      priority = "high_track";
      reason = `${alert.severity} severity${isProduction ? " in production" : ""}`;
    } else {
      priority = "low_log";
      reason = `${alert.severity} severity in ${alert.repoContext.environment} environment`;
    }

    const triaged: TriagedAlert = {
      ...alert,
      priority,
      triageReason: reason,
      suggestedRemediation: `Update ${alert.identifier} to latest patched version`,
    };

    switch (priority) {
      case "critical_action":
        criticalAction.push(triaged);
        break;
      case "high_track":
        highTrack.push(triaged);
        break;
      default:
        lowLog.push(triaged);
    }
  }

  return { criticalAction, highTrack, lowLog, totalTriaged: data.alerts.length, org: data.org };
}
