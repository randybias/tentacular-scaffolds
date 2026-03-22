import type { Context } from "tentacular";

interface TestCase {
  name: string;
  passed: boolean;
  latency_ms: number;
  error?: string;
}

interface CollectedResults {
  services: Array<{
    service: string;
    passed: boolean;
    tests: TestCase[];
  }>;
  totalTests: number;
  totalPassed: number;
  overallPassed: boolean;
  collectedAt?: string;
}

interface RenderResult {
  s3Path: string;
  stored: boolean;
  results?: CollectedResults;
}

interface NotifyResult {
  delivered: boolean;
  status: number;
}

/** Post smoke test summary to Slack */
export default async function run(ctx: Context, input: unknown): Promise<NotifyResult> {
  const data = input as RenderResult;
  const results = data.results;

  const slack = ctx.dependency("slack-webhook");
  if (!slack.secret) {
    ctx.log.warn("No slack webhook, skipping notification");
    return { delivered: false, status: 0 };
  }

  // Build per-service latency summary
  const serviceSummaries = results.services.map((svc) => {
    const avgLatency = svc.tests.length > 0
      ? Math.round(svc.tests.reduce((sum, t) => sum + t.latency_ms, 0) / svc.tests.length)
      : 0;
    const icon = svc.passed ? ":white_check_mark:" : ":x:";
    const name = svc.service.toUpperCase();
    return `${icon} ${name}: ${avgLatency}ms`;
  }).join(", ");

  const overallIcon = results.overallPassed ? ":white_check_mark:" : ":rotating_light:";
  const statusText = results.overallPassed ? "ALL PASSED" : "FAILURES DETECTED";

  const blocks: Record<string, unknown>[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${overallIcon} *Exoskeleton smoke test: ${results.totalPassed}/${results.totalTests} ${statusText}*`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: serviceSummaries,
      },
    },
  ];

  // Add failure details if any
  if (!results.overallPassed) {
    const failures: string[] = [];
    for (const svc of results.services) {
      for (const test of svc.tests) {
        if (!test.passed) {
          failures.push(`- \`${svc.service}.${test.name}\`: ${test.error ?? "failed"}`);
        }
      }
    }
    if (failures.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Failures:*\n${failures.slice(0, 10).join("\n")}`,
        },
      });
    }
  }

  blocks.push(
    { type: "divider" },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `Tentacular E2E Exoskeleton Test | ${results.collectedAt}` },
      ],
    },
  );

  ctx.log.info("Sending smoke test results to Slack");

  const webhookUrl = new URL(slack.secret);
  const res = await slack.fetch!(webhookUrl.pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });

  ctx.log.info(`Slack response: ${res.status}`);
  return { delivered: res.ok, status: res.status };
}
