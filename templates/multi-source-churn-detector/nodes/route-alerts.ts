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

interface RouteResult {
  urgent: number;
  atRisk: number;
  healthy: number;
  slackNotified: boolean;
}

const CREATE_DIGEST_TABLE = `
CREATE TABLE IF NOT EXISTS churn_weekly_digest (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  score INT NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  red_flags TEXT[] NOT NULL DEFAULT '{}',
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const INSERT_DIGEST = `
INSERT INTO churn_weekly_digest (account_id, score, explanation, red_flags)
VALUES ($1, $2, $3, $4);
`;

/** Route alerts based on health score: urgent Slack, at-risk digest, or log only */
export default async function run(ctx: Context, input: unknown): Promise<RouteResult> {
  const data = input as StoreResult;

  let urgent = 0;
  let atRisk = 0;
  let healthy = 0;
  let slackNotified = false;

  const urgentAccounts: HealthScore[] = [];
  const atRiskAccounts: HealthScore[] = [];

  for (const score of data.scores) {
    if (score.score < 40) {
      urgent++;
      urgentAccounts.push(score);
    } else if (score.score <= 60) {
      atRisk++;
      atRiskAccounts.push(score);
    } else {
      healthy++;
      ctx.log.info(`[healthy] ${score.accountId}: score ${score.score}`);
    }
  }

  // Store at-risk accounts in weekly digest table
  if (atRiskAccounts.length > 0) {
    const postgres = ctx.dependency("postgres");
    if (postgres.secret) {
      const client = new Client({
        hostname: postgres.host,
        port: postgres.port,
        database: postgres.database,
        user: postgres.user,
        password: postgres.secret,
        tls: { enabled: false },
      });

      try {
        await client.connect();
        await client.queryArray(CREATE_DIGEST_TABLE);

        for (const acct of atRiskAccounts) {
          await client.queryArray(INSERT_DIGEST, [
            acct.accountId,
            acct.score,
            acct.explanation,
            `{${acct.redFlags.map((f) => `"${f.replace(/"/g, '\\"')}"`).join(",")}}`,
          ]);
        }

        ctx.log.info(`Added ${atRiskAccounts.length} at-risk accounts to weekly digest`);
      } catch (err) {
        ctx.log.warn(`Failed to store digest entries: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        await client.end();
      }
    }
  }

  // Send urgent alerts to Slack
  if (urgentAccounts.length > 0) {
    const slack = ctx.dependency("slack-webhook");
    if (slack.secret) {
      const blocks: Record<string, unknown>[] = [
        {
          type: "header",
          text: { type: "plain_text", text: `Churn Risk Alert: ${urgentAccounts.length} Urgent Account(s)` },
        },
      ];

      for (const acct of urgentAccounts.slice(0, 10)) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: [
              `:rotating_light: *${acct.accountId}* - Score: *${acct.score}/100*`,
              acct.explanation,
              acct.redFlags.length > 0 ? `Red flags: ${acct.redFlags.join(", ")}` : "",
            ].filter(Boolean).join("\n"),
          },
        });
      }

      if (urgentAccounts.length > 10) {
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `_...and ${urgentAccounts.length - 10} more urgent accounts_` },
        });
      }

      blocks.push(
        { type: "divider" },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `Tentacular Churn Detector | ${new Date().toISOString()}` }],
        },
      );

      try {
        const webhookUrl = new URL(slack.secret);
        const res = await slack.fetch!(webhookUrl.pathname, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blocks }),
        });

        slackNotified = res.ok;
        ctx.log.info(`Slack urgent alert: ${res.status}`);
      } catch (err) {
        ctx.log.error(`Failed to send Slack alert: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  ctx.log.info(`Routing complete: ${urgent} urgent, ${atRisk} at-risk, ${healthy} healthy`);
  return { urgent, atRisk, healthy, slackNotified };
}
