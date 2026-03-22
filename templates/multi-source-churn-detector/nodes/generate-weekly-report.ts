import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

interface HealthScore {
  accountId: string;
  score: number;
  explanation: string;
  redFlags: string[];
  greenFlags: string[];
}

interface StoreResult {
  scores: HealthScore[];
  stored: boolean;
  rowsInserted: number;
}

interface ReportResult {
  generated: boolean;
  s3Path: string;
  summary: string;
  slackNotified: boolean;
}

const QUERY_WEEKLY_SCORES = `
SELECT account_id, score, explanation, signals_json, scored_at
FROM customer_health
WHERE scored_at > NOW() - INTERVAL '7 days'
ORDER BY score ASC;
`;

const QUERY_TRENDS = `
SELECT account_id,
  AVG(score) as avg_score,
  MIN(score) as min_score,
  MAX(score) as max_score,
  COUNT(*) as data_points
FROM customer_health
WHERE scored_at > NOW() - INTERVAL '30 days'
GROUP BY account_id
ORDER BY AVG(score) ASC;
`;

/** Generate weekly health report with trend analysis, store HTML in RustFS, post summary to Slack */
export default async function run(ctx: Context, input: unknown): Promise<ReportResult> {
  const data = input as StoreResult;

  // Access dependencies early for contract drift detection
  const postgres = ctx.dependency("postgres");
  const _rustfs = ctx.dependency("rustfs");

  if (!postgres.secret) {
    ctx.log.warn("No postgres.password -- cannot generate weekly report");
    return { generated: false, s3Path: "", summary: "", slackNotified: false };
  }

  const client = new Client({
    hostname: postgres.host,
    port: postgres.port,
    database: postgres.database,
    user: postgres.user,
    password: postgres.secret,
    tls: { enabled: false },
  });

  let weeklyScores: Array<Record<string, unknown>> = [];
  let trends: Array<Record<string, unknown>> = [];

  try {
    await client.connect();

    const weeklyResult = await client.queryArray(QUERY_WEEKLY_SCORES);
    weeklyScores = weeklyResult.rows.map((row) => ({
      accountId: String(row[0]),
      score: Number(row[1]),
      explanation: String(row[2]),
      signals: row[3],
      scoredAt: String(row[4]),
    }));

    const trendResult = await client.queryArray(QUERY_TRENDS);
    trends = trendResult.rows.map((row) => ({
      accountId: String(row[0]),
      avgScore: Number(row[1]),
      minScore: Number(row[2]),
      maxScore: Number(row[3]),
      dataPoints: Number(row[4]),
    }));
  } finally {
    await client.end();
  }

  // Generate narrative summary with LLM
  let narrative = "";
  const anthropic = ctx.dependency("anthropic");
  if (anthropic.secret) {
    try {
      const res = await anthropic.fetch!("/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          system: "You are a customer success analyst. Write a concise weekly health report narrative based on the data provided. Highlight top risks, improvements, and recommended actions.",
          messages: [{
            role: "user",
            content: `Weekly scores (${weeklyScores.length} entries):\n${JSON.stringify(weeklyScores.slice(0, 50), null, 2)}\n\n30-day trends (${trends.length} accounts):\n${JSON.stringify(trends.slice(0, 50), null, 2)}`,
          }],
        }),
      });

      if (res.ok) {
        const responseData = await res.json();
        narrative = responseData.content?.[0]?.text ?? "";
      }
    } catch (err) {
      ctx.log.warn(`LLM narrative failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!narrative) {
    const atRisk = weeklyScores.filter((s) => (s.score as number) < 40).length;
    narrative = `Weekly Health Report: ${weeklyScores.length} scores recorded, ${atRisk} accounts at critical risk. ${trends.length} accounts tracked over 30 days.`;
  }

  // Generate HTML report
  const dateStr = new Date().toISOString().split("T")[0];
  const html = generateHtml(dateStr, weeklyScores, trends, narrative);

  // Store in RustFS
  let s3Path = "";
  const rustfs = ctx.dependency("rustfs");
  if (rustfs.secret) {
    s3Path = `/tentacular/reports/churn/${dateStr}/weekly-report.html`;
    try {
      const res = await rustfs.fetch!(s3Path, {
        method: "PUT",
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: html,
      });
      if (res.ok) {
        ctx.log.info(`Stored weekly report at ${s3Path}`);
      } else {
        ctx.log.warn(`RustFS PUT failed: ${res.status}`);
        s3Path = "";
      }
    } catch (err) {
      ctx.log.warn(`Failed to store report: ${err instanceof Error ? err.message : String(err)}`);
      s3Path = "";
    }
  }

  // Post summary to Slack
  let slackNotified = false;
  const slack = ctx.dependency("slack-webhook");
  if (slack.secret) {
    const atRisk = data.scores.filter((s) => s.score < 40).length;
    const moderate = data.scores.filter((s) => s.score >= 40 && s.score <= 60).length;
    const healthy = data.scores.filter((s) => s.score > 60).length;

    const blocks: Record<string, unknown>[] = [
      {
        type: "header",
        text: { type: "plain_text", text: `Weekly Customer Health Report - ${dateStr}` },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:bar_chart: *${data.scores.length} accounts scored*\n:red_circle: ${atRisk} critical | :large_yellow_circle: ${moderate} at-risk | :white_check_mark: ${healthy} healthy`,
        },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: narrative.substring(0, 500) },
      },
      { type: "divider" },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `Tentacular Churn Detector | ${new Date().toISOString()}` }],
      },
    ];

    try {
      const webhookUrl = new URL(slack.secret);
      const res = await slack.fetch!(webhookUrl.pathname, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks }),
      });
      slackNotified = res.ok;
    } catch (err) {
      ctx.log.warn(`Slack notification failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  ctx.log.info("Weekly report generation complete");
  return { generated: true, s3Path, summary: narrative.substring(0, 200), slackNotified };
}

/** Generate HTML report */
function generateHtml(
  date: string,
  scores: Array<Record<string, unknown>>,
  trends: Array<Record<string, unknown>>,
  narrative: string,
): string {
  const scoreRows = scores.slice(0, 100).map((s) => {
    const score = s.score as number;
    const color = score < 40 ? "#dc3545" : score <= 60 ? "#ffc107" : "#28a745";
    return `<tr><td>${s.accountId}</td><td style="color:${color};font-weight:bold">${score}</td><td>${s.explanation}</td><td>${s.scoredAt}</td></tr>`;
  }).join("\n");

  const trendRows = trends.slice(0, 100).map((t) =>
    `<tr><td>${t.accountId}</td><td>${(t.avgScore as number).toFixed(1)}</td><td>${t.minScore}</td><td>${t.maxScore}</td><td>${t.dataPoints}</td></tr>`
  ).join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <title>Customer Health Report - ${date}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 8px 12px; border: 1px solid #dee2e6; text-align: left; }
    th { background: #f8f9fa; }
    .narrative { background: #f8f9fa; padding: 16px; border-radius: 8px; margin: 20px 0; }
  </style>
</head>
<body>
  <h1>Customer Health Report</h1>
  <p>Generated: ${date}</p>
  <div class="narrative"><h2>Summary</h2><p>${narrative}</p></div>
  <h2>Current Scores (${scores.length})</h2>
  <table><thead><tr><th>Account</th><th>Score</th><th>Explanation</th><th>Scored At</th></tr></thead><tbody>${scoreRows}</tbody></table>
  <h2>30-Day Trends (${trends.length})</h2>
  <table><thead><tr><th>Account</th><th>Avg</th><th>Min</th><th>Max</th><th>Data Points</th></tr></thead><tbody>${trendRows}</tbody></table>
  <footer><p>Generated by Tentacular Churn Detector</p></footer>
</body>
</html>`;
}
