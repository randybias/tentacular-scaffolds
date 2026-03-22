import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

interface StoreAttachmentsOutput {
  filesStored: number;
  filesFailed: number;
  channelCheckpoints: Record<string, string>;
}

interface UpdateCheckpointOutput {
  updated: boolean;
  channelsUpdated: number;
}

const CREATE_CHECKPOINT_TABLE = `
CREATE TABLE IF NOT EXISTS slack_archive_checkpoints (
  channel_id TEXT PRIMARY KEY,
  last_ts TEXT NOT NULL DEFAULT '0',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const UPSERT_CHECKPOINT = `
INSERT INTO slack_archive_checkpoints (channel_id, last_ts, updated_at)
VALUES ($1, $2, NOW())
ON CONFLICT (channel_id) DO UPDATE SET
  last_ts = EXCLUDED.last_ts,
  updated_at = NOW();
`;

/** Update checkpoint timestamps in Postgres for incremental sync */
export default async function run(ctx: Context, input: unknown): Promise<UpdateCheckpointOutput> {
  const data = input as StoreAttachmentsOutput;
  const checkpoints = data.channelCheckpoints;

  const channelIds = Object.keys(checkpoints);
  if (channelIds.length === 0) {
    ctx.log.info("No checkpoints to update");
    return { updated: false, channelsUpdated: 0 };
  }

  const pg = ctx.dependency("tentacular-postgres");
  if (!pg.secret) {
    ctx.log.warn("No postgres credentials, skipping checkpoint update");
    return { updated: false, channelsUpdated: 0 };
  }

  const client = new Client({
    hostname: pg.host,
    port: pg.port,
    database: pg.database as string ?? "appdb",
    user: pg.metadata?.user as string ?? "postgres",
    password: pg.secret,
    tls: { enabled: false },
  });

  let channelsUpdated = 0;

  try {
    await client.connect();
    await client.queryArray(CREATE_CHECKPOINT_TABLE);

    for (const channelId of channelIds) {
      const lastTs = checkpoints[channelId];
      if (lastTs && lastTs !== "0") {
        await client.queryArray(UPSERT_CHECKPOINT, [channelId, lastTs]);
        channelsUpdated++;
        ctx.log.info(`Updated checkpoint for ${channelId}: ts=${lastTs}`);
      }
    }
  } finally {
    await client.end();
  }

  ctx.log.info(`Updated checkpoints for ${channelsUpdated} channels`);
  return { updated: true, channelsUpdated };
}
