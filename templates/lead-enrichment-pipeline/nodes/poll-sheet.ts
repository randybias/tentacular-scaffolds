import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

export interface Lead {
  rowNumber: number;
  name: string;
  email: string;
  company: string;
  notes: string;
}

export interface PollResult {
  leads: Lead[];
  pollTimestamp: string;
}

const CREATE_CHECKPOINT_TABLE = `
CREATE TABLE IF NOT EXISTS sheet_poll_checkpoints (
  id SERIAL PRIMARY KEY,
  sheet_id TEXT NOT NULL UNIQUE,
  last_row INT NOT NULL DEFAULT 1
);
`;

const GET_CHECKPOINT = `
SELECT last_row FROM sheet_poll_checkpoints WHERE sheet_id = $1;
`;

const UPSERT_CHECKPOINT = `
INSERT INTO sheet_poll_checkpoints (sheet_id, last_row)
VALUES ($1, $2)
ON CONFLICT (sheet_id)
DO UPDATE SET last_row = $2;
`;

/** Poll a Google Sheet for new lead rows since last checkpoint */
export default async function run(ctx: Context, _input: unknown): Promise<PollResult> {
  const sheetsId = ctx.config.sheets_id as string;
  const sheetName = (ctx.config.sheet_name as string) ?? "Leads";

  if (!sheetsId) {
    ctx.log.warn("No sheets_id configured -- returning empty (test mode)");
    return { leads: [], pollTimestamp: "" };
  }

  const sheets = ctx.dependency("google-sheets");
  if (!sheets.secret) {
    ctx.log.warn("No google.access_token in secrets -- returning empty (test mode)");
    return { leads: [], pollTimestamp: "" };
  }

  // Get last processed row from Postgres
  let lastRow = 1; // row 1 is header
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
      const result = await client.queryArray(GET_CHECKPOINT, [sheetsId]);
      if (result.rows.length > 0) {
        lastRow = Number(result.rows[0][0]);
      }
    } catch (err) {
      ctx.log.warn(`Failed to read checkpoint: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Fetch rows starting after the checkpoint
  // Columns: A=Name, B=Email, C=Company, D=Notes
  const startRow = lastRow + 1;
  const range = encodeURIComponent(`${sheetName}!A${startRow}:D${startRow + 99}`);
  const url = `/v4/spreadsheets/${sheetsId}/values/${range}`;

  ctx.log.info(`Polling sheet ${sheetsId} for rows starting at ${startRow}`);

  const res = await sheets.fetch!(url);
  if (!res.ok) {
    ctx.log.error(`Sheets API error: ${res.status} ${res.statusText}`);
    return { leads: [], pollTimestamp: new Date().toISOString() };
  }

  const data = await res.json();
  const rows: string[][] = data.values ?? [];

  const leads: Lead[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0] && !row[1]) continue; // skip empty rows

    leads.push({
      rowNumber: startRow + i,
      name: row[0] ?? "",
      email: row[1] ?? "",
      company: row[2] ?? "",
      notes: row[3] ?? "",
    });
  }

  // Update checkpoint
  if (client && leads.length > 0) {
    const maxRow = Math.max(...leads.map((l) => l.rowNumber));
    try {
      await client.queryArray(UPSERT_CHECKPOINT, [sheetsId, maxRow]);
      ctx.log.info(`Updated checkpoint to row ${maxRow}`);
    } catch (err) {
      ctx.log.warn(`Failed to update checkpoint: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await client.end();
    }
  } else if (client) {
    await client.end();
  }

  ctx.log.info(`Found ${leads.length} new lead(s)`);
  return { leads, pollTimestamp: new Date().toISOString() };
}
