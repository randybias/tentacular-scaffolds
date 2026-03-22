import type { Context } from "tentacular";

interface NormalizedAlert {
  service: string;
  metric: string;
  value: string;
  threshold: string;
  timestamp: string;
  source: string;
}

interface AlertHistory {
  recentAlerts: number;
  lastAlert: string;
  recurringPattern: boolean;
  averageResolutionTime: number;
}

interface RunbookResult {
  runbookContent: string;
  found: boolean;
}

interface Deploy {
  sha: string;
  author: string;
  message: string;
  mergedAt: string;
}

interface DeploysResult {
  recentDeploys: Deploy[];
}

interface IncidentBrief {
  severity: string;
  brief: string;
  suggestedActions: string[];
  relatedDeploy: string;
  service: string;
  metric: string;
  timestamp: string;
}

/** Fan-in from all context sources. LLM classifies severity (P1-P4) and generates incident brief. */
export default async function run(ctx: Context, input: unknown): Promise<IncidentBrief> {
  // The DAG engine merges inputs from all upstream nodes
  const merged = input as {
    "receive-alert"?: NormalizedAlert;
    "query-history"?: AlertHistory;
    "fetch-runbook"?: RunbookResult;
    "query-deploys"?: DeploysResult;
  } & NormalizedAlert & AlertHistory & RunbookResult & DeploysResult;

  // Extract data from merged input (DAG may flatten or nest)
  const alert: NormalizedAlert = merged["receive-alert"] ?? {
    service: merged.service ?? "unknown",
    metric: merged.metric ?? "unknown",
    value: merged.value ?? "0",
    threshold: merged.threshold ?? "0",
    timestamp: merged.timestamp ?? new Date().toISOString(),
    source: merged.source ?? "unknown",
  };

  const history: AlertHistory = merged["query-history"] ?? {
    recentAlerts: merged.recentAlerts ?? 0,
    lastAlert: merged.lastAlert ?? "",
    recurringPattern: merged.recurringPattern ?? false,
    averageResolutionTime: merged.averageResolutionTime ?? 0,
  };

  const runbook: RunbookResult = merged["fetch-runbook"] ?? {
    runbookContent: merged.runbookContent ?? "",
    found: merged.found ?? false,
  };

  const deploys: DeploysResult = merged["query-deploys"] ?? {
    recentDeploys: merged.recentDeploys ?? [],
  };

  const anthropic = ctx.dependency("anthropic");
  if (!anthropic.secret) {
    ctx.log.warn("No anthropic.api_key -- using fallback classification");
    return {
      severity: "P3",
      brief: `Alert for ${alert.service}: ${alert.metric} = ${alert.value} (threshold: ${alert.threshold})`,
      suggestedActions: ["Investigate manually"],
      relatedDeploy: "",
      service: alert.service,
      metric: alert.metric,
      timestamp: alert.timestamp,
    };
  }

  const contextParts: string[] = [
    `## Alert Details`,
    `- Service: ${alert.service}`,
    `- Metric: ${alert.metric}`,
    `- Current Value: ${alert.value}`,
    `- Threshold: ${alert.threshold}`,
    `- Timestamp: ${alert.timestamp}`,
    ``,
    `## Alert History (30 days)`,
    `- Recent alerts: ${history.recentAlerts}`,
    `- Last alert: ${history.lastAlert || "None"}`,
    `- Recurring pattern: ${history.recurringPattern}`,
    `- Average resolution time: ${history.averageResolutionTime}s`,
  ];

  if (runbook.found) {
    contextParts.push(``, `## Runbook`, runbook.runbookContent.substring(0, 2000));
  }

  if (deploys.recentDeploys.length > 0) {
    contextParts.push(``, `## Recent Deploys (last 48h)`);
    for (const d of deploys.recentDeploys.slice(0, 10)) {
      contextParts.push(`- ${d.sha} by ${d.author}: ${d.message} (${d.mergedAt})`);
    }
  }

  const systemPrompt = `You are an incident response classifier. Given an alert with context, classify its severity and produce an incident brief.

Respond in JSON format:
{
  "severity": "P1" | "P2" | "P3" | "P4",
  "brief": "concise incident description",
  "suggestedActions": ["action1", "action2"],
  "relatedDeploy": "sha or empty string if none suspected"
}

Severity guide:
- P1: Service down, customer-facing impact, data loss risk
- P2: Degraded performance, partial outage, approaching limits
- P3: Warning threshold crossed, no current impact
- P4: Informational, needs investigation but not urgent`;

  ctx.log.info(`Classifying alert for ${alert.service} with Claude`);

  const res = await anthropic.fetch!("/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: contextParts.join("\n") }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    ctx.log.error(`Anthropic API failed: ${res.status} ${body}`);
    return {
      severity: "P3",
      brief: `Alert for ${alert.service}: ${alert.metric} = ${alert.value}`,
      suggestedActions: ["Investigate manually"],
      relatedDeploy: "",
      service: alert.service,
      metric: alert.metric,
      timestamp: alert.timestamp,
    };
  }

  const data = await res.json();
  const responseText = data.content?.[0]?.text ?? "{}";

  try {
    const parsed = JSON.parse(responseText);
    const brief: IncidentBrief = {
      severity: parsed.severity ?? "P3",
      brief: parsed.brief ?? `Alert for ${alert.service}`,
      suggestedActions: parsed.suggestedActions ?? [],
      relatedDeploy: parsed.relatedDeploy ?? "",
      service: alert.service,
      metric: alert.metric,
      timestamp: alert.timestamp,
    };

    ctx.log.info(`Classified as ${brief.severity}: ${brief.brief}`);
    return brief;
  } catch {
    ctx.log.warn("Failed to parse LLM response, using raw text as brief");
    return {
      severity: "P3",
      brief: responseText.substring(0, 500),
      suggestedActions: ["Investigate manually"],
      relatedDeploy: "",
      service: alert.service,
      metric: alert.metric,
      timestamp: alert.timestamp,
    };
  }
}
