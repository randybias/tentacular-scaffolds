import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

export interface DriveFile {
  fileId: string;
  fileName: string;
  mimeType: string;
  content: string; // base64
}

export interface PollResult {
  files: DriveFile[];
  pollTimestamp: string;
}

const CREATE_CHECKPOINT_TABLE = `
CREATE TABLE IF NOT EXISTS contract_poll_checkpoints (
  id SERIAL PRIMARY KEY,
  folder_id TEXT NOT NULL UNIQUE,
  last_poll TIMESTAMPTZ NOT NULL
);
`;

const GET_CHECKPOINT = `
SELECT last_poll FROM contract_poll_checkpoints WHERE folder_id = $1;
`;

const UPSERT_CHECKPOINT = `
INSERT INTO contract_poll_checkpoints (folder_id, last_poll)
VALUES ($1, $2)
ON CONFLICT (folder_id)
DO UPDATE SET last_poll = $2;
`;

/** Poll Google Drive folder for new contract files since last checkpoint */
export default async function run(ctx: Context, _input: unknown): Promise<PollResult> {
  const folderId = ctx.config.drive_folder_id as string;

  // Access declared dependency so contract drift checker sees it
  const drive = ctx.dependency("google-drive");

  if (!folderId || !drive.secret) {
    ctx.log.warn("No drive_folder_id or google.access_token -- returning empty (test mode)");
    return { files: [], pollTimestamp: "" };
  }

  // Get last poll checkpoint from Postgres
  let lastPoll = new Date(0).toISOString();
  const pg = ctx.dependency("postgres");
  let client: Client | null = null;

  if (pg.secret) {
    client = new Client({
      hostname: pg.host,
      port: pg.port,
      database: pg.database,
      user: pg.user,
      password: pg.secret,
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

  ctx.log.info(`Polling Drive folder ${folderId} for contracts modified after ${lastPoll}`);

  // Query for PDF and DOCX files
  const query = `'${folderId}' in parents and modifiedTime > '${lastPoll}' and trashed = false and (mimeType = 'application/pdf' or mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')`;
  const params = new URLSearchParams({
    q: query,
    fields: "files(id,name,mimeType,modifiedTime)",
    pageSize: "20",
  });

  const listRes = await drive.fetch!(`/drive/v3/files?${params.toString()}`);
  if (!listRes.ok) {
    ctx.log.error(`Drive API list failed: ${listRes.status} ${listRes.statusText}`);
    return { files: [], pollTimestamp: new Date().toISOString() };
  }

  const listData = await listRes.json();
  const driveFiles = listData.files ?? [];
  ctx.log.info(`Found ${driveFiles.length} new/modified contract file(s)`);

  const files: DriveFile[] = [];

  for (const file of driveFiles) {
    try {
      const downloadRes = await drive.fetch!(`/drive/v3/files/${file.id}?alt=media`);
      if (!downloadRes.ok) {
        ctx.log.warn(`Failed to download ${file.name}: ${downloadRes.status}`);
        continue;
      }

      const buffer = await downloadRes.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

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

  ctx.log.info(`Returning ${files.length} contract file(s)`);
  return { files, pollTimestamp: now };
}
