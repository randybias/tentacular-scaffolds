import type { Context } from "tentacular";
import type { ArticleContent } from "./fetch-article.ts";

export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
  relevance: string;
}

export interface ResearchOutput {
  sources: ResearchSource[];
  searchType: string;
}

/** Search for adjacent angles, tangential topics, and unexplored implications */
export default async function run(ctx: Context, input: unknown): Promise<ResearchOutput> {
  const article = input as ArticleContent;

  ctx.log.info(`Researching adjacent angles for: "${article.title}"`);

  const tavily = ctx.dependency("tavily");
  if (!tavily.secret) {
    ctx.log.warn("No tavily API key, returning empty results");
    return { sources: [], searchType: "adjacent" };
  }

  const thesis = article.content.substring(0, 500);
  const searchQuery = `related implications trends "${article.title}" adjacent perspective unexplored`;

  const res = await tavily.fetch!("/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${tavily.secret}`,
    },
    body: JSON.stringify({
      query: searchQuery,
      search_depth: "advanced",
      max_results: 10,
      include_answer: false,
      include_raw_content: false,
      context: thesis,
    }),
  });

  if (!res.ok) {
    ctx.log.error(`Tavily API error: ${res.status} ${await res.text()}`);
    return { sources: [], searchType: "adjacent" };
  }

  const data = await res.json();
  const results = data.results ?? [];

  const sources: ResearchSource[] = results.map((r: Record<string, unknown>) => ({
    title: (r.title as string) ?? "Untitled",
    url: (r.url as string) ?? "",
    snippet: (r.content as string)?.substring(0, 500) ?? "",
    relevance: "adjacent",
  }));

  ctx.log.info(`Found ${sources.length} adjacent sources`);
  return { sources, searchType: "adjacent" };
}
