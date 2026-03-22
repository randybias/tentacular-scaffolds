import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface ValidatedInvoice {
  messageId: string;
  from: string;
  subject: string;
  filename: string;
  s3Path: string;
  vendor: string;
  invoiceNumber: string;
  lineItems: LineItem[];
  subtotal: number;
  tax: number;
  total: number;
  dueDate: string;
  paymentTerms: string;
  validationStatus: "PASS" | "FAIL";
  validationErrors: string[];
}

interface ValidateResult {
  validated: ValidatedInvoice[];
  passCount: number;
  failCount: number;
  pollTimestamp: string;
}

interface StoreNotifyResult {
  storedCount: number;
  slackNotified: boolean;
}

const CREATE_INVOICES_TABLE = `
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  message_id TEXT NOT NULL,
  vendor TEXT NOT NULL,
  invoice_number TEXT,
  filename TEXT NOT NULL,
  s3_path TEXT,
  subtotal NUMERIC(12, 2),
  tax NUMERIC(12, 2),
  total NUMERIC(12, 2) NOT NULL,
  due_date DATE,
  payment_terms TEXT,
  line_items_json JSONB NOT NULL,
  validation_status TEXT NOT NULL,
  validation_errors TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_vendor
  ON invoices (vendor, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date
  ON invoices (due_date);
`;

const INSERT_INVOICE = `
INSERT INTO invoices (
  message_id, vendor, invoice_number, filename, s3_path,
  subtotal, tax, total, due_date, payment_terms,
  line_items_json, validation_status, validation_errors
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
RETURNING id;
`;

/** Store validated invoices in Postgres and post summary to Slack */
export default async function run(ctx: Context, input: unknown): Promise<StoreNotifyResult> {
  const data = input as ValidateResult;

  if (data.validated.length === 0) {
    ctx.log.info("No invoices to store or notify about");
    return { storedCount: 0, slackNotified: false };
  }

  // --- Store in Postgres ---
  let storedCount = 0;
  const postgres = ctx.dependency("postgres");

  if (postgres.secret) {
    const client = new Client({
      hostname: postgres.host,
      port: postgres.port,
      database: postgres.database,
      user: postgres.user,
      password: postgres.secret,
      tls: { enabled: false },
    });

    try {
      await client.connect();
      await client.queryArray(CREATE_INVOICES_TABLE);

      for (const invoice of data.validated) {
        await client.queryArray(INSERT_INVOICE, [
          invoice.messageId,
          invoice.vendor,
          invoice.invoiceNumber,
          invoice.filename,
          invoice.s3Path,
          invoice.subtotal,
          invoice.tax,
          invoice.total,
          invoice.dueDate || null,
          invoice.paymentTerms,
          JSON.stringify(invoice.lineItems),
          invoice.validationStatus,
          invoice.validationErrors,
        ]);
        storedCount++;
      }

      ctx.log.info(`Stored ${storedCount} invoice records in Postgres`);
    } catch (err) {
      ctx.log.error(`Postgres store failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await client.end();
    }
  } else {
    ctx.log.warn("No postgres.password in secrets -- skipping DB storage");
  }

  // --- Post summary to Slack ---
  let slackNotified = false;
  const slack = ctx.dependency("slack-webhook");

  if (slack.secret) {
    const lines = data.validated.map((inv) => {
      const dueDateStr = inv.dueDate ? ` due ${inv.dueDate}` : "";
      const lineItemCount = inv.lineItems.length;
      return `- Invoice from ${inv.vendor}, $${inv.total.toFixed(2)}${dueDateStr}. ${lineItemCount} line item(s). Validation: ${inv.validationStatus}${
        inv.validationStatus === "FAIL" ? `: ${inv.validationErrors[0]}` : ""
      }`;
    });

    const totalAmount = data.validated.reduce((sum, inv) => sum + inv.total, 0);
    const summary = [
      `*Invoice Processor Summary*`,
      `Processed ${data.validated.length} invoice(s): ${data.passCount} PASS, ${data.failCount} FAIL`,
      `Total value: $${totalAmount.toFixed(2)}`,
      "",
      ...lines,
    ].join("\n");

    try {
      const webhookUrl = slack.secret;
      const response = await globalThis.fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: summary }),
      });

      slackNotified = response.ok;
      ctx.log.info(`Slack notification: ${response.status}`);
    } catch (err) {
      ctx.log.warn(`Slack notify error: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    ctx.log.warn("No slack.webhook_url in secrets -- skipping notification");
  }

  return { storedCount, slackNotified };
}
