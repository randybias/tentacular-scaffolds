import type { Context } from "tentacular";

interface TicketMetrics {
  accountId: string;
  openTickets: number;
  ticketsLast30d: number;
  avgSentiment: number;
  escalations: number;
}

interface TicketsResult {
  accounts: TicketMetrics[];
}

/** Query support ticketing API for each customer's ticket metrics */
export default async function run(ctx: Context, _input: unknown): Promise<TicketsResult> {
  const accountIds = ctx.config.accounts as string[];

  const support = ctx.dependency("support-api");
  if (!support.secret) {
    ctx.log.error("No support.api_key in secrets");
    return { accounts: [] };
  }

  ctx.log.info("Fetching support ticket metrics");

  try {
    let targetAccounts = accountIds;
    if (targetAccounts.length === 1 && targetAccounts[0] === "all") {
      const listRes = await support.fetch!("/v1/customers?limit=500");
      if (!listRes.ok) {
        ctx.log.error(`Support customers list failed: ${listRes.status}`);
        return { accounts: [] };
      }
      const listData = await listRes.json();
      targetAccounts = (listData.customers ?? []).map((c: { account_id: string }) => c.account_id);
    }

    const accounts: TicketMetrics[] = [];

    for (const accountId of targetAccounts) {
      try {
        const res = await support.fetch!(`/v1/customers/${accountId}/tickets?period=30d`);
        if (!res.ok) {
          ctx.log.warn(`Tickets fetch failed for ${accountId}: ${res.status}`);
          continue;
        }

        const data = await res.json();
        accounts.push({
          accountId,
          openTickets: data.open_count ?? 0,
          ticketsLast30d: data.total_count ?? 0,
          avgSentiment: data.avg_sentiment ?? 0,
          escalations: data.escalation_count ?? 0,
        });
      } catch (err) {
        ctx.log.warn(`Error fetching tickets for ${accountId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    ctx.log.info(`Fetched ticket metrics for ${accounts.length} account(s)`);
    return { accounts };
  } catch (err) {
    ctx.log.error(`Failed to fetch ticket data: ${err instanceof Error ? err.message : String(err)}`);
    return { accounts: [] };
  }
}
