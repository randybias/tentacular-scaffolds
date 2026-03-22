import type { Context } from "tentacular";
import type { PollResult } from "./poll-sheet.ts";

export interface WebsiteData {
  company: string;
  summary: string;
  targetMarket: string;
  recentActivity: string;
}

export interface WebsiteEnrichmentOutput {
  enrichments: WebsiteData[];
}

/** Anthropic Messages API response (minimal subset) */
interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
}

/** Fetch each lead's company homepage and use LLM to summarize */
export default async function run(ctx: Context, input: unknown): Promise<WebsiteEnrichmentOutput> {
  const { leads } = input as PollResult;

  if (leads.length === 0) {
    ctx.log.info("No leads to enrich");
    return { enrichments: [] };
  }

  ctx.log.info(`Enriching website data for ${leads.length} leads`);

  const probeTargets = ctx.dependency("probe-targets");
  const anthropic = ctx.dependency("anthropic");
  const enrichments: WebsiteData[] = [];

  for (const lead of leads) {
    const domain = lead.email.includes("@")
      ? lead.email.split("@")[1]
      : lead.company.toLowerCase().replace(/\s+/g, "") + ".com";

    const homepageUrl = `https://${domain}`;

    // Fetch homepage
    let pageText = "";
    try {
      const res = await probeTargets.fetch!(homepageUrl);
      if (res.ok) {
        const html = await res.text();
        pageText = stripHtml(html).substring(0, 5000);
      } else {
        ctx.log.warn(`Failed to fetch ${homepageUrl}: ${res.status}`);
      }
    } catch (err) {
      ctx.log.warn(`Error fetching ${homepageUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!pageText || !anthropic.secret) {
      enrichments.push({
        company: lead.company,
        summary: pageText ? "Website fetched but no LLM available" : "Website unavailable",
        targetMarket: "unknown",
        recentActivity: "unknown",
      });
      continue;
    }

    // Summarize with LLM
    const prompt = `Analyze this company homepage text and respond ONLY with JSON:

Homepage text from ${domain}:
${pageText}

{
  "summary": "2-3 sentence description of what this company does",
  "targetMarket": "who they sell to (e.g., 'Enterprise SaaS buyers', 'SMB retail')",
  "recentActivity": "any recent news, product launches, or announcements visible on the page"
}`;

    try {
      const aiRes = await anthropic.fetch!("/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropic.secret,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!aiRes.ok) {
        ctx.log.warn(`Anthropic API error for ${domain}: ${aiRes.status}`);
        enrichments.push({
          company: lead.company,
          summary: "LLM analysis failed",
          targetMarket: "unknown",
          recentActivity: "unknown",
        });
        continue;
      }

      const completionRaw = await aiRes.json() as Record<string, unknown>;
      const content = completionRaw["content"] as AnthropicResponse["content"] | undefined;
      const rawText = content?.find((b) => b.type === "text")?.text ?? "";

      const jsonStr = rawText.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
      const parsed = JSON.parse(jsonStr);

      enrichments.push({
        company: lead.company,
        summary: (parsed.summary as string) ?? "unknown",
        targetMarket: (parsed.targetMarket as string) ?? "unknown",
        recentActivity: (parsed.recentActivity as string) ?? "unknown",
      });
    } catch (err) {
      ctx.log.warn(`LLM analysis failed for ${domain}: ${err instanceof Error ? err.message : String(err)}`);
      enrichments.push({
        company: lead.company,
        summary: "Analysis error",
        targetMarket: "unknown",
        recentActivity: "unknown",
      });
    }
  }

  ctx.log.info(`Enriched ${enrichments.length} company websites`);
  return { enrichments };
}

/** Strip HTML tags and normalize whitespace */
function stripHtml(html: string): string {
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<\/?(p|div|br|h[1-6]|li|tr)[^>]*>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n/g, "\n\n");
  return text.trim();
}
