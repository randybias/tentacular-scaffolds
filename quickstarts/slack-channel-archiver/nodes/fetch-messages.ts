import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

interface SlackMessage {
  messageId: string;
  channelId: string;
  userId: string;
  text: string;
  threadTs: string;
  ts: string;
  files: SlackFile[];
}

interface SlackFile {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  urlPrivateDownload: string;
}

interface FetchMessagesOutput {
  messages: SlackMessage[];
  channelCheckpoints: Record<string, string>;
}

interface ApiMessage {
  type: string;
  ts: string;
  user?: string;
  text?: string;
  thread_ts?: string;
  files?: {
    id: string;
    name: string;
    mimetype: string;
    size: number;
    url_private_download?: string;
  }[];
}

interface ConversationsHistoryResponse {
  ok: boolean;
  messages: ApiMessage[];
  has_more: boolean;
  response_metadata?: { next_cursor: string };
  error?: string;
}

const CREATE_CHECKPOINT_TABLE = `
CREATE TABLE IF NOT EXISTS slack_archive_checkpoints (
  channel_id TEXT PRIMARY KEY,
  last_ts TEXT NOT NULL DEFAULT '0',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const GET_CHECKPOINT = `
SELECT last_ts FROM slack_archive_checkpoints WHERE channel_id = $1;
`;

/** Fetch new messages from configured Slack channels since last checkpoint */
export default async function run(ctx: Context, _input: unknown): Promise<FetchMessagesOutput> {
  const channels = ctx.config.channels as string[];

  if (!channels || channels.length === 0) {
    ctx.log.warn("No channels configured for archiving");
    return { messages: [], channelCheckpoints: {} };
  }

  const slack = ctx.dependency("slack-api");
  if (!slack.secret) {
    ctx.log.error("No Slack bot token available");
    return { messages: [], channelCheckpoints: {} };
  }

  // Get checkpoints from Postgres
  const pg = ctx.dependency("tentacular-postgres");
  const checkpoints: Record<string, string> = {};

  if (pg.secret) {
    const client = new Client({
      hostname: pg.host,
      port: pg.port,
      database: pg.database as string ?? "appdb",
      user: pg.metadata?.user as string ?? "postgres",
      password: pg.secret,
      tls: { enabled: false },
    });

    try {
      await client.connect();
      await client.queryArray(CREATE_CHECKPOINT_TABLE);

      for (const channelId of channels) {
        const result = await client.queryObject<{ last_ts: string }>(GET_CHECKPOINT, [channelId]);
        checkpoints[channelId] = result.rows[0]?.last_ts ?? "0";
      }
    } finally {
      await client.end();
    }
  }

  const allMessages: SlackMessage[] = [];

  for (const channelId of channels) {
    const oldest = checkpoints[channelId] ?? "0";
    let cursor: string | undefined;
    let hasMore = true;

    ctx.log.info(`Fetching messages for channel ${channelId} since ts=${oldest}`);

    while (hasMore) {
      const params = new URLSearchParams({
        channel: channelId,
        oldest,
        limit: "200",
        inclusive: "false",
      });
      if (cursor) params.set("cursor", cursor);

      const res = await slack.fetch!(`/api/conversations.history?${params.toString()}`);
      if (!res.ok) {
        ctx.log.error(`Slack API error for ${channelId}: ${res.status}`);
        break;
      }

      const body: ConversationsHistoryResponse = await res.json();
      if (!body.ok) {
        ctx.log.error(`Slack API returned error for ${channelId}: ${body.error}`);
        break;
      }

      for (const msg of body.messages) {
        if (msg.type !== "message") continue;

        const files: SlackFile[] = (msg.files ?? []).map((f) => ({
          fileId: f.id,
          name: f.name,
          mimeType: f.mimetype,
          size: f.size,
          urlPrivateDownload: f.url_private_download ?? "",
        }));

        allMessages.push({
          messageId: `${channelId}:${msg.ts}`,
          channelId,
          userId: msg.user ?? "unknown",
          text: msg.text ?? "",
          threadTs: msg.thread_ts ?? "",
          ts: msg.ts,
          files,
        });
      }

      hasMore = body.has_more;
      cursor = body.response_metadata?.next_cursor;
      if (!cursor) hasMore = false;
    }

    ctx.log.info(`Fetched ${allMessages.filter((m) => m.channelId === channelId).length} messages from ${channelId}`);
  }

  // Compute new checkpoints (latest ts per channel)
  const channelCheckpoints: Record<string, string> = { ...checkpoints };
  for (const msg of allMessages) {
    const current = channelCheckpoints[msg.channelId] ?? "0";
    if (msg.ts > current) {
      channelCheckpoints[msg.channelId] = msg.ts;
    }
  }

  ctx.log.info(`Fetched ${allMessages.length} total messages across ${channels.length} channels`);
  return { messages: allMessages, channelCheckpoints };
}
