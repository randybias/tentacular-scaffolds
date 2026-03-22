import type { Context } from "tentacular";
import { S3Client } from "https://deno.land/x/s3_lite_client@0.7.0/mod.ts";

interface ReportOutput {
  html: string;
  summary: string;
  overallUptimePct: number;
  periodStart: string;
  periodEnd: string;
}

interface PublishResult {
  uploaded: boolean;
  reportPath: string;
  slackNotified: boolean;
}

/** Store HTML report in RustFS and post summary to Slack */
export default async function run(ctx: Context, input: unknown): Promise<PublishResult> {
  const data = input as ReportOutput;

  // --- Upload report to RustFS ---
  let uploaded = false;
  let reportPath = "";

  const rustfs = ctx.dependency("tentacular-rustfs");
  if (rustfs.secret) {
    const s3 = new S3Client({
      endPoint: rustfs.host,
      port: rustfs.port,
      useSSL: true,
      accessKey: rustfs.secret,
      secretKey: (rustfs as Record<string, unknown>).secretKey as string ?? "",
      bucket: (rustfs as Record<string, unknown>).bucket as string ?? "tentacular",
      pathStyle: true,
    });

    const dateStr = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").replace(/\.\d+Z$/, "");
    reportPath = `uptime-reports/weekly-${dateStr}.html`;

    try {
      const encoder = new TextEncoder();
      await s3.putObject(reportPath, encoder.encode(data.html), {
        metadata: { "Content-Type": "text/html; charset=utf-8" },
      });
      uploaded = true;
      ctx.log.info(`Uploaded report to ${reportPath}`);
    } catch (err) {
      ctx.log.warn(`Failed to upload report: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    ctx.log.warn("No RustFS credentials -- skipping upload");
  }

  // --- Post summary to Slack ---
  let slackNotified = false;
  const slack = ctx.dependency("slack-webhook");

  if (slack.secret) {
    const uptimeColor = data.overallUptimePct >= 99.9 ? "#2ecc71" :
      data.overallUptimePct >= 99 ? "#f39c12" : "#e74c3c";

    const blocks: Record<string, unknown>[] = [
      {
        type: "header",
        text: { type: "plain_text", text: "Weekly Uptime Report", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            `*Overall Uptime: ${data.overallUptimePct}%*`,
            `Period: ${data.periodStart.split("T")[0]} to ${data.periodEnd.split("T")[0]}`,
            "",
            data.summary,
          ].join("\n"),
        },
      },
    ];

    if (uploaded) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Full report stored at: \`${reportPath}\``,
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
      attachments: [{ color: uptimeColor, blocks }],
    };

    try {
      const webhookUrl = slack.secret;
      const response = await globalThis.fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      slackNotified = response.ok;
      ctx.log.info(`Slack notification: ${response.status}`);
    } catch (err) {
      ctx.log.warn(`Slack notify error: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    ctx.log.warn("No slack.webhook_url -- skipping notification");
  }

  return { uploaded, reportPath, slackNotified };
}
