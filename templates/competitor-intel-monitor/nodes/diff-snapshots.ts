import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";
import { S3Client } from "https://deno.land/x/s3_lite_client@0.7.0/mod.ts";

interface SourceContent {
  type: string;
  url: string;
  content: string;
  fetchedAt: string;
  statusCode: number;
}

interface CompetitorSources {
  competitor: string;
  sources: SourceContent[];
}

interface FetchResult {
  competitorSources: CompetitorSources[];
  fetchedAt: string;
}

interface ChangedSource {
  type: string;
  url: string;
  previousContent: string;
  currentContent: string;
  changeSizeBytes: number;
}

interface CompetitorChanges {
  competitor: string;
  changedSources: ChangedSource[];
}

interface DiffResult {
  competitorChanges: CompetitorChanges[];
  totalChanges: number;
  fetchedAt: string;
}

const CREATE_SNAPSHOT_META_TABLE = `
CREATE TABLE IF NOT EXISTS competitor_snapshots (
  id SERIAL PRIMARY KEY,
  competitor TEXT NOT NULL,
  source_url TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL,
  change_size_bytes INT NOT NULL,
  s3_path TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_url
  ON competitor_snapshots (source_url, changed_at DESC);
`;

/** Diff current page content against previous snapshots stored in RustFS */
export default async function run(ctx: Context, input: unknown): Promise<DiffResult> {
  const data = input as FetchResult;

  const rustfs = ctx.dependency("rustfs");
  const postgres = ctx.dependency("postgres");
  const competitorChanges: CompetitorChanges[] = [];

  // Initialize S3 client if credentials available
  let s3: S3Client | null = null;
  if (rustfs.secret) {
    s3 = new S3Client({
      endPoint: rustfs.host,
      port: rustfs.port,
      useSSL: true,
      accessKey: rustfs.secret,
      secretKey: (rustfs as Record<string, unknown>).secretKey as string ?? "",
      bucket: (rustfs as Record<string, unknown>).bucket as string ?? "tentacular",
      pathStyle: true,
    });
  }

  // Initialize Postgres client for metadata
  let pgClient: Client | null = null;
  if (postgres.secret) {
    pgClient = new Client({
      hostname: postgres.host,
      port: postgres.port,
      database: postgres.database,
      user: postgres.user,
      password: postgres.secret,
      tls: { enabled: false },
    });
    await pgClient.connect();
    await pgClient.queryArray(CREATE_SNAPSHOT_META_TABLE);
  }

  try {
    for (const cs of data.competitorSources) {
      const changedSources: ChangedSource[] = [];

      for (const source of cs.sources) {
        if (source.statusCode === 0 || !source.content) continue;

        // Generate a stable key for this source
        const urlHash = await hashString(source.url);
        const snapshotKey = `competitor-snapshots/${urlHash}/latest.txt`;

        // Load previous snapshot from S3
        let previousContent = "";
        if (s3) {
          try {
            const obj = await s3.getObject(snapshotKey);
            previousContent = await new Response(obj).text();
          } catch {
            // No previous snapshot exists
            ctx.log.info(`No previous snapshot for ${source.url}`);
          }
        }

        // Compare content
        const hasChanged = previousContent !== source.content;

        if (hasChanged) {
          const changeSizeBytes = Math.abs(source.content.length - previousContent.length);

          changedSources.push({
            type: source.type,
            url: source.url,
            previousContent,
            currentContent: source.content,
            changeSizeBytes,
          });

          // Store new snapshot
          if (s3) {
            try {
              const encoder = new TextEncoder();
              await s3.putObject(snapshotKey, encoder.encode(source.content));
              ctx.log.info(`Updated snapshot for ${source.url}`);
            } catch (err) {
              ctx.log.warn(`Failed to store snapshot: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          // Record metadata in Postgres
          if (pgClient) {
            try {
              await pgClient.queryArray(
                `INSERT INTO competitor_snapshots (competitor, source_url, changed_at, change_size_bytes, s3_path)
                 VALUES ($1, $2, $3, $4, $5)`,
                [cs.competitor, source.url, new Date().toISOString(), changeSizeBytes, snapshotKey],
              );
            } catch (err) {
              ctx.log.warn(`Failed to record snapshot metadata: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          ctx.log.info(`Change detected for ${cs.competitor} at ${source.url} (${changeSizeBytes} bytes delta)`);
        }
      }

      if (changedSources.length > 0) {
        competitorChanges.push({
          competitor: cs.competitor,
          changedSources,
        });
      }
    }
  } finally {
    if (pgClient) {
      await pgClient.end();
    }
  }

  const totalChanges = competitorChanges.reduce((sum, cc) => sum + cc.changedSources.length, 0);
  ctx.log.info(`Detected ${totalChanges} change(s) across ${competitorChanges.length} competitor(s)`);

  return { competitorChanges, totalChanges, fetchedAt: data.fetchedAt };
}

async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
