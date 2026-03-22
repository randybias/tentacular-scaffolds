import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

interface ProbeResult {
  url: string;
  statusCode: number;
  responseTimeMs: number;
  tlsExpiryDays: number | null;
  bodyMatchPassed: boolean | null;
  isHealthy: boolean;
  error?: string;
}

interface ProbeOutput {
  results: ProbeResult[];
  probedAt: string;
}

interface StoreOutput {
  storedCount: number;
  unhealthyEndpoints: ProbeResult[];
  probedAt: string;
}

const CREATE_PROBE_TABLE = `
CREATE TABLE IF NOT EXISTS probe_results (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  probed_at TIMESTAMPTZ NOT NULL,
  status_code INT NOT NULL,
  response_time_ms INT NOT NULL,
  tls_expiry_days INT,
  body_match BOOLEAN,
  is_healthy BOOLEAN NOT NULL,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_probe_results_url_time
  ON probe_results (url, probed_at DESC);
CREATE INDEX IF NOT EXISTS idx_probe_results_probed_at
  ON probe_results (probed_at DESC);
`;

const INSERT_PROBE = `
INSERT INTO probe_results (
  url, probed_at, status_code, response_time_ms,
  tls_expiry_days, body_match, is_healthy, error
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id;
`;

/** Store all probe results in Postgres time-series table */
export default async function run(ctx: Context, input: unknown): Promise<StoreOutput> {
  const data = input as ProbeOutput;

  const postgres = ctx.dependency("postgres");
  if (!postgres.secret) {
    ctx.log.warn("No postgres.password in secrets -- skipping storage");
    const unhealthyEndpoints = data.results.filter((r) => !r.isHealthy);
    return { storedCount: 0, unhealthyEndpoints, probedAt: data.probedAt };
  }

  const client = new Client({
    hostname: postgres.host,
    port: postgres.port,
    database: postgres.database,
    user: postgres.user,
    password: postgres.secret,
    tls: { enabled: false },
  });

  let storedCount = 0;

  try {
    await client.connect();
    await client.queryArray(CREATE_PROBE_TABLE);

    for (const result of data.results) {
      await client.queryArray(INSERT_PROBE, [
        result.url,
        data.probedAt,
        result.statusCode,
        result.responseTimeMs,
        result.tlsExpiryDays,
        result.bodyMatchPassed,
        result.isHealthy,
        result.error ?? null,
      ]);
      storedCount++;
    }

    ctx.log.info(`Stored ${storedCount} probe result(s) in Postgres`);
  } catch (err) {
    ctx.log.error(`Postgres store failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await client.end();
  }

  const unhealthyEndpoints = data.results.filter((r) => !r.isHealthy);
  if (unhealthyEndpoints.length > 0) {
    ctx.log.warn(`${unhealthyEndpoints.length} unhealthy endpoint(s) detected`);
  }

  return { storedCount, unhealthyEndpoints, probedAt: data.probedAt };
}
