import type { Context } from "tentacular";
import type { DeduplicateOutput, UnifiedAlert } from "./deduplicate.ts";

export interface RepoContext {
  customer_facing: boolean;
  environment: string;
  team: string;
}

export interface EnrichedAlert extends UnifiedAlert {
  repoContext: RepoContext;
}

export interface EnrichOutput {
  alerts: EnrichedAlert[];
  org: string;
}

/** Enrich each alert with organizational repo context from config */
export default async function run(ctx: Context, input: unknown): Promise<EnrichOutput> {
  const data = input as DeduplicateOutput;

  if (data.newAlerts.length === 0) {
    ctx.log.info("No new alerts to enrich");
    return { alerts: [], org: data.org };
  }

  const repoContextMap = (ctx.config.repo_context as Record<string, RepoContext>) ?? {};

  ctx.log.info(`Enriching ${data.newAlerts.length} alerts with repo context`);

  const defaultContext: RepoContext = {
    customer_facing: false,
    environment: "unknown",
    team: "unassigned",
  };

  const enriched: EnrichedAlert[] = data.newAlerts.map((alert) => {
    const context = repoContextMap[alert.repo] ?? defaultContext;
    return {
      ...alert,
      repoContext: {
        customer_facing: context.customer_facing ?? false,
        environment: context.environment ?? "unknown",
        team: context.team ?? "unassigned",
      },
    };
  });

  const withContext = enriched.filter((a) => repoContextMap[a.repo]);
  ctx.log.info(`Enriched ${enriched.length} alerts (${withContext.length} with known repo context)`);

  return { alerts: enriched, org: data.org };
}
