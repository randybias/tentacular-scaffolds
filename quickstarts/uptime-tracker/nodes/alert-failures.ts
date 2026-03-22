import type { Context } from "tentacular";

interface ProbeResult {
  url: string;
  statusCode: number;
  responseTimeMs: number;
  tlsExpiryDays: number | null;
  bodyMatchPassed: boolean | null;
  isHealthy: boolean;
  error?: string;
}

interface StoreOutput {
  storedCount: number;
  unhealthyEndpoints: ProbeResult[];
  probedAt: string;
}

interface AlertResult {
  alerted: boolean;
  status: number;
  unhealthyCount: number;
}

/** Post immediate Slack alert for any unhealthy endpoints */
export default async function run(ctx: Context, input: unknown): Promise<AlertResult> {
  const data = input as StoreOutput;

  if (data.unhealthyEndpoints.length === 0) {
    ctx.log.info("All endpoints healthy, no alert needed");
    return { alerted: false, status: 0, unhealthyCount: 0 };
  }

  const slack = ctx.dependency("slack-webhook");
  if (!slack.secret) {
    ctx.log.error("No slack.webhook_url in secrets -- cannot send alert");
    return { alerted: false, status: 0, unhealthyCount: data.unhealthyEndpoints.length };
  }

  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Uptime Alert", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:red_circle: ${data.unhealthyEndpoints.length} endpoint(s) unhealthy at ${data.probedAt}`,
      },
    },
  ];

  for (const endpoint of data.unhealthyEndpoints) {
    const details: string[] = [];
    if (endpoint.statusCode > 0) {
      details.push(`Status: ${endpoint.statusCode}`);
    }
    details.push(`Latency: ${endpoint.responseTimeMs}ms`);
    if (endpoint.error) {
      details.push(`Error: ${endpoint.error}`);
    }
    if (endpoint.bodyMatchPassed === false) {
      details.push("Body match: FAILED");
    }

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:warning: *${endpoint.url}*\n${details.join(" | ")}`,
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: "tentacular/uptime-tracker v1.0" },
    ],
  });

  const payload = {
    attachments: [{ color: "#e74c3c", blocks }],
  };

  ctx.log.info(`Sending alert for ${data.unhealthyEndpoints.length} unhealthy endpoint(s)`);

  const webhookUrl = slack.secret;
  const response = await globalThis.fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  ctx.log.info(`Slack alert response: ${response.status}`);
  return { alerted: response.ok, status: response.status, unhealthyCount: data.unhealthyEndpoints.length };
}
