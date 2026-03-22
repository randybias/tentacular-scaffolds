import type { Context } from "tentacular";

interface SurveyMetrics {
  accountId: string;
  latestNPS: number;
  latestCSAT: number;
  surveyDate: string;
  trend: "improving" | "declining" | "stable";
}

interface SurveysResult {
  accounts: SurveyMetrics[];
}

/** Query for latest NPS/CSAT scores per customer */
export default async function run(ctx: Context, _input: unknown): Promise<SurveysResult> {
  const accountIds = ctx.config.accounts as string[];

  const survey = ctx.dependency("survey-api");
  if (!survey.secret) {
    ctx.log.error("No survey.api_key in secrets");
    return { accounts: [] };
  }

  ctx.log.info("Fetching survey/NPS scores");

  try {
    let targetAccounts = accountIds;
    if (targetAccounts.length === 1 && targetAccounts[0] === "all") {
      const listRes = await survey.fetch!("/v1/respondents?limit=500");
      if (!listRes.ok) {
        ctx.log.error(`Survey respondents list failed: ${listRes.status}`);
        return { accounts: [] };
      }
      const listData = await listRes.json();
      targetAccounts = (listData.respondents ?? []).map((r: { account_id: string }) => r.account_id);
    }

    const accounts: SurveyMetrics[] = [];

    for (const accountId of targetAccounts) {
      try {
        const res = await survey.fetch!(`/v1/accounts/${accountId}/scores?latest=true`);
        if (!res.ok) {
          ctx.log.warn(`Survey fetch failed for ${accountId}: ${res.status}`);
          continue;
        }

        const data = await res.json();

        // Determine trend from historical NPS scores
        const currentNPS = data.nps ?? 0;
        const previousNPS = data.previous_nps ?? currentNPS;
        let trend: "improving" | "declining" | "stable" = "stable";
        if (currentNPS > previousNPS + 5) trend = "improving";
        else if (currentNPS < previousNPS - 5) trend = "declining";

        accounts.push({
          accountId,
          latestNPS: currentNPS,
          latestCSAT: data.csat ?? 0,
          surveyDate: data.survey_date ?? "",
          trend,
        });
      } catch (err) {
        ctx.log.warn(`Error fetching surveys for ${accountId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    ctx.log.info(`Fetched survey scores for ${accounts.length} account(s)`);
    return { accounts };
  } catch (err) {
    ctx.log.error(`Failed to fetch survey data: ${err instanceof Error ? err.message : String(err)}`);
    return { accounts: [] };
  }
}
