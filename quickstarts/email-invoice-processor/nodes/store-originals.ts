import type { Context } from "tentacular";
import { S3Client } from "https://deno.land/x/s3_lite_client@0.7.0/mod.ts";

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

interface StoredInvoice {
  messageId: string;
  from: string;
  subject: string;
  date: string;
  filename: string;
  mimeType: string;
  s3Path: string;
  content: string; // base64 pass-through for extraction
}

interface StoreResult {
  storedInvoices: StoredInvoice[];
  pollTimestamp: string;
}

/** Store original PDF invoices in RustFS under invoices/{year}/{month}/{messageId}/{filename} */
export default async function run(ctx: Context, input: unknown): Promise<StoreResult> {
  const data = input as PollResult;

  if (data.messages.length === 0) {
    ctx.log.info("No messages to store");
    return { storedInvoices: [], pollTimestamp: data.pollTimestamp };
  }

  const rustfs = ctx.dependency("rustfs");
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

  const now = new Date();
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const storedInvoices: StoredInvoice[] = [];

  for (const msg of data.messages) {
    for (const attachment of msg.attachments) {
      const s3Path = `invoices/${year}/${month}/${msg.messageId}/${attachment.filename}`;

      if (s3) {
        try {
          const bytes = Uint8Array.from(atob(attachment.content), (c) => c.charCodeAt(0));
          await s3.putObject(s3Path, bytes, {
            metadata: {
              "Content-Type": attachment.mimeType,
              "x-amz-meta-message-id": msg.messageId,
              "x-amz-meta-from": msg.from,
            },
          });
          ctx.log.info(`Stored ${attachment.filename} at ${s3Path}`);
        } catch (err) {
          ctx.log.warn(`Failed to store ${attachment.filename}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      storedInvoices.push({
        messageId: msg.messageId,
        from: msg.from,
        subject: msg.subject,
        date: msg.date,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        s3Path: s3 ? s3Path : "",
        content: attachment.content,
      });
    }
  }

  ctx.log.info(`Stored ${storedInvoices.length} invoice PDF(s) in RustFS`);
  return { storedInvoices, pollTimestamp: data.pollTimestamp };
}
