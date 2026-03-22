import type { Context } from "tentacular";

interface Alert {
  alertId: number;
  repo: string;
  severity: string;
  package: string;
  ecosystem: string;
  cvss: number;
  epss: number;
  summary: string;
  createdAt: string;
  htmlUrl: string;
}

interface DeduplicateResult {
  netNewAlerts: Alert[];
  totalStored: number;
  totalNew: number;
}

interface PrioritizedDigest {
  digestMarkdown: string;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  totalNew: number;
  topItems: { repo: string; package: string; severity: string; summary: string }[];
}

/** Use LLM to prioritize and summarize net-new security alerts */
export default async function run(ctx: Context, input: unknown): Promise<PrioritizedDigest> {
  const data = input as DeduplicateResult;

  if (data.netNewAlerts.length === 0) {
    ctx.log.info("No net-new alerts to prioritize");
    return {
      digestMarkdown: "No new security alerts today.",
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      totalNew: 0,
      topItems: [],
    };
  }

  // Count by severity
  const criticalCount = data.netNewAlerts.filter((a) => a.severity === "critical").length;
  const highCount = data.netNewAlerts.filter((a) => a.severity === "high").length;
  const mediumCount = data.netNewAlerts.filter((a) => a.severity === "medium").length;
  const lowCount = data.netNewAlerts.filter((a) => a.severity === "low").length;

  // Build alert summary for LLM
  const alertSummary = data.netNewAlerts
    .sort((a, b) => b.cvss - a.cvss)
    .map((a) =>
      `- [${a.severity.toUpperCase()}] ${a.repo}: ${a.package} (CVSS ${a.cvss}) - ${a.summary} (${a.htmlUrl})`
    )
    .join("\n");

  const anthropic = ctx.dependency("anthropic");
  if (!anthropic.secret) {
    ctx.log.warn("No Anthropic API key, returning raw summary without LLM analysis");
    const topItems = data.netNewAlerts.slice(0, 3).map((a) => ({
      repo: a.repo,
      package: a.package,
      severity: a.severity,
      summary: a.summary,
    }));
    return {
      digestMarkdown: `## New Security Alerts (${data.totalNew})\n\n${alertSummary}`,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      totalNew: data.totalNew,
      topItems,
    };
  }

  ctx.log.info(`Sending ${data.netNewAlerts.length} alerts to LLM for prioritization`);

  const prompt = `You are a security analyst. Analyze these new Dependabot security alerts and produce a prioritized digest.

Group alerts by severity (Critical, High, Medium, Low). For each group, list the alerts.
Highlight the top 3 most critical items with specific recommended actions (e.g., "upgrade package X to version Y").
Be concise and actionable. Output in Markdown format.

Alerts:
${alertSummary}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropic.secret,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  let digestMarkdown: string;

  if (!res.ok) {
    ctx.log.error(`Anthropic API error: ${res.status} ${res.statusText}`);
    digestMarkdown = `## New Security Alerts (${data.totalNew})\n\n${alertSummary}`;
  } else {
    const body = await res.json();
    const content = body.content?.[0];
    digestMarkdown = content?.type === "text" ? content.text : alertSummary;
  }

  const topItems = data.netNewAlerts
    .sort((a, b) => b.cvss - a.cvss)
    .slice(0, 3)
    .map((a) => ({
      repo: a.repo,
      package: a.package,
      severity: a.severity,
      summary: a.summary,
    }));

  ctx.log.info(`Digest generated: ${criticalCount} critical, ${highCount} high, ${mediumCount} medium, ${lowCount} low`);

  return {
    digestMarkdown,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    totalNew: data.totalNew,
    topItems,
  };
}
