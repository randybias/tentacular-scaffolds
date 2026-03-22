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

interface NotifyResult {
  delivered: boolean;
  status: number;
}

/** Post incident brief to #incidents Slack channel */
export default async function run(ctx: Context, input: unknown): Promise<NotifyResult> {
  const brief = input as IncidentBrief;

  const slack = ctx.dependency("slack-webhook");
  if (!slack.secret) {
    ctx.log.warn("No slack webhook, skipping notification");
    return { delivered: false, status: 0 };
  }

  const severityEmoji: Record<string, string> = {
    P1: ":rotating_light:",
    P2: ":warning:",
    P3: ":large_yellow_circle:",
    P4: ":information_source:",
  };

  const emoji = severityEmoji[brief.severity] ?? ":grey_question:";

  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${brief.severity} Incident: ${brief.service}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *${brief.severity}* | *${brief.service}* | \`${brief.metric}\`\n\n${brief.brief}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Suggested Actions:*\n${brief.suggestedActions.map((a) => `- ${a}`).join("\n")}`,
      },
    },
  ];

  if (brief.relatedDeploy) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Possibly Related Deploy:* \`${brief.relatedDeploy}\``,
      },
    });
  }

  blocks.push(
    { type: "divider" },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Tentacular Incident Response Orchestrator | ${brief.timestamp}`,
        },
      ],
    },
  );

  ctx.log.info(`Sending ${brief.severity} incident notification to Slack`);

  const webhookUrl = new URL(slack.secret);
  const res = await slack.fetch!(webhookUrl.pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });

  ctx.log.info(`Slack response: ${res.status}`);
  return { delivered: res.ok, status: res.status };
}
