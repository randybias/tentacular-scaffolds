import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

interface ValidatedExpense {
  fileId: string;
  fileName: string;
  s3Path: string;
  vendor: string;
  amount: number;
  currency: string;
  date: string;
  category: string;
  description: string;
  extractionConfidence: string;
  valid: boolean;
  validationErrors: string[];
}

interface ValidateResult {
  validated: ValidatedExpense[];
  validCount: number;
  flaggedCount: number;
  pollTimestamp: string;
}

interface StoreNotifyResult {
  storedCount: number;
  sheetAppended: boolean;
  slackNotified: boolean;
}

const CREATE_EXPENSES_TABLE = `
CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  s3_path TEXT NOT NULL,
  vendor TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL,
  expense_date DATE NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  extraction_confidence TEXT,
  valid BOOLEAN NOT NULL,
  validation_errors TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_date
  ON expenses (expense_date DESC);
`;

const INSERT_EXPENSE = `
INSERT INTO expenses (
  file_id, file_name, s3_path, vendor, amount, currency,
  expense_date, category, description, extraction_confidence, valid, validation_errors
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING id;
`;

/** Store validated expenses in Postgres, append to Google Sheets, and notify Slack */
export default async function run(ctx: Context, input: unknown): Promise<StoreNotifyResult> {
  const data = input as ValidateResult;

  if (data.validated.length === 0) {
    ctx.log.info("No expenses to store or notify about");
    return { storedCount: 0, sheetAppended: false, slackNotified: false };
  }

  // --- Store in Postgres ---
  let storedCount = 0;
  const postgres = ctx.dependency("tentacular-postgres");

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
      await client.queryArray(CREATE_EXPENSES_TABLE);

      for (const expense of data.validated) {
        await client.queryArray(INSERT_EXPENSE, [
          expense.fileId,
          expense.fileName,
          expense.s3Path,
          expense.vendor,
          expense.amount,
          expense.currency,
          expense.date,
          expense.category,
          expense.description,
          expense.extractionConfidence,
          expense.valid,
          expense.validationErrors,
        ]);
        storedCount++;
      }

      ctx.log.info(`Stored ${storedCount} expense records in Postgres`);
    } catch (err) {
      ctx.log.error(`Postgres store failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await client.end();
    }
  } else {
    ctx.log.warn("No postgres.password in secrets -- skipping DB storage");
  }

  // --- Append to Google Sheets ---
  let sheetAppended = false;
  const sheets = ctx.dependency("google-sheets");
  const sheetsId = ctx.config.sheets_id as string;

  if (sheets.secret && sheetsId) {
    const rows = data.validated.map((e) => [
      e.date,
      e.vendor,
      e.category,
      e.amount.toString(),
      e.currency,
      e.description,
      e.valid ? "VALID" : "FLAGGED",
      e.fileName,
    ]);

    try {
      const appendRes = await sheets.fetch!(
        `/v4/spreadsheets/${sheetsId}/values/Sheet1!A:H:append?valueInputOption=USER_ENTERED`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values: rows }),
        },
      );

      if (appendRes.ok) {
        sheetAppended = true;
        ctx.log.info(`Appended ${rows.length} rows to Google Sheets`);
      } else {
        ctx.log.warn(`Sheets append failed: ${appendRes.status}`);
      }
    } catch (err) {
      ctx.log.warn(`Sheets append error: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    ctx.log.warn("No Google Sheets credentials or sheets_id -- skipping");
  }

  // --- Post summary to Slack ---
  let slackNotified = false;
  const slack = ctx.dependency("slack-webhook");

  if (slack.secret) {
    const totalAmount = data.validated
      .filter((e) => e.valid)
      .reduce((sum, e) => sum + e.amount, 0);

    const lines = data.validated.map((e) => {
      const status = e.valid ? "VALID" : "FLAGGED";
      return `- [${status}] ${e.vendor}: ${e.currency} ${e.amount.toFixed(2)} (${e.category}) -- ${e.fileName}`;
    });

    const summary = [
      `*Expense Processor Summary*`,
      `Processed ${data.validated.length} receipt(s): ${data.validCount} valid, ${data.flaggedCount} flagged`,
      `Total (valid): $${totalAmount.toFixed(2)}`,
      "",
      ...lines,
    ].join("\n");

    try {
      const webhookUrl = slack.secret;
      const response = await globalThis.fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: summary,
        }),
      });

      slackNotified = response.ok;
      ctx.log.info(`Slack notification: ${response.status}`);
    } catch (err) {
      ctx.log.warn(`Slack notify error: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    ctx.log.warn("No slack.webhook_url in secrets -- skipping notification");
  }

  return { storedCount, sheetAppended, slackNotified };
}
