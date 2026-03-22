import type { Context } from "tentacular";

interface IncidentBrief {
  severity: string;
  brief: string;
  suggestedActions: string[];
  relatedDeploy: string;
  service: string;
  metric: string;
  timestamp: string;
}

interface PageResult {
  paged: boolean;
  skipped: boolean;
  reason: string;
}

/** If P1/P2, page on-call via PagerDuty API. If P3/P4, skip. */
export default async function run(ctx: Context, input: unknown): Promise<PageResult> {
  const brief = input as IncidentBrief;

  // Access dependency early for contract drift detection
  const pagerduty = ctx.dependency("pagerduty");

  // Only page for P1 and P2 severity
  if (brief.severity !== "P1" && brief.severity !== "P2") {
    ctx.log.info(`Severity ${brief.severity} does not require paging, skipping`);
    return { paged: false, skipped: true, reason: `Severity ${brief.severity} below paging threshold` };
  }
  if (!pagerduty.secret) {
    ctx.log.warn("No pagerduty.api_key in secrets, cannot page on-call");
    return { paged: false, skipped: false, reason: "No PagerDuty credentials" };
  }

  ctx.log.info(`Paging on-call for ${brief.severity} incident: ${brief.service}`);

  try {
    const res = await pagerduty.fetch!("/incidents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "From": "tentacular@example.com",
      },
      body: JSON.stringify({
        incident: {
          type: "incident",
          title: `[${brief.severity}] ${brief.service}: ${brief.metric} alert`,
          urgency: brief.severity === "P1" ? "high" : "low",
          body: {
            type: "incident_body",
            details: [
              brief.brief,
              "",
              "Suggested Actions:",
              ...brief.suggestedActions.map((a) => `- ${a}`),
              brief.relatedDeploy ? `\nPossibly related deploy: ${brief.relatedDeploy}` : "",
            ].join("\n"),
          },
          service: {
            type: "service_reference",
            id: brief.service,
          },
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      ctx.log.error(`PagerDuty API failed: ${res.status} ${errBody}`);
      return { paged: false, skipped: false, reason: `PagerDuty API error: ${res.status}` };
    }

    const data = await res.json();
    ctx.log.info(`PagerDuty incident created: ${data.incident?.id ?? "unknown"}`);
    return { paged: true, skipped: false, reason: "Paged successfully" };
  } catch (err) {
    ctx.log.error(`Failed to page on-call: ${err instanceof Error ? err.message : String(err)}`);
    return { paged: false, skipped: false, reason: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}
