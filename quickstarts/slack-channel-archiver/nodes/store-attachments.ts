import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

interface SlackFile {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  urlPrivateDownload: string;
}

interface SlackMessage {
  messageId: string;
  channelId: string;
  userId: string;
  text: string;
  threadTs: string;
  ts: string;
  files: SlackFile[];
}

interface StoreMessagesOutput {
  storedCount: number;
  messagesWithFiles: SlackMessage[];
  channelCheckpoints: Record<string, string>;
}

interface StoreAttachmentsOutput {
  filesStored: number;
  filesFailed: number;
  channelCheckpoints: Record<string, string>;
}

const CREATE_FILES_TABLE = `
CREATE TABLE IF NOT EXISTS slack_file_metadata (
  id SERIAL PRIMARY KEY,
  file_id TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL,
  message_ts TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '',
  size_bytes INT NOT NULL DEFAULT 0,
  s3_path TEXT NOT NULL DEFAULT '',
  stored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slack_files_channel
  ON slack_file_metadata (channel_id);
`;

const INSERT_FILE_META = `
INSERT INTO slack_file_metadata (file_id, channel_id, message_ts, file_name, mime_type, size_bytes, s3_path)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (file_id) DO NOTHING;
`;

/** Download file attachments from Slack and store in RustFS (S3) */
export default async function run(ctx: Context, input: unknown): Promise<StoreAttachmentsOutput> {
  const data = input as StoreMessagesOutput;

  // Access dependencies early to declare network intent for contract drift detection
  const slack = ctx.dependency("slack-api");
  const rustfs = ctx.dependency("tentacular-rustfs");

  if (data.messagesWithFiles.length === 0) {
    ctx.log.info("No file attachments to store");
    return { filesStored: 0, filesFailed: 0, channelCheckpoints: data.channelCheckpoints };
  }

  if (!slack.secret) {
    ctx.log.error("No Slack bot token for downloading files");
    return { filesStored: 0, filesFailed: data.messagesWithFiles.length, channelCheckpoints: data.channelCheckpoints };
  }

  // Set up Postgres for file metadata
  const pg = ctx.dependency("tentacular-postgres");
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
    await pgClient.queryArray(CREATE_FILES_TABLE);
  }

  let filesStored = 0;
  let filesFailed = 0;

  try {
    for (const msg of data.messagesWithFiles) {
      for (const file of msg.files) {
        if (!file.urlPrivateDownload) {
          ctx.log.warn(`No download URL for file ${file.fileId} in ${msg.channelId}`);
          filesFailed++;
          continue;
        }

        try {
          // Download file from Slack
          const downloadRes = await fetch(file.urlPrivateDownload, {
            headers: { "Authorization": `Bearer ${slack.secret}` },
          });

          if (!downloadRes.ok) {
            ctx.log.error(`Failed to download file ${file.fileId}: ${downloadRes.status}`);
            filesFailed++;
            continue;
          }

          const fileData = await downloadRes.arrayBuffer();

          // Upload to RustFS
          const s3Path = `/tentacular/channels/${msg.channelId}/files/${file.fileId}/${file.name}`;

          const uploadRes = await rustfs.fetch!(s3Path, {
            method: "PUT",
            headers: { "Content-Type": file.mimeType || "application/octet-stream" },
            body: fileData,
          });

          if (!uploadRes.ok) {
            ctx.log.error(`Failed to upload file ${file.fileId} to RustFS: ${uploadRes.status}`);
            filesFailed++;
            continue;
          }

          // Record metadata in Postgres
          if (pgClient) {
            await pgClient.queryArray(INSERT_FILE_META, [
              file.fileId,
              msg.channelId,
              msg.ts,
              file.name,
              file.mimeType,
              file.size,
              s3Path,
            ]);
          }

          filesStored++;
          ctx.log.info(`Stored file ${file.fileId} (${file.name}) at ${s3Path}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          ctx.log.error(`Error processing file ${file.fileId}: ${message}`);
          filesFailed++;
        }
      }
    }
  } finally {
    if (pgClient) {
      await pgClient.end();
    }
  }

  ctx.log.info(`Files stored: ${filesStored}, failed: ${filesFailed}`);
  return { filesStored, filesFailed, channelCheckpoints: data.channelCheckpoints };
}
