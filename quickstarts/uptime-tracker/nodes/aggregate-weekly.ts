import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

interface EndpointStats {
  url: string;
  totalProbes: number;
  healthyProbes: number;
  uptimePct: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  errorCount: number;
  minTlsExpiryDays: number | null;
  avgResponseTimeMs: number;
}

interface AggregateResult {
  endpoints: EndpointStats[];
  periodStart: string;
  periodEnd: string;
  overallUptimePct: number;
}

const AGGREGATE_QUERY = `
SELECT
  url,
  COUNT(*) as total_probes,
  COUNT(*) FILTER (WHERE is_healthy = true) as healthy_probes,
  ROUND(100.0 * COUNT(*) FILTER (WHERE is_healthy = true) / COUNT(*), 2) as uptime_pct,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms) as p50_latency,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) as p95_latency,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms) as p99_latency,
  COUNT(*) FILTER (WHERE is_healthy = false) as error_count,
  MIN(tls_expiry_days) FILTER (WHERE tls_expiry_days IS NOT NULL AND tls_expiry_days >= 0) as min_tls_expiry,
  ROUND(AVG(response_time_ms), 2) as avg_response_time
FROM probe_results
WHERE probed_at >= $1 AND probed_at <= $2
GROUP BY url
ORDER BY uptime_pct ASC, avg_response_time DESC;
`;

/** Aggregate last 7 days of probe data into per-endpoint statistics */
export default async function run(ctx: Context, _input: unknown): Promise<AggregateResult> {
  const postgres = ctx.dependency("postgres");
  if (!postgres.secret) {
    ctx.log.error("No postgres.password in secrets -- cannot aggregate data");
    return {
      endpoints: [],
      periodStart: "",
      periodEnd: "",
      overallUptimePct: 0,
    };
  }

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

  ctx.log.info(`Aggregating data from ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);

  const client = new Client({
    hostname: postgres.host,
    port: postgres.port,
    database: postgres.database,
    user: postgres.user,
    password: postgres.secret,
    tls: { enabled: false },
  });

  const endpoints: EndpointStats[] = [];

  try {
    await client.connect();

    const result = await client.queryArray(
      AGGREGATE_QUERY,
      [periodStart.toISOString(), periodEnd.toISOString()],
    );

    for (const row of result.rows) {
      endpoints.push({
        url: String(row[0]),
        totalProbes: Number(row[1]),
        healthyProbes: Number(row[2]),
        uptimePct: Number(row[3]),
        p50LatencyMs: Math.round(Number(row[4])),
        p95LatencyMs: Math.round(Number(row[5])),
        p99LatencyMs: Math.round(Number(row[6])),
        errorCount: Number(row[7]),
        minTlsExpiryDays: row[8] !== null ? Number(row[8]) : null,
        avgResponseTimeMs: Number(row[9]),
      });
    }

    ctx.log.info(`Aggregated stats for ${endpoints.length} endpoint(s)`);
  } catch (err) {
    ctx.log.error(`Aggregation query failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await client.end();
  }

  const totalProbes = endpoints.reduce((sum, e) => sum + e.totalProbes, 0);
  const totalHealthy = endpoints.reduce((sum, e) => sum + e.healthyProbes, 0);
  const overallUptimePct = totalProbes > 0
    ? Math.round((totalHealthy / totalProbes) * 10000) / 100
    : 0;

  return {
    endpoints,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    overallUptimePct,
  };
}
