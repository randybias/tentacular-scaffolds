import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

interface TicketResult {
  created: boolean;
  issueUrl: string;
  issueNumber: number;
}

interface NotifyResult {
  delivered: boolean;
  status: number;
}

interface PublishResult {
  published: boolean;
  subject: string;
}

interface PageResult {
  paged: boolean;
  skipped: boolean;
  reason: string;
}

interface LogEntry {
  action: string;
  success: boolean;
  details: string;
}

interface LogResult {
  logged: boolean;
  entries: LogEntry[];
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS incident_log (
  id SERIAL PRIMARY KEY,
  incident_id TEXT NOT NULL,
  action TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_log_incident_id
  ON incident_log (incident_id, created_at DESC);
`;

const INSERT_LOG = `
INSERT INTO incident_log (incident_id, action, success, details)
VALUES ($1, $2, $3, $4);
`;

/** Fan-in from all response actions. Record everything in Postgres incident_log table. */
export default async function run(ctx: Context, input: unknown): Promise<LogResult> {
  const merged = input as Record<string, unknown>;

  // Extract results from merged fan-in input
  const ticket = (merged["create-ticket"] ?? merged) as Partial<TicketResult>;
  const notify = (merged["notify-slack"] ?? merged) as Partial<NotifyResult>;
  const publish = (merged["publish-event"] ?? merged) as Partial<PublishResult>;
  const page = (merged["page-oncall"] ?? merged) as Partial<PageResult>;

  const incidentId = `inc-${Date.now()}`;
  const entries: LogEntry[] = [];

  // Build log entries from each action result
  if (ticket.issueUrl !== undefined) {
    entries.push({
      action: "create-ticket",
      success: ticket.created ?? false,
      details: ticket.created ? `Issue: ${ticket.issueUrl}` : "Ticket creation skipped or failed",
    });
  }

  if (notify.status !== undefined) {
    entries.push({
      action: "notify-slack",
      success: notify.delivered ?? false,
      details: `Slack status: ${notify.status}`,
    });
  }

  if (publish.subject !== undefined) {
    entries.push({
      action: "publish-event",
      success: publish.published ?? false,
      details: publish.published ? `NATS subject: ${publish.subject}` : "NATS publish skipped or failed",
    });
  }

  if (page.reason !== undefined) {
    entries.push({
      action: "page-oncall",
      success: page.paged ?? false,
      details: page.reason ?? (page.skipped ? "Skipped (low severity)" : "Unknown"),
    });
  }

  // Store in Postgres
  const postgres = ctx.dependency("postgres");
  if (!postgres.secret) {
    ctx.log.warn("No postgres.password in secrets -- logging to stdout only");
    for (const entry of entries) {
      ctx.log.info(`[${incidentId}] ${entry.action}: ${entry.success ? "OK" : "FAIL"} - ${entry.details}`);
    }
    return { logged: false, entries };
  }

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
    await client.queryArray(CREATE_TABLE);

    for (const entry of entries) {
      await client.queryArray(INSERT_LOG, [incidentId, entry.action, entry.success, entry.details]);
    }

    ctx.log.info(`Logged ${entries.length} action(s) for incident ${incidentId}`);
    return { logged: true, entries };
  } catch (err) {
    ctx.log.error(`Failed to log actions: ${err instanceof Error ? err.message : String(err)}`);
    return { logged: false, entries };
  } finally {
    await client.end();
  }
}
