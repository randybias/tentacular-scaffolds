import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

interface DriveFile {
  fileId: string;
  fileName: string;
  mimeType: string;
  content: string;
  modifiedAt: string;
}

interface PollResult {
  files: DriveFile[];
  pollTimestamp: string;
}

const CREATE_CHECKPOINT_TABLE = `
CREATE TABLE IF NOT EXISTS kb_poll_checkpoints (
  id SERIAL PRIMARY KEY,
  folder_id TEXT NOT NULL UNIQUE,
  last_poll TIMESTAMPTZ NOT NULL
);
`;

const GET_CHECKPOINT = `
SELECT last_poll FROM kb_poll_checkpoints WHERE folder_id = $1;
`;

const UPSERT_CHECKPOINT = `
INSERT INTO kb_poll_checkpoints (folder_id, last_poll)
VALUES ($1, $2)
ON CONFLICT (folder_id)
DO UPDATE SET last_poll = $2;
`;

/** Poll Google Drive for new/updated documents in configured folder(s) */
export default async function run(ctx: Context, _input: unknown): Promise<PollResult> {
  // Access dependencies early for contract drift detection
  const drive = ctx.dependency("google-drive");
  const postgres = ctx.dependency("postgres");

  const folderIds = ctx.config.drive_folder_ids as string[];
  if (!folderIds || folderIds.length === 0) {
    ctx.log.error("No drive_folder_ids configured");
    return { files: [], pollTimestamp: "" };
  }

  if (!drive.secret) {
    ctx.log.error("No google.access_token in secrets");
    return { files: [], pollTimestamp: "" };
  }
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
    await pgClient.queryArray(CREATE_CHECKPOINT_TABLE);
  }

  const allFiles: DriveFile[] = [];
  const now = new Date().toISOString();

  try {
    for (const folderId of folderIds) {
      let lastPoll = new Date(0).toISOString();

      if (pgClient) {
        const result = await pgClient.queryArray(GET_CHECKPOINT, [folderId]);
        if (result.rows.length > 0) {
          lastPoll = String(result.rows[0][0]);
        }
      }

      ctx.log.info(`Polling Drive folder ${folderId} for files modified after ${lastPoll}`);

      const query = `'${folderId}' in parents and modifiedTime > '${lastPoll}' and trashed = false`;
      const params = new URLSearchParams({
        q: query,
        fields: "files(id,name,mimeType,modifiedTime)",
        pageSize: "100",
      });

      const listRes = await drive.fetch!(`/drive/v3/files?${params.toString()}`);
      if (!listRes.ok) {
        ctx.log.error(`Drive API list failed for folder ${folderId}: ${listRes.status}`);
        continue;
      }

      const listData = await listRes.json();
      const driveFiles = listData.files ?? [];
      ctx.log.info(`Found ${driveFiles.length} new/modified file(s) in folder ${folderId}`);

      for (const file of driveFiles) {
        try {
          // For Google Docs native formats, export as plain text
          let downloadUrl = `/drive/v3/files/${file.id}?alt=media`;
          if (file.mimeType === "application/vnd.google-apps.document") {
            downloadUrl = `/drive/v3/files/${file.id}/export?mimeType=text/plain`;
          }

          const downloadRes = await drive.fetch!(downloadUrl);
          if (!downloadRes.ok) {
            ctx.log.warn(`Failed to download ${file.name}: ${downloadRes.status}`);
            continue;
          }

          const buffer = await downloadRes.arrayBuffer();
          const content = btoa(String.fromCharCode(...new Uint8Array(buffer)));

          allFiles.push({
            fileId: file.id,
            fileName: file.name,
            mimeType: file.mimeType,
            content,
            modifiedAt: file.modifiedTime,
          });
        } catch (err) {
          ctx.log.warn(`Error downloading ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Update checkpoint for this folder
      if (pgClient) {
        await pgClient.queryArray(UPSERT_CHECKPOINT, [folderId, now]);
      }
    }
  } finally {
    if (pgClient) {
      await pgClient.end();
    }
  }

  ctx.log.info(`Returning ${allFiles.length} file(s) from ${folderIds.length} folder(s)`);
  return { files: allFiles, pollTimestamp: now };
}
