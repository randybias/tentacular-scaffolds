import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

interface Attachment {
  filename: string;
  mimeType: string;
  content: string; // base64
}

interface EmailMessage {
  messageId: string;
  from: string;
  subject: string;
  date: string;
  attachments: Attachment[];
}

interface PollResult {
  messages: EmailMessage[];
  pollTimestamp: string;
}

const CREATE_CHECKPOINT_TABLE = `
CREATE TABLE IF NOT EXISTS email_invoice_checkpoints (
  id SERIAL PRIMARY KEY,
  query_key TEXT NOT NULL UNIQUE,
  last_history_id TEXT,
  last_poll TIMESTAMPTZ NOT NULL
);
`;

const GET_CHECKPOINT = `
SELECT last_history_id, last_poll FROM email_invoice_checkpoints WHERE query_key = $1;
`;

const UPSERT_CHECKPOINT = `
INSERT INTO email_invoice_checkpoints (query_key, last_history_id, last_poll)
VALUES ($1, $2, $3)
ON CONFLICT (query_key)
DO UPDATE SET last_history_id = $2, last_poll = $3;
`;

function decodeBase64Url(input: string): string {
  // Gmail API returns base64url encoding
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  return base64;
}

function extractHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value ?? "";
}

/** Poll Gmail API for invoice emails with attachments */
export default async function run(ctx: Context, _input: unknown): Promise<PollResult> {
  const gmail = ctx.dependency("gmail");
  const postgres = ctx.dependency("tentacular-postgres");

  if (!gmail.secret) {
    ctx.log.error("No google.access_token in secrets");
    return { messages: [], pollTimestamp: "" };
  }

  const gmailQuery = (ctx.config.gmail_query as string) ?? "label:invoices has:attachment";
  const checkpointTable = (ctx.config.checkpoint_table as string) ?? "email_invoice_checkpoints";

  // Get last poll checkpoint
  let lastPoll = "";
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

    try {
      await pgClient.connect();
      await pgClient.queryArray(CREATE_CHECKPOINT_TABLE);
      const result = await pgClient.queryArray(GET_CHECKPOINT, [gmailQuery]);
      if (result.rows.length > 0) {
        lastPoll = String(result.rows[0][1] ?? "");
      }
    } catch (err) {
      ctx.log.warn(`Failed to read checkpoint: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Build Gmail query with time constraint
  let fullQuery = gmailQuery;
  if (lastPoll) {
    fullQuery += ` after:${Math.floor(new Date(lastPoll).getTime() / 1000)}`;
  } else {
    // Default: last 24 hours
    fullQuery += " newer_than:1d";
  }

  ctx.log.info(`Polling Gmail with query: ${fullQuery}`);

  // List messages matching query
  const listParams = new URLSearchParams({
    q: fullQuery,
    maxResults: "20",
  });

  const listRes = await gmail.fetch!(`/gmail/v1/users/me/messages?${listParams.toString()}`);
  if (!listRes.ok) {
    ctx.log.error(`Gmail API list failed: ${listRes.status}`);
    if (pgClient) await pgClient.end();
    return { messages: [], pollTimestamp: new Date().toISOString() };
  }

  const listData = await listRes.json();
  const messageRefs = listData.messages ?? [];
  ctx.log.info(`Found ${messageRefs.length} message(s)`);

  const messages: EmailMessage[] = [];

  for (const ref of messageRefs) {
    try {
      // Fetch full message
      const msgRes = await gmail.fetch!(
        `/gmail/v1/users/me/messages/${ref.id}?format=full`,
      );
      if (!msgRes.ok) {
        ctx.log.warn(`Failed to fetch message ${ref.id}: ${msgRes.status}`);
        continue;
      }

      const msgData = await msgRes.json();
      const headers = msgData.payload?.headers ?? [];
      const from = extractHeader(headers, "From");
      const subject = extractHeader(headers, "Subject");
      const date = extractHeader(headers, "Date");

      // Extract PDF attachments
      const attachments: Attachment[] = [];
      const parts = msgData.payload?.parts ?? [];

      for (const part of parts) {
        if (part.filename && part.body?.attachmentId) {
          // Only process PDF attachments
          if (part.mimeType !== "application/pdf") continue;

          const attachRes = await gmail.fetch!(
            `/gmail/v1/users/me/messages/${ref.id}/attachments/${part.body.attachmentId}`,
          );
          if (!attachRes.ok) {
            ctx.log.warn(`Failed to fetch attachment ${part.filename}`);
            continue;
          }

          const attachData = await attachRes.json();
          attachments.push({
            filename: part.filename,
            mimeType: part.mimeType,
            content: decodeBase64Url(attachData.data ?? ""),
          });
        }
      }

      if (attachments.length > 0) {
        messages.push({
          messageId: ref.id,
          from,
          subject,
          date,
          attachments,
        });
        ctx.log.info(`Message ${ref.id}: "${subject}" from ${from}, ${attachments.length} PDF attachment(s)`);
      }
    } catch (err) {
      ctx.log.warn(`Error processing message ${ref.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Update checkpoint
  const now = new Date().toISOString();
  if (pgClient) {
    try {
      await pgClient.queryArray(UPSERT_CHECKPOINT, [gmailQuery, "", now]);
      ctx.log.info(`Updated checkpoint to ${now}`);
    } catch (err) {
      ctx.log.warn(`Failed to update checkpoint: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await pgClient.end();
    }
  }

  ctx.log.info(`Returning ${messages.length} message(s) with PDF attachments`);
  return { messages, pollTimestamp: now };
}
