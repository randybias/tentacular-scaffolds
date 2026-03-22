import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

interface NormalizedAlert {
  service: string;
  metric: string;
  value: string;
  threshold: string;
  timestamp: string;
  source: string;
}

interface AlertHistory {
  recentAlerts: number;
  lastAlert: string;
  recurringPattern: boolean;
  averageResolutionTime: number;
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS incident_alerts (
  id SERIAL PRIMARY KEY,
  service TEXT NOT NULL,
  metric TEXT NOT NULL,
  value TEXT,
  threshold TEXT,
  severity TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_incident_alerts_service
  ON incident_alerts (service, created_at DESC);
`;

const QUERY_RECENT = `
SELECT COUNT(*), MAX(created_at), AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)))
FROM incident_alerts
WHERE service = $1
  AND created_at > NOW() - INTERVAL '30 days';
`;

const COUNT_RECURRING = `
SELECT COUNT(*)
FROM incident_alerts
WHERE service = $1
  AND metric = $2
  AND created_at > NOW() - INTERVAL '30 days';
`;

/** Query Postgres for recent alert history for this service (last 30 days) */
export default async function run(ctx: Context, input: unknown): Promise<AlertHistory> {
  const alert = input as NormalizedAlert;

  const postgres = ctx.dependency("postgres");
  if (!postgres.secret) {
    ctx.log.warn("No postgres.password in secrets -- returning empty history");
    return { recentAlerts: 0, lastAlert: "", recurringPattern: false, averageResolutionTime: 0 };
  }

  ctx.log.info(`Querying alert history for service: ${alert.service}`);

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
    await client.queryArray(CREATE_TABLE);

    const recentResult = await client.queryArray(QUERY_RECENT, [alert.service]);
    const row = recentResult.rows[0] ?? [0, null, null];
    const recentAlerts = Number(row[0]) || 0;
    const lastAlert = row[1] ? String(row[1]) : "";
    const avgResolution = Number(row[2]) || 0;

    const recurringResult = await client.queryArray(COUNT_RECURRING, [alert.service, alert.metric]);
    const metricCount = Number(recurringResult.rows[0]?.[0]) || 0;
    const recurringPattern = metricCount >= 3;

    ctx.log.info(
      `History for ${alert.service}: ${recentAlerts} alerts in 30d, last: ${lastAlert || "none"}, recurring: ${recurringPattern}`,
    );

    return {
      recentAlerts,
      lastAlert,
      recurringPattern,
      averageResolutionTime: Math.round(avgResolution),
    };
  } finally {
    await client.end();
  }
}
