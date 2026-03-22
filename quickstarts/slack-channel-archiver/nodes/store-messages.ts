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

interface FetchMessagesOutput {
  messages: SlackMessage[];
  channelCheckpoints: Record<string, string>;
}

interface StoreMessagesOutput {
  storedCount: number;
  messagesWithFiles: SlackMessage[];
  channelCheckpoints: Record<string, string>;
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS slack_messages (
  id SERIAL PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  thread_ts TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slack_messages_channel
  ON slack_messages (channel_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_slack_messages_ts
  ON slack_messages (ts DESC);
`;

const INSERT_MESSAGE = `
INSERT INTO slack_messages (message_id, channel_id, user_id, text, thread_ts, ts)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (message_id) DO NOTHING;
`;

/** Store fetched Slack messages in Postgres */
export default async function run(ctx: Context, input: unknown): Promise<StoreMessagesOutput> {
  const data = input as FetchMessagesOutput;

  if (data.messages.length === 0) {
    ctx.log.info("No messages to store");
    return { storedCount: 0, messagesWithFiles: [], channelCheckpoints: data.channelCheckpoints };
  }

  const pg = ctx.dependency("tentacular-postgres");
  if (!pg.secret) {
    ctx.log.warn("No postgres credentials, skipping message storage");
    const messagesWithFiles = data.messages.filter((m) => m.files.length > 0);
    return { storedCount: 0, messagesWithFiles, channelCheckpoints: data.channelCheckpoints };
  }

  ctx.log.info(`Storing ${data.messages.length} messages in Postgres`);

  const client = new Client({
    hostname: pg.host,
    port: pg.port,
    database: pg.database as string ?? "appdb",
    user: pg.metadata?.user as string ?? "postgres",
    password: pg.secret,
    tls: { enabled: false },
  });

  let storedCount = 0;

  try {
    await client.connect();
    await client.queryArray(CREATE_TABLE);

    for (const msg of data.messages) {
      await client.queryArray(INSERT_MESSAGE, [
        msg.messageId,
        msg.channelId,
        msg.userId,
        msg.text,
        msg.threadTs,
        msg.ts,
      ]);
      storedCount++;
    }

    ctx.log.info(`Stored ${storedCount} messages`);
  } finally {
    await client.end();
  }

  const messagesWithFiles = data.messages.filter((m) => m.files.length > 0);
  ctx.log.info(`${messagesWithFiles.length} messages have file attachments`);

  return { storedCount, messagesWithFiles, channelCheckpoints: data.channelCheckpoints };
}
