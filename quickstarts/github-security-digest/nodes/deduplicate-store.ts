import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

interface Alert {
  alertId: number;
  repo: string;
  severity: string;
  package: string;
  ecosystem: string;
  cvss: number;
  epss: number;
  summary: string;
  createdAt: string;
  htmlUrl: string;
}

interface FetchAlertsOutput {
  alerts: Alert[];
  fetchedAt: string;
  org: string;
}

interface DeduplicateResult {
  netNewAlerts: Alert[];
  totalStored: number;
  totalNew: number;
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS security_alerts (
  id SERIAL PRIMARY KEY,
  alert_id INT NOT NULL,
  repo TEXT NOT NULL,
  package TEXT NOT NULL,
  ecosystem TEXT NOT NULL,
  severity TEXT NOT NULL,
  cvss REAL NOT NULL DEFAULT 0,
  epss REAL NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  html_url TEXT NOT NULL DEFAULT '',
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'open',
  UNIQUE(alert_id, repo)
);

CREATE INDEX IF NOT EXISTS idx_security_alerts_repo
  ON security_alerts (repo);
CREATE INDEX IF NOT EXISTS idx_security_alerts_severity
  ON security_alerts (severity);
`;

const UPSERT_ALERT = `
INSERT INTO security_alerts (alert_id, repo, package, ecosystem, severity, cvss, epss, summary, html_url, first_seen, last_seen, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, 'open')
ON CONFLICT (alert_id, repo) DO UPDATE SET
  last_seen = EXCLUDED.last_seen,
  severity = EXCLUDED.severity,
  cvss = EXCLUDED.cvss,
  epss = EXCLUDED.epss,
  summary = EXCLUDED.summary
RETURNING (xmax = 0) AS is_new;
`;

/** Deduplicate alerts against Postgres and return only net-new alerts */
export default async function run(ctx: Context, input: unknown): Promise<DeduplicateResult> {
  const data = input as FetchAlertsOutput;

  const pg = ctx.dependency("tentacular-postgres");
  if (!pg.secret) {
    ctx.log.warn("No postgres credentials, returning all alerts as new");
    return { netNewAlerts: data.alerts, totalStored: 0, totalNew: data.alerts.length };
  }

  ctx.log.info(`Deduplicating ${data.alerts.length} alerts against Postgres`);

  const client = new Client({
    hostname: pg.host,
    port: pg.port,
    database: pg.database as string ?? "appdb",
    user: pg.metadata?.user as string ?? "postgres",
    password: pg.secret,
    tls: { enabled: false },
  });

  const netNewAlerts: Alert[] = [];

  try {
    await client.connect();
    await client.queryArray(CREATE_TABLE);

    for (const alert of data.alerts) {
      const result = await client.queryObject<{ is_new: boolean }>(UPSERT_ALERT, [
        alert.alertId,
        alert.repo,
        alert.package,
        alert.ecosystem,
        alert.severity,
        alert.cvss,
        alert.epss,
        alert.summary,
        alert.htmlUrl,
        data.fetchedAt,
      ]);

      const isNew = result.rows[0]?.is_new ?? false;
      if (isNew) {
        netNewAlerts.push(alert);
      }
    }

    ctx.log.info(`Stored ${data.alerts.length} alerts, ${netNewAlerts.length} are net-new`);
  } finally {
    await client.end();
  }

  return {
    netNewAlerts,
    totalStored: data.alerts.length,
    totalNew: netNewAlerts.length,
  };
}
