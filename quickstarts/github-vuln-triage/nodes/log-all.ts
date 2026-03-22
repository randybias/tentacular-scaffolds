import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";
import type { TriageOutput } from "./triage.ts";

interface LogResult {
  logged: number;
  rustfsPath: string;
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS vuln_triage_log (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  repo TEXT NOT NULL,
  alert_id INT NOT NULL,
  severity TEXT NOT NULL,
  identifier TEXT NOT NULL,
  priority TEXT NOT NULL,
  triage_reason TEXT NOT NULL DEFAULT '',
  remediation TEXT NOT NULL DEFAULT '',
  cvss REAL NOT NULL DEFAULT 0,
  html_url TEXT NOT NULL DEFAULT '',
  team TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT '',
  triaged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vuln_triage_log_priority ON vuln_triage_log (priority);
CREATE INDEX IF NOT EXISTS idx_vuln_triage_log_repo ON vuln_triage_log (repo);
CREATE INDEX IF NOT EXISTS idx_vuln_triage_log_triaged ON vuln_triage_log (triaged_at DESC);
`;

const INSERT_LOG = `
INSERT INTO vuln_triage_log (source, repo, alert_id, severity, identifier, priority, triage_reason, remediation, cvss, html_url, team, environment)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
`;

/** Store all triage results in Postgres and archive to RustFS */
export default async function run(ctx: Context, input: unknown): Promise<LogResult> {
  const triage = input as TriageOutput;

  const allAlerts = [
    ...triage.criticalAction,
    ...triage.highTrack,
    ...triage.lowLog,
  ];

  if (allAlerts.length === 0) {
    ctx.log.info("No alerts to log");
    return { logged: 0, rustfsPath: "" };
  }

  let logged = 0;
  let rustfsPath = "";

  // Log to Postgres
  const pg = ctx.dependency("tentacular-postgres");
  if (pg.secret) {
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

      for (const alert of allAlerts) {
        await client.queryArray(INSERT_LOG, [
          alert.source,
          alert.repo,
          alert.alertId,
          alert.severity,
          alert.identifier,
          alert.priority,
          alert.triageReason,
          alert.suggestedRemediation,
          alert.cvss,
          alert.htmlUrl,
          alert.repoContext.team,
          alert.repoContext.environment,
        ]);
        logged++;
      }

      ctx.log.info(`Logged ${logged} triage results to Postgres`);
    } finally {
      await client.end();
    }
  } else {
    ctx.log.warn("No postgres credentials, skipping database logging");
  }

  // Archive full triage report to RustFS
  const rustfs = ctx.dependency("tentacular-rustfs");
  if (rustfs.secret) {
    const now = new Date().toISOString();
    const datePath = now.substring(0, 10);
    const key = `vuln-triage/${datePath}/${Date.now()}-triage-report.json`;

    const report = JSON.stringify({
      org: triage.org,
      triagedAt: now,
      summary: {
        total: triage.totalTriaged,
        critical: triage.criticalAction.length,
        high: triage.highTrack.length,
        low: triage.lowLog.length,
      },
      criticalAction: triage.criticalAction,
      highTrack: triage.highTrack,
      lowLog: triage.lowLog,
    }, null, 2);

    const putRes = await rustfs.fetch!(`/vuln-triage/${key}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${rustfs.secret}`,
      },
      body: report,
    });

    if (putRes.ok) {
      rustfsPath = key;
      ctx.log.info(`Archived triage report to RustFS: ${key}`);
    } else {
      ctx.log.warn(`RustFS upload failed: ${putRes.status}`);
    }
  }

  return { logged, rustfsPath };
}
