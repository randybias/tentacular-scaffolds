import type { Context } from "tentacular";

interface ChangeAssessment {
  source: string;
  whatChanged: string;
  significance: number;
  businessImplication: string;
}

interface CompetitorAssessment {
  competitor: string;
  changes: ChangeAssessment[];
  overallSignificance: number;
}

interface StoreResult {
  storedCount: number;
  assessments: CompetitorAssessment[];
  fetchedAt: string;
}

interface NotifyResult {
  delivered: boolean;
  status: number;
}

/** Format and post a Slack digest sorted by significance */
export default async function run(ctx: Context, input: unknown): Promise<NotifyResult> {
  const data = input as StoreResult;

  const slack = ctx.dependency("slack-webhook");
  if (!slack.secret) {
    ctx.log.error("No slack.webhook_url in secrets -- cannot send notification");
    return { delivered: false, status: 0 };
  }

  if (data.assessments.length === 0) {
    ctx.log.info("No assessments to notify about");
    return { delivered: true, status: 200 };
  }

  // Sort assessments by overall significance (highest first)
  const sorted = [...data.assessments].sort(
    (a, b) => b.overallSignificance - a.overallSignificance,
  );

  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Competitor Intelligence Digest", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Detected changes across ${sorted.length} competitor(s) at ${data.fetchedAt}`,
      },
    },
  ];

  for (const assessment of sorted) {
    if (assessment.changes.length === 0) continue;

    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${assessment.competitor}* (significance: ${assessment.overallSignificance}/10)`,
      },
    });

    // Sort changes by significance descending
    const sortedChanges = [...assessment.changes].sort(
      (a, b) => b.significance - a.significance,
    );

    for (const change of sortedChanges) {
      const sigEmoji = change.significance >= 8 ? ":rotating_light:" :
        change.significance >= 5 ? ":warning:" : ":information_source:";

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            `${sigEmoji} *[${change.significance}/10]* ${change.whatChanged}`,
            `Source: <${change.source}>`,
            `Implication: ${change.businessImplication}`,
          ].join("\n"),
        },
      });
    }
  }

  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: "tentacular/competitor-intel-monitor v1.0" },
    ],
  });

  const payload = {
    attachments: [{ color: "#3498db", blocks }],
  };

  ctx.log.info(`Sending digest to Slack (${sorted.length} competitor(s))`);

  const webhookUrl = slack.secret;
  const response = await globalThis.fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  ctx.log.info(`Slack response: ${response.status}`);
  return { delivered: response.ok, status: response.status };
}
