import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";
import type { DependabotOutput, DependabotAlert } from "./fetch-dependabot.ts";
import type { CodeScanOutput, CodeScanAlert } from "./fetch-codescan.ts";

export interface UnifiedAlert {
  source: "dependabot" | "codescan";
  repo: string;
  alertId: number;
  severity: string;
  identifier: string; // package name or rule id
  summary: string;
  cvss: number;
  htmlUrl: string;
  createdAt: string;
}

export interface DeduplicateOutput {
  newAlerts: UnifiedAlert[];
  totalFetched: number;
  totalNew: number;
  org: string;
}

/** Fan-in input: one key per parent node name */
interface DeduplicateInput {
  "fetch-dependabot": DependabotOutput;
  "fetch-codescan": CodeScanOutput;
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS vuln_alert_tracking (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  repo TEXT NOT NULL,
  alert_id INT NOT NULL,
  severity TEXT NOT NULL,
  identifier TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  cvss REAL NOT NULL DEFAULT 0,
  html_url TEXT NOT NULL DEFAULT '',
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  triage_status TEXT NOT NULL DEFAULT 'new',
  UNIQUE(source, repo, alert_id)
);

CREATE INDEX IF NOT EXISTS idx_vuln_alert_source ON vuln_alert_tracking (source);
CREATE INDEX IF NOT EXISTS idx_vuln_alert_repo ON vuln_alert_tracking (repo);
CREATE INDEX IF NOT EXISTS idx_vuln_alert_status ON vuln_alert_tracking (triage_status);
`;

const UPSERT_ALERT = `
INSERT INTO vuln_alert_tracking (source, repo, alert_id, severity, identifier, summary, cvss, html_url, first_seen, last_seen)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
ON CONFLICT (source, repo, alert_id) DO UPDATE SET
  last_seen = EXCLUDED.last_seen,
  severity = EXCLUDED.severity,
  cvss = EXCLUDED.cvss,
  summary = EXCLUDED.summary
RETURNING (xmax = 0) AS is_new;
`;

/** Deduplicate alerts against Postgres, return only net-new alerts */
export default async function run(ctx: Context, input: unknown): Promise<DeduplicateOutput> {
  const data = input as DeduplicateInput;
  const dependabot = data["fetch-dependabot"];
  const codescan = data["fetch-codescan"];

  // Unify all alerts
  const allAlerts: UnifiedAlert[] = [];

  for (const a of dependabot.alerts) {
    allAlerts.push({
      source: "dependabot",
      repo: a.repo,
      alertId: a.alertId,
      severity: a.severity,
      identifier: a.package,
      summary: a.summary,
      cvss: a.cvss,
      htmlUrl: a.htmlUrl,
      createdAt: a.createdAt,
    });
  }

  for (const a of codescan.alerts) {
    allAlerts.push({
      source: "codescan",
      repo: a.repo,
      alertId: a.alertId,
      severity: a.severity,
      identifier: a.rule,
      summary: a.summary,
      cvss: 0,
      htmlUrl: a.htmlUrl,
      createdAt: a.createdAt,
    });
  }

  ctx.log.info(`Deduplicating ${allAlerts.length} total alerts (dependabot=${dependabot.alerts.length}, codescan=${codescan.alerts.length})`);

  const pg = ctx.dependency("postgres");
  if (!pg.secret) {
    ctx.log.warn("No postgres credentials, returning all alerts as new");
    return { newAlerts: allAlerts, totalFetched: allAlerts.length, totalNew: allAlerts.length, org: dependabot.org };
  }

  const client = new Client({
    hostname: pg.host,
    port: pg.port,
    database: pg.database,
    user: pg.user,
    password: pg.secret,
    tls: { enabled: false },
  });

  const newAlerts: UnifiedAlert[] = [];
  const now = new Date().toISOString();

  try {
    await client.connect();
    await client.queryArray(CREATE_TABLE);

    for (const alert of allAlerts) {
      const result = await client.queryObject<{ is_new: boolean }>(UPSERT_ALERT, [
        alert.source,
        alert.repo,
        alert.alertId,
        alert.severity,
        alert.identifier,
        alert.summary,
        alert.cvss,
        alert.htmlUrl,
        now,
      ]);

      if (result.rows[0]?.is_new) {
        newAlerts.push(alert);
      }
    }

    ctx.log.info(`Stored ${allAlerts.length} alerts, ${newAlerts.length} are net-new`);
  } finally {
    await client.end();
  }

  return { newAlerts, totalFetched: allAlerts.length, totalNew: newAlerts.length, org: dependabot.org };
}
