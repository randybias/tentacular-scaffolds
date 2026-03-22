import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

interface ChangeAssessment {
  source: string;
  whatChanged: string;
  significance: number;
  businessImplication: string;
}

interface CompetitorAssessment {
  competitor: string;
  changes: ChangeAssessment[];
  overallSignificance: number;
}

interface AnalyzeResult {
  assessments: CompetitorAssessment[];
  fetchedAt: string;
}

interface StoreResult {
  storedCount: number;
  assessments: CompetitorAssessment[];
  fetchedAt: string;
}

const CREATE_ASSESSMENTS_TABLE = `
CREATE TABLE IF NOT EXISTS competitor_assessments (
  id SERIAL PRIMARY KEY,
  competitor TEXT NOT NULL,
  assessed_at TIMESTAMPTZ NOT NULL,
  significance INT NOT NULL,
  source_url TEXT NOT NULL,
  what_changed TEXT NOT NULL,
  business_implication TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assessments_competitor_date
  ON competitor_assessments (competitor, assessed_at DESC);
`;

const INSERT_ASSESSMENT = `
INSERT INTO competitor_assessments (
  competitor, assessed_at, significance, source_url, what_changed, business_implication
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id;
`;

/** Store competitor assessments in Postgres */
export default async function run(ctx: Context, input: unknown): Promise<StoreResult> {
  const data = input as AnalyzeResult;

  if (data.assessments.length === 0) {
    ctx.log.info("No assessments to store");
    return { storedCount: 0, assessments: [], fetchedAt: data.fetchedAt };
  }

  const postgres = ctx.dependency("postgres");
  if (!postgres.secret) {
    ctx.log.warn("No postgres.password in secrets -- skipping DB storage");
    return { storedCount: 0, assessments: data.assessments, fetchedAt: data.fetchedAt };
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
    await client.queryArray(CREATE_ASSESSMENTS_TABLE);

    const now = new Date().toISOString();

    for (const assessment of data.assessments) {
      for (const change of assessment.changes) {
        await client.queryArray(INSERT_ASSESSMENT, [
          assessment.competitor,
          now,
          change.significance,
          change.source,
          change.whatChanged,
          change.businessImplication,
        ]);
        storedCount++;
      }
    }

    ctx.log.info(`Stored ${storedCount} assessment record(s) in Postgres`);
  } catch (err) {
    ctx.log.error(`Postgres store failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await client.end();
  }

  return { storedCount, assessments: data.assessments, fetchedAt: data.fetchedAt };
}
