import type { Context } from "tentacular";

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

interface BillingResult {
  accounts: BillingMetrics[];
}

/** Query Stripe API for each customer's billing metrics */
export default async function run(ctx: Context, _input: unknown): Promise<BillingResult> {
  const accountIds = ctx.config.accounts as string[];
  const prefix = ctx.config.stripe_customer_prefix as string ?? "cus_";

  const stripe = ctx.dependency("stripe");
  if (!stripe.secret) {
    ctx.log.error("No stripe.api_key in secrets");
    return { accounts: [] };
  }

  ctx.log.info("Fetching billing metrics from Stripe");

  try {
    let targetAccounts = accountIds;
    if (targetAccounts.length === 1 && targetAccounts[0] === "all") {
      const listRes = await stripe.fetch!("/v1/customers?limit=100");
      if (!listRes.ok) {
        ctx.log.error(`Stripe customers list failed: ${listRes.status}`);
        return { accounts: [] };
      }
      const listData = await listRes.json();
      targetAccounts = (listData.data ?? []).map((c: { id: string; metadata?: { account_id?: string } }) =>
        c.metadata?.account_id ?? c.id
      );
    }

    const accounts: BillingMetrics[] = [];

    for (const accountId of targetAccounts) {
      try {
        const customerId = accountId.startsWith(prefix) ? accountId : `${prefix}${accountId}`;

        // Fetch customer subscriptions
        const subRes = await stripe.fetch!(`/v1/subscriptions?customer=${customerId}&limit=1`);
        if (!subRes.ok) {
          ctx.log.warn(`Stripe subscriptions fetch failed for ${accountId}: ${subRes.status}`);
          continue;
        }

        const subData = await subRes.json();
        const subscription = subData.data?.[0];

        // Fetch invoices for MRR calculation
        const invRes = await stripe.fetch!(
          `/v1/invoices?customer=${customerId}&limit=2&status=paid`,
        );
        const invData = invRes.ok ? await invRes.json() : { data: [] };
        const invoices = invData.data ?? [];

        const currentMrr = (subscription?.items?.data?.[0]?.price?.unit_amount ?? 0) *
          (subscription?.items?.data?.[0]?.quantity ?? 0) / 100;
        const previousMrr = invoices.length >= 2 ? (invoices[1]?.amount_paid ?? 0) / 100 : currentMrr;

        // Fetch failed payments
        const chargeRes = await stripe.fetch!(
          `/v1/charges?customer=${customerId}&limit=10`,
        );
        const chargeData = chargeRes.ok ? await chargeRes.json() : { data: [] };
        const failedPayments = (chargeData.data ?? []).filter(
          (c: { status: string }) => c.status === "failed",
        ).length;

        accounts.push({
          accountId,
          mrr: currentMrr,
          mrrChange: currentMrr - previousMrr,
          failedPayments,
          seatCount: subscription?.items?.data?.[0]?.quantity ?? 0,
          seatChange: 0,
          plan: subscription?.items?.data?.[0]?.price?.nickname ?? "unknown",
          planChange: subscription?.cancel_at_period_end ? "canceling" : "active",
        });
      } catch (err) {
        ctx.log.warn(`Error fetching billing for ${accountId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    ctx.log.info(`Fetched billing metrics for ${accounts.length} account(s)`);
    return { accounts };
  } catch (err) {
    ctx.log.error(`Failed to fetch billing data: ${err instanceof Error ? err.message : String(err)}`);
    return { accounts: [] };
  }
}
