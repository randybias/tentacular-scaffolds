import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

interface HealthScore {
  accountId: string;
  score: number;
  explanation: string;
  redFlags: string[];
  greenFlags: string[];
}

interface ScoreResult {
  scores: HealthScore[];
}

interface StoreResult {
  scores: HealthScore[];
  stored: boolean;
  rowsInserted: number;
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS customer_health (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  score INT NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  signals_json JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_customer_health_account
  ON customer_health (account_id, scored_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_health_score
  ON customer_health (score, scored_at DESC);
`;

const INSERT_SCORE = `
INSERT INTO customer_health (account_id, scored_at, score, explanation, signals_json)
VALUES ($1, NOW(), $2, $3, $4);
`;

/** Store health scores in Postgres time-series table */
export default async function run(ctx: Context, input: unknown): Promise<StoreResult> {
  const data = input as ScoreResult;

  if (data.scores.length === 0) {
    ctx.log.info("No scores to store");
    return { scores: [], stored: false, rowsInserted: 0 };
  }

  const postgres = ctx.dependency("postgres");
  if (!postgres.secret) {
    ctx.log.warn("No postgres.password in secrets -- passing scores through without storage");
    return { scores: data.scores, stored: false, rowsInserted: 0 };
  }

  ctx.log.info(`Storing ${data.scores.length} health scores in Postgres`);

  const client = new Client({
    hostname: postgres.host,
    port: postgres.port,
    database: postgres.database,
    user: postgres.user,
    password: postgres.secret,
    tls: { enabled: false },
  });

  let rowsInserted = 0;

  try {
    await client.connect();
    await client.queryArray(CREATE_TABLE);

    for (const score of data.scores) {
      try {
        const signals = JSON.stringify({
          redFlags: score.redFlags,
          greenFlags: score.greenFlags,
        });

        await client.queryArray(INSERT_SCORE, [
          score.accountId,
          score.score,
          score.explanation,
          signals,
        ]);
        rowsInserted++;
      } catch (err) {
        ctx.log.warn(`Failed to store score for ${score.accountId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    ctx.log.info(`Stored ${rowsInserted}/${data.scores.length} scores`);
    return { scores: data.scores, stored: true, rowsInserted };
  } finally {
    await client.end();
  }
}
