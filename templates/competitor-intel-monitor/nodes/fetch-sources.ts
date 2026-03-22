import type { Context } from "tentacular";

interface CompetitorConfig {
  name: string;
  urls: string[];
}

interface SourceContent {
  type: string;
  url: string;
  content: string;
  fetchedAt: string;
  statusCode: number;
}

interface CompetitorSources {
  competitor: string;
  sources: SourceContent[];
}

interface FetchResult {
  competitorSources: CompetitorSources[];
  fetchedAt: string;
}

/** Fetch web pages for each competitor in config */
export default async function run(ctx: Context, _input: unknown): Promise<FetchResult> {
  // Reference probe-targets dependency for contract compliance (used for dynamic target egress)
  ctx.dependency("probe-targets");

  const competitors = (ctx.config.competitors as CompetitorConfig[]) ?? [];

  if (competitors.length === 0) {
    ctx.log.warn("No competitors configured");
    return { competitorSources: [], fetchedAt: "" };
  }

  ctx.log.info(`Fetching sources for ${competitors.length} competitor(s)`);
  const competitorSources: CompetitorSources[] = [];

  for (const competitor of competitors) {
    const sources: SourceContent[] = [];

    for (const url of competitor.urls) {
      try {
        const start = Date.now();
        const response = await ctx.fetch("probe", url, {
          method: "GET",
          headers: {
            "User-Agent": "tentacular-competitor-monitor/1.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });

        const content = await response.text();
        const latencyMs = Date.now() - start;

        // Determine source type from URL path
        let type = "page";
        if (url.includes("/pricing")) type = "pricing";
        else if (url.includes("/features")) type = "features";
        else if (url.includes("/blog")) type = "blog";
        else if (url.includes("/careers")) type = "careers";

        sources.push({
          type,
          url,
          content,
          fetchedAt: new Date().toISOString(),
          statusCode: response.status,
        });

        ctx.log.info(`Fetched ${competitor.name} ${type}: ${url} (${response.status}, ${latencyMs}ms, ${content.length} chars)`);
      } catch (err) {
        ctx.log.warn(`Failed to fetch ${url} for ${competitor.name}: ${err instanceof Error ? err.message : String(err)}`);
        sources.push({
          type: "page",
          url,
          content: "",
          fetchedAt: new Date().toISOString(),
          statusCode: 0,
        });
      }
    }

    competitorSources.push({
      competitor: competitor.name,
      sources,
    });
  }

  const totalSources = competitorSources.reduce((sum, cs) => sum + cs.sources.length, 0);
  ctx.log.info(`Fetched ${totalSources} source(s) across ${competitorSources.length} competitor(s)`);

  return { competitorSources, fetchedAt: new Date().toISOString() };
}
