import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";
import type { CompileReportOutput } from "./compile-report.ts";

export interface AuditAndPublishOutput {
  audit_score: number | null;
  audit_passed: boolean;
  rustfs_html_path: string;
  rustfs_md_path: string;
  postgres_row_id: number;
  slack_delivered: boolean;
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS video_reports (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  section_count INTEGER NOT NULL DEFAULT 0,
  frames_analyzed INTEGER NOT NULL DEFAULT 0,
  audit_score FLOAT,
  rustfs_html_path TEXT NOT NULL DEFAULT '',
  rustfs_md_path TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_reports_created
  ON video_reports (created_at DESC);
`;

const INSERT = `
INSERT INTO video_reports (title, section_count, frames_analyzed, audit_score, rustfs_html_path, rustfs_md_path)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id;
`;

/**
 * Optional editorial audit, then publish to RustFS + Postgres + Slack.
 * All three services gracefully degrade if credentials are missing.
 */
export default async function run(
  ctx: Context,
  input: unknown,
): Promise<AuditAndPublishOutput> {
  const report = input as CompileReportOutput;
  const cfg = ctx.config as Record<string, unknown>;
  const auditCfg = (cfg["audit"] as Record<string, unknown>) ?? {};
  const auditEnabled = auditCfg["enabled"] !== false;
  const minScore = Number(auditCfg["min_quality_score"] ?? 7);

  const now = new Date().toISOString();
  const datePath = now.substring(0, 10);

  let auditScore: number | null = null;
  let auditPassed = true;
  let rustfsHtmlPath = "";
  let rustfsMdPath = "";
  let rowId = 0;
  let slackDelivered = false;

  // --- Editorial audit ---
  if (auditEnabled) {
    auditScore = await runAudit(ctx, report);
    auditPassed = auditScore === null || auditScore >= minScore;
    if (!auditPassed) {
      ctx.log.warn(
        `Audit score ${auditScore}/${minScore} below threshold — publishing anyway`,
      );
    }
  }

  // --- RustFS storage ---
  const rustfs = ctx.dependency("tentacular-rustfs");
  if (rustfs.secret && rustfs.fetch) {
    const basePath = `video-reports/${datePath}/${Date.now()}`;

    const htmlKey = `${basePath}/report.html`;
    const htmlRes = await rustfs.fetch!(`/${htmlKey}`, {
      method: "PUT",
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        Authorization: `Bearer ${rustfs.secret}`,
      },
      body: report.html,
    });
    if (htmlRes.ok) {
      rustfsHtmlPath = htmlKey;
      ctx.log.info(`Stored HTML report: ${htmlKey}`);
    } else {
      ctx.log.warn(`RustFS HTML upload failed: ${htmlRes.status}`);
    }

    const mdKey = `${basePath}/report.md`;
    const mdRes = await rustfs.fetch!(`/${mdKey}`, {
      method: "PUT",
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        Authorization: `Bearer ${rustfs.secret}`,
      },
      body: report.markdown,
    });
    if (mdRes.ok) {
      rustfsMdPath = mdKey;
      ctx.log.info(`Stored Markdown report: ${mdKey}`);
    } else {
      ctx.log.warn(`RustFS Markdown upload failed: ${mdRes.status}`);
    }
  } else {
    ctx.log.warn("No RustFS credentials or fetch — skipping storage");
  }

  // --- Postgres metadata ---
  const pg = ctx.dependency("tentacular-postgres");
  if (pg.secret && pg.host) {
    const client = new Client({
      hostname: pg.host,
      port: pg.port,
      database: pg.database,
      user: pg.user,
      password: pg.secret,
      tls: { enabled: false },
    });

    try {
      await client.connect();
      await client.queryArray(CREATE_TABLE);

      const result = await client.queryArray(INSERT, [
        report.title,
        report.sections.length,
        report.sections.reduce((n) => n, 0),
        auditScore,
        rustfsHtmlPath,
        rustfsMdPath,
      ]);

      rowId = Number(result.rows[0]?.[0] ?? 0);
      ctx.log.info(`Stored metadata as row ${rowId}`);
    } finally {
      await client.end();
    }
  } else {
    ctx.log.warn("No Postgres credentials — skipping metadata storage");
  }

  // --- Slack notification ---
  const slack = ctx.dependency("slack-webhook");
  if (slack.secret && slack.fetch && report.slack_blocks.length > 0) {
    const webhookUrl = new URL(slack.secret);
    const slackRes = await slack.fetch!(webhookUrl.pathname, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks: report.slack_blocks }),
    });

    slackDelivered = slackRes.ok;
    ctx.log.info(`Slack notification: ${slackRes.status}`);
  } else {
    ctx.log.warn("No Slack webhook or empty blocks — skipping notification");
  }

  return {
    audit_score: auditScore,
    audit_passed: auditPassed,
    rustfs_html_path: rustfsHtmlPath,
    rustfs_md_path: rustfsMdPath,
    postgres_row_id: rowId,
    slack_delivered: slackDelivered,
  };
}

async function runAudit(
  ctx: Context,
  report: CompileReportOutput,
): Promise<number | null> {
  const anthropic = ctx.dependency("anthropic");

  if (!anthropic.secret) {
    ctx.log.warn("No API key — skipping editorial audit");
    return null;
  }

  const prompt =
    `You are an editorial reviewer. Review this video analysis report ` +
    `for quality. Evaluate:\n` +
    `1. Narrative coherence and flow\n` +
    `2. Completeness (are there obvious gaps?)\n` +
    `3. Writing quality\n` +
    `4. Section organization\n\n` +
    `Report title: "${report.title}"\n` +
    `Sections: ${report.sections.length}\n\n` +
    `Markdown content:\n${report.markdown.slice(0, 8000)}\n\n` +
    `Return ONLY a JSON object: {"score": N, "feedback": "..."} ` +
    `where score is 1-10 and feedback is one paragraph.`;

  const res = await anthropic.fetch!("/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropic.secret,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    ctx.log.warn(`Audit API error ${res.status} — skipping`);
    return null;
  }

  const raw = (await res.json()) as Record<string, unknown>;
  const content = raw["content"] as Array<{ type: string; text?: string }> | undefined;
  const text = content?.find((b) => b.type === "text")?.text?.trim() ?? "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as { score: number; feedback: string };
    ctx.log.info(`Audit score: ${parsed.score}/10 — ${parsed.feedback.slice(0, 100)}`);
    return parsed.score;
  } catch {
    ctx.log.warn("Failed to parse audit response");
    return null;
  }
}
