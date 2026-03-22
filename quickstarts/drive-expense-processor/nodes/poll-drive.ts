import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

interface DriveFile {
  fileId: string;
  fileName: string;
  mimeType: string;
  content: string; // base64
}

interface PollResult {
  files: DriveFile[];
  pollTimestamp: string;
}

const CREATE_CHECKPOINT_TABLE = `
CREATE TABLE IF NOT EXISTS drive_poll_checkpoints (
  id SERIAL PRIMARY KEY,
  folder_id TEXT NOT NULL UNIQUE,
  last_poll TIMESTAMPTZ NOT NULL
);
`;

const GET_CHECKPOINT = `
SELECT last_poll FROM drive_poll_checkpoints WHERE folder_id = $1;
`;

const UPSERT_CHECKPOINT = `
INSERT INTO drive_poll_checkpoints (folder_id, last_poll)
VALUES ($1, $2)
ON CONFLICT (folder_id)
DO UPDATE SET last_poll = $2;
`;

/** Poll Google Drive folder for new receipt uploads since last checkpoint */
export default async function run(ctx: Context, _input: unknown): Promise<PollResult> {
  const postgres = ctx.dependency("tentacular-postgres");
  const drive = ctx.dependency("google-drive");

  const folderId = ctx.config.drive_folder_id as string;
  if (!folderId) {
    ctx.log.error("No drive_folder_id configured");
    return { files: [], pollTimestamp: "" };
  }

  if (!drive.secret) {
    ctx.log.error("No google.access_token in secrets");
    return { files: [], pollTimestamp: "" };
  }

  // Get last poll checkpoint from Postgres
  let lastPoll = new Date(0).toISOString();
  let client: Client | null = null;

  if (postgres.secret) {
    client = new Client({
      hostname: postgres.host,
      port: postgres.port,
      database: postgres.database,
      user: postgres.user,
      password: postgres.secret,
      tls: { enabled: false },
    });

    try {
      await client.connect();
      await client.queryArray(CREATE_CHECKPOINT_TABLE);
      const result = await client.queryArray(GET_CHECKPOINT, [folderId]);
      if (result.rows.length > 0) {
        lastPoll = String(result.rows[0][0]);
      }
    } catch (err) {
      ctx.log.warn(`Failed to read checkpoint: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  ctx.log.info(`Polling Drive folder ${folderId} for files modified after ${lastPoll}`);

  // Query Google Drive for files in the folder modified after checkpoint
  const query = `'${folderId}' in parents and modifiedTime > '${lastPoll}' and trashed = false`;
  const params = new URLSearchParams({
    q: query,
    fields: "files(id,name,mimeType,modifiedTime)",
    pageSize: "50",
  });

  const listRes = await drive.fetch!(`/drive/v3/files?${params.toString()}`);
  if (!listRes.ok) {
    ctx.log.error(`Drive API list failed: ${listRes.status} ${listRes.statusText}`);
    return { files: [], pollTimestamp: new Date().toISOString() };
  }

  const listData = await listRes.json();
  const driveFiles = listData.files ?? [];
  ctx.log.info(`Found ${driveFiles.length} new/modified file(s)`);

  const files: DriveFile[] = [];

  for (const file of driveFiles) {
    try {
      const downloadRes = await drive.fetch!(
        `/drive/v3/files/${file.id}?alt=media`,
      );
      if (!downloadRes.ok) {
        ctx.log.warn(`Failed to download ${file.name}: ${downloadRes.status}`);
        continue;
      }

      const buffer = await downloadRes.arrayBuffer();
      const base64 = btoa(
        String.fromCharCode(...new Uint8Array(buffer)),
      );

      files.push({
        fileId: file.id,
        fileName: file.name,
        mimeType: file.mimeType,
        content: base64,
      });
    } catch (err) {
      ctx.log.warn(`Error downloading ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Update checkpoint
  const now = new Date().toISOString();
  if (client) {
    try {
      await client.queryArray(UPSERT_CHECKPOINT, [folderId, now]);
      ctx.log.info(`Updated checkpoint to ${now}`);
    } catch (err) {
      ctx.log.warn(`Failed to update checkpoint: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await client.end();
    }
  }

  ctx.log.info(`Returning ${files.length} file(s)`);
  return { files, pollTimestamp: now };
}
