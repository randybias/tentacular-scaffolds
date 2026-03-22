import type { Context } from "tentacular";

interface UsageMetrics {
  accountId: string;
  dailyActiveUsers_30d: number;
  featureAdoption: number;
  loginFrequency: number;
  trend: "increasing" | "declining" | "stable";
}

interface UsageResult {
  accounts: UsageMetrics[];
}

/** Query product analytics API for each customer account's usage metrics */
export default async function run(ctx: Context, _input: unknown): Promise<UsageResult> {
  const accountIds = ctx.config.accounts as string[];
  const apiBase = ctx.config.analytics_api_base as string ?? "";

  const analytics = ctx.dependency("analytics-api");
  if (!analytics.secret) {
    ctx.log.error("No analytics.api_key in secrets");
    return { accounts: [] };
  }

  ctx.log.info(`Fetching usage metrics for ${accountIds.length === 1 && accountIds[0] === "all" ? "all" : accountIds.length} account(s)`);

  try {
    // If "all" is specified, fetch the full account list first
    let targetAccounts = accountIds;
    if (targetAccounts.length === 1 && targetAccounts[0] === "all") {
      const listRes = await analytics.fetch!("/v1/accounts?limit=500");
      if (!listRes.ok) {
        ctx.log.error(`Analytics accounts list failed: ${listRes.status}`);
        return { accounts: [] };
      }
      const listData = await listRes.json();
      targetAccounts = (listData.accounts ?? []).map((a: { id: string }) => a.id);
      ctx.log.info(`Resolved "all" to ${targetAccounts.length} accounts`);
    }

    const accounts: UsageMetrics[] = [];

    for (const accountId of targetAccounts) {
      try {
        const res = await analytics.fetch!(`/v1/accounts/${accountId}/usage?period=30d`);
        if (!res.ok) {
          ctx.log.warn(`Usage fetch failed for ${accountId}: ${res.status}`);
          continue;
        }

        const data = await res.json();

        // Determine trend from DAU delta
        const dauDelta = (data.dau_current ?? 0) - (data.dau_previous ?? 0);
        let trend: "increasing" | "declining" | "stable" = "stable";
        if (dauDelta > data.dau_previous * 0.1) trend = "increasing";
        else if (dauDelta < -data.dau_previous * 0.1) trend = "declining";

        accounts.push({
          accountId,
          dailyActiveUsers_30d: data.dau_current ?? 0,
          featureAdoption: data.feature_adoption_pct ?? 0,
          loginFrequency: data.logins_per_week ?? 0,
          trend,
        });
      } catch (err) {
        ctx.log.warn(`Error fetching usage for ${accountId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    ctx.log.info(`Fetched usage metrics for ${accounts.length} account(s)`);
    return { accounts };
  } catch (err) {
    ctx.log.error(`Failed to fetch usage data: ${err instanceof Error ? err.message : String(err)}`);
    return { accounts: [] };
  }
}
