import type { Context } from "tentacular";
import type { PollResult } from "./poll-sheet.ts";

export interface CompanyData {
  company: string;
  domain: string;
  industry: string;
  size: string;
  funding: string;
  techStack: string[];
}

export interface CompanyEnrichmentOutput {
  enrichments: CompanyData[];
}

/** Enrich each lead with company data from an enrichment API */
export default async function run(ctx: Context, input: unknown): Promise<CompanyEnrichmentOutput> {
  const { leads } = input as PollResult;

  if (leads.length === 0) {
    ctx.log.info("No leads to enrich");
    return { enrichments: [] };
  }

  ctx.log.info(`Enriching company data for ${leads.length} leads`);

  const enrichApi = ctx.dependency("enrichment-api");
  const enrichments: CompanyData[] = [];

  for (const lead of leads) {
    // Extract domain from email
    const domain = lead.email.includes("@")
      ? lead.email.split("@")[1]
      : lead.company.toLowerCase().replace(/\s+/g, "") + ".com";

    if (!enrichApi.secret) {
      // No API key -- return placeholder
      enrichments.push({
        company: lead.company,
        domain,
        industry: "unknown",
        size: "unknown",
        funding: "unknown",
        techStack: [],
      });
      continue;
    }

    try {
      const res = await enrichApi.fetch!(`/v1/company/enrich?domain=${encodeURIComponent(domain)}`, {
        headers: {
          "Authorization": `Bearer ${enrichApi.secret}`,
        },
      });

      if (!res.ok) {
        ctx.log.warn(`Company enrichment failed for ${domain}: ${res.status}`);
        enrichments.push({
          company: lead.company,
          domain,
          industry: "unknown",
          size: "unknown",
          funding: "unknown",
          techStack: [],
        });
        continue;
      }

      const data = await res.json();
      enrichments.push({
        company: (data.name as string) ?? lead.company,
        domain,
        industry: (data.industry as string) ?? "unknown",
        size: (data.employee_count as string) ?? "unknown",
        funding: (data.funding_stage as string) ?? "unknown",
        techStack: (data.tech_stack as string[]) ?? [],
      });
    } catch (err) {
      ctx.log.warn(`Error enriching ${domain}: ${err instanceof Error ? err.message : String(err)}`);
      enrichments.push({
        company: lead.company,
        domain,
        industry: "unknown",
        size: "unknown",
        funding: "unknown",
        techStack: [],
      });
    }
  }

  ctx.log.info(`Enriched ${enrichments.length} companies`);
  return { enrichments };
}
