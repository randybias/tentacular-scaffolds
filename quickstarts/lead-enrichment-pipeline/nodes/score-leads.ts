import type { Context } from "tentacular";
import type { PollResult, Lead } from "./poll-sheet.ts";
import type { CompanyEnrichmentOutput } from "./enrich-company.ts";
import type { PersonEnrichmentOutput } from "./enrich-person.ts";
import type { WebsiteEnrichmentOutput } from "./enrich-website.ts";

export interface ScoredLead {
  lead: Lead;
  score: number;
  explanation: string;
  icp_fit_details: string;
}

export interface ScoreOutput {
  scoredLeads: ScoredLead[];
}

/** Fan-in input: one key per parent node name */
interface ScoreInput {
  "poll-sheet": PollResult;
  "enrich-company": CompanyEnrichmentOutput;
  "enrich-person": PersonEnrichmentOutput;
  "enrich-website": WebsiteEnrichmentOutput;
}

/** Anthropic Messages API response (minimal subset) */
interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
}

/** Score each lead against ICP criteria using LLM */
export default async function run(ctx: Context, input: unknown): Promise<ScoreOutput> {
  const data = input as ScoreInput;
  const { leads } = data["poll-sheet"];
  const companies = data["enrich-company"].enrichments;
  const people = data["enrich-person"].enrichments;
  const websites = data["enrich-website"].enrichments;

  if (leads.length === 0) {
    ctx.log.info("No leads to score");
    return { scoredLeads: [] };
  }

  const icpCriteria = (ctx.config.icp_criteria as string) ?? "B2B SaaS, 50-500 employees, Series A-C, technical buyer";

  ctx.log.info(`Scoring ${leads.length} leads against ICP: "${icpCriteria}"`);

  const anthropic = ctx.dependency("anthropic");
  const scoredLeads: ScoredLead[] = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const company = companies[i];
    const person = people[i];
    const website = websites[i];

    if (!anthropic.secret) {
      scoredLeads.push({
        lead,
        score: 50,
        explanation: "No AI available -- default score",
        icp_fit_details: "Scoring requires Anthropic API key",
      });
      continue;
    }

    const prompt = `Score this sales lead against our Ideal Customer Profile (ICP). Respond ONLY with JSON.

## ICP Criteria
${icpCriteria}

## Lead Data
Name: ${lead.name}
Email: ${lead.email}
Company: ${lead.company}
Notes: ${lead.notes}

## Company Enrichment
Industry: ${company?.industry ?? "unknown"}
Size: ${company?.size ?? "unknown"}
Funding: ${company?.funding ?? "unknown"}
Tech Stack: ${company?.techStack?.join(", ") ?? "unknown"}
Domain: ${company?.domain ?? "unknown"}

## Person Enrichment
Title: ${person?.title ?? "unknown"}
Seniority: ${person?.seniority ?? "unknown"}
LinkedIn: ${person?.linkedin ?? "unknown"}

## Website Summary
${website?.summary ?? "unavailable"}
Target Market: ${website?.targetMarket ?? "unknown"}
Recent Activity: ${website?.recentActivity ?? "unknown"}

## Respond with:
{
  "score": <1-100>,
  "explanation": "2-3 sentence explanation of score",
  "icp_fit_details": "specific matches/mismatches against each ICP criterion"
}`;

    try {
      const res = await anthropic.fetch!("/v1/messages", {
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

      if (!res.ok) {
        ctx.log.warn(`Anthropic API error scoring ${lead.name}: ${res.status}`);
        scoredLeads.push({
          lead,
          score: 50,
          explanation: `Scoring failed: API error ${res.status}`,
          icp_fit_details: "N/A",
        });
        continue;
      }

      const completionRaw = await res.json() as Record<string, unknown>;
      const content = completionRaw["content"] as AnthropicResponse["content"] | undefined;
      const rawText = content?.find((b) => b.type === "text")?.text ?? "";

      const jsonStr = rawText.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
      const parsed = JSON.parse(jsonStr);

      scoredLeads.push({
        lead,
        score: Math.max(1, Math.min(100, Number(parsed.score) || 50)),
        explanation: (parsed.explanation as string) ?? "",
        icp_fit_details: (parsed.icp_fit_details as string) ?? "",
      });
    } catch (err) {
      ctx.log.warn(`Error scoring ${lead.name}: ${err instanceof Error ? err.message : String(err)}`);
      scoredLeads.push({
        lead,
        score: 50,
        explanation: "Scoring error",
        icp_fit_details: "N/A",
      });
    }
  }

  ctx.log.info(`Scored ${scoredLeads.length} leads — high: ${scoredLeads.filter((l) => l.score >= 70).length}, low: ${scoredLeads.filter((l) => l.score < 70).length}`);
  return { scoredLeads };
}
