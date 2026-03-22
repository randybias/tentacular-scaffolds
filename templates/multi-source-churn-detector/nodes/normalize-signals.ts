import type { Context } from "tentacular";

interface UsageMetrics {
  accountId: string;
  dailyActiveUsers_30d: number;
  featureAdoption: number;
  loginFrequency: number;
  trend: string;
}

interface TicketMetrics {
  accountId: string;
  openTickets: number;
  ticketsLast30d: number;
  avgSentiment: number;
  escalations: number;
}

interface BillingMetrics {
  accountId: string;
  mrr: number;
  mrrChange: number;
  failedPayments: number;
  seatCount: number;
  seatChange: number;
  plan: string;
  planChange: string;
}

interface SurveyMetrics {
  accountId: string;
  latestNPS: number;
  latestCSAT: number;
  surveyDate: string;
  trend: string;
}

interface UnifiedCustomerRecord {
  accountId: string;
  usage: UsageMetrics | null;
  tickets: TicketMetrics | null;
  billing: BillingMetrics | null;
  surveys: SurveyMetrics | null;
  dataCompleteness: number;
}

interface NormalizeResult {
  customers: UnifiedCustomerRecord[];
  totalAccounts: number;
}

/** Merge all 4 data sources by accountId into unified customer records */
export default async function run(ctx: Context, input: unknown): Promise<NormalizeResult> {
  const merged = input as Record<string, unknown>;

  // Extract arrays from fan-in merged input
  const usageData = ((merged["fetch-usage"] as { accounts?: UsageMetrics[] })?.accounts ??
    (merged as { accounts?: UsageMetrics[] }).accounts ?? []) as UsageMetrics[];
  const ticketData = ((merged["fetch-tickets"] as { accounts?: TicketMetrics[] })?.accounts ?? []) as TicketMetrics[];
  const billingData = ((merged["fetch-billing"] as { accounts?: BillingMetrics[] })?.accounts ?? []) as BillingMetrics[];
  const surveyData = ((merged["fetch-surveys"] as { accounts?: SurveyMetrics[] })?.accounts ?? []) as SurveyMetrics[];

  // Collect all unique account IDs
  const accountIds = new Set<string>();
  for (const u of usageData) accountIds.add(u.accountId);
  for (const t of ticketData) accountIds.add(t.accountId);
  for (const b of billingData) accountIds.add(b.accountId);
  for (const s of surveyData) accountIds.add(s.accountId);

  // Build lookup maps
  const usageMap = new Map(usageData.map((u) => [u.accountId, u]));
  const ticketMap = new Map(ticketData.map((t) => [t.accountId, t]));
  const billingMap = new Map(billingData.map((b) => [b.accountId, b]));
  const surveyMap = new Map(surveyData.map((s) => [s.accountId, s]));

  const customers: UnifiedCustomerRecord[] = [];

  for (const accountId of accountIds) {
    const usage = usageMap.get(accountId) ?? null;
    const tickets = ticketMap.get(accountId) ?? null;
    const billing = billingMap.get(accountId) ?? null;
    const surveys = surveyMap.get(accountId) ?? null;

    // Calculate data completeness (0-100%)
    const sources = [usage, tickets, billing, surveys];
    const available = sources.filter((s) => s !== null).length;
    const dataCompleteness = Math.round((available / 4) * 100);

    customers.push({
      accountId,
      usage,
      tickets,
      billing,
      surveys,
      dataCompleteness,
    });
  }

  ctx.log.info(
    `Normalized ${customers.length} customer records from ${usageData.length} usage, ${ticketData.length} ticket, ${billingData.length} billing, ${surveyData.length} survey records`,
  );

  return { customers, totalAccounts: customers.length };
}
