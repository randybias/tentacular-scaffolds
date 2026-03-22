import type { Context } from "tentacular";
import type { PollResult } from "./poll-sheet.ts";

export interface PersonData {
  name: string;
  title: string;
  seniority: string;
  linkedin: string;
  verified_email: boolean;
  phone: string;
}

export interface PersonEnrichmentOutput {
  enrichments: PersonData[];
}

/** Enrich each lead with person data from an enrichment API */
export default async function run(ctx: Context, input: unknown): Promise<PersonEnrichmentOutput> {
  const { leads } = input as PollResult;

  if (leads.length === 0) {
    ctx.log.info("No leads to enrich");
    return { enrichments: [] };
  }

  ctx.log.info(`Enriching person data for ${leads.length} leads`);

  const enrichApi = ctx.dependency("enrichment-api");
  const enrichments: PersonData[] = [];

  for (const lead of leads) {
    if (!enrichApi.secret) {
      enrichments.push({
        name: lead.name,
        title: "unknown",
        seniority: "unknown",
        linkedin: "",
        verified_email: false,
        phone: "",
      });
      continue;
    }

    try {
      const res = await enrichApi.fetch!(`/v1/person/enrich?email=${encodeURIComponent(lead.email)}`, {
        headers: {
          "Authorization": `Bearer ${enrichApi.secret}`,
        },
      });

      if (!res.ok) {
        ctx.log.warn(`Person enrichment failed for ${lead.email}: ${res.status}`);
        enrichments.push({
          name: lead.name,
          title: "unknown",
          seniority: "unknown",
          linkedin: "",
          verified_email: false,
          phone: "",
        });
        continue;
      }

      const data = await res.json();
      enrichments.push({
        name: (data.full_name as string) ?? lead.name,
        title: (data.title as string) ?? "unknown",
        seniority: (data.seniority as string) ?? "unknown",
        linkedin: (data.linkedin_url as string) ?? "",
        verified_email: (data.email_verified as boolean) ?? false,
        phone: (data.phone as string) ?? "",
      });
    } catch (err) {
      ctx.log.warn(`Error enriching ${lead.email}: ${err instanceof Error ? err.message : String(err)}`);
      enrichments.push({
        name: lead.name,
        title: "unknown",
        seniority: "unknown",
        linkedin: "",
        verified_email: false,
        phone: "",
      });
    }
  }

  ctx.log.info(`Enriched ${enrichments.length} people`);
  return { enrichments };
}
