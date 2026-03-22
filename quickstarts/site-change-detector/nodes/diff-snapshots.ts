import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

interface PageContent {
  url: string;
  content: string;
  fetchedAt: string;
  statusCode: number;
}

interface FetchPagesOutput {
  pages: PageContent[];
}

interface ChangedPage {
  url: string;
  previousContent: string;
  currentContent: string;
  diff: string;
  changedAt: string;
}

interface DiffResult {
  changedPages: ChangedPage[];
  unchangedCount: number;
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS site_change_log (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL,
  diff_summary TEXT NOT NULL DEFAULT '',
  content_length INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_site_change_log_url
  ON site_change_log (url, changed_at DESC);
`;

const INSERT_CHANGE = `
INSERT INTO site_change_log (url, changed_at, diff_summary, content_length)
VALUES ($1, $2, $3, $4);
`;

/** Compute a simple line-by-line diff between two text blocks */
function computeDiff(previous: string, current: string): string {
  const prevLines = previous.split(/[.!?]\s+/).filter(Boolean);
  const currLines = current.split(/[.!?]\s+/).filter(Boolean);
  const prevSet = new Set(prevLines);
  const currSet = new Set(currLines);

  const added = currLines.filter((line) => !prevSet.has(line));
  const removed = prevLines.filter((line) => !currSet.has(line));

  const parts: string[] = [];
  for (const line of removed.slice(0, 20)) {
    parts.push(`- ${line}`);
  }
  for (const line of added.slice(0, 20)) {
    parts.push(`+ ${line}`);
  }

  if (removed.length > 20) parts.push(`... and ${removed.length - 20} more removals`);
  if (added.length > 20) parts.push(`... and ${added.length - 20} more additions`);

  return parts.length > 0 ? parts.join("\n") : "(no textual diff detected)";
}

/** Generate S3 key for a URL snapshot */
function s3Key(bucket: string, url: string): string {
  const sanitized = url.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 200);
  return `/${bucket}/snapshots/${sanitized}/latest.txt`;
}

/** Download previous snapshot from RustFS (S3-compatible) */
async function downloadSnapshot(ctx: Context, bucket: string, url: string): Promise<string | null> {
  const rustfs = ctx.dependency("tentacular-rustfs");
  const key = s3Key(bucket, url);

  try {
    const res = await rustfs.fetch!(key, { method: "GET" });
    if (res.status === 404 || res.status === 403) {
      return null;
    }
    if (!res.ok) {
      ctx.log.warn(`RustFS GET ${key} returned ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log.warn(`Failed to download snapshot from RustFS: ${message}`);
    return null;
  }
}

/** Upload new snapshot to RustFS (S3-compatible) */
async function uploadSnapshot(ctx: Context, bucket: string, url: string, content: string): Promise<void> {
  const rustfs = ctx.dependency("tentacular-rustfs");
  const key = s3Key(bucket, url);

  const res = await rustfs.fetch!(key, {
    method: "PUT",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: content,
  });

  if (!res.ok) {
    ctx.log.error(`RustFS PUT ${key} failed: ${res.status} ${res.statusText}`);
  } else {
    ctx.log.info(`Stored snapshot for ${url} at ${key}`);
  }
}

/** Compare fetched pages against stored snapshots, store new snapshots, record changes */
export default async function run(ctx: Context, input: unknown): Promise<DiffResult> {
  const data = input as FetchPagesOutput;
  const bucket = ctx.config.s3_bucket as string ?? "tentacular";

  if (data.pages.length === 0) {
    ctx.log.info("No pages to diff");
    return { changedPages: [], unchangedCount: 0 };
  }

  // Check if RustFS is available for snapshot storage
  const rustfs = ctx.dependency("tentacular-rustfs");
  // Access postgres dependency for change logging
  const pg = ctx.dependency("tentacular-postgres");

  if (!rustfs.secret) {
    ctx.log.warn("No RustFS credentials, cannot compare snapshots");
    return { changedPages: [], unchangedCount: data.pages.length };
  }

  const changedPages: ChangedPage[] = [];
  let unchangedCount = 0;
  let pgClient: InstanceType<typeof Client> | null = null;

  if (pg.secret) {
    pgClient = new Client({
      hostname: pg.host,
      port: pg.port,
      database: pg.database as string ?? "appdb",
      user: pg.metadata?.user as string ?? "postgres",
      password: pg.secret,
      tls: { enabled: false },
    });
    await pgClient.connect();
    await pgClient.queryArray(CREATE_TABLE);
  }

  try {
    for (const page of data.pages) {
      if (page.statusCode === 0 || page.content === "") {
        ctx.log.warn(`Skipping ${page.url} (fetch failed)`);
        continue;
      }

      const previousContent = await downloadSnapshot(ctx, bucket, page.url);

      // Always upload the new snapshot
      await uploadSnapshot(ctx, bucket, page.url, page.content);

      if (previousContent === null) {
        ctx.log.info(`First snapshot for ${page.url}, no diff`);
        unchangedCount++;
        continue;
      }

      if (previousContent === page.content) {
        ctx.log.info(`No change detected for ${page.url}`);
        unchangedCount++;
        continue;
      }

      const diff = computeDiff(previousContent, page.content);
      const changedPage: ChangedPage = {
        url: page.url,
        previousContent,
        currentContent: page.content,
        diff,
        changedAt: page.fetchedAt,
      };
      changedPages.push(changedPage);

      // Record change in Postgres
      if (pgClient) {
        await pgClient.queryArray(INSERT_CHANGE, [
          page.url,
          page.fetchedAt,
          diff.substring(0, 1000),
          page.content.length,
        ]);
      }

      ctx.log.info(`Change detected for ${page.url}`);
    }
  } finally {
    if (pgClient) {
      await pgClient.end();
    }
  }

  ctx.log.info(`${changedPages.length} pages changed, ${unchangedCount} unchanged`);
  return { changedPages, unchangedCount };
}
