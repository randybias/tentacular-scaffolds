import type { Context } from "tentacular";

interface ChangedSource {
  type: string;
  url: string;
  previousContent: string;
  currentContent: string;
  changeSizeBytes: number;
}

interface CompetitorChanges {
  competitor: string;
  changedSources: ChangedSource[];
}

interface DiffResult {
  competitorChanges: CompetitorChanges[];
  totalChanges: number;
  fetchedAt: string;
}

interface ChangeAssessment {
  source: string;
  whatChanged: string;
  significance: number;
  businessImplication: string;
}

interface CompetitorAssessment {
  competitor: string;
  changes: ChangeAssessment[];
  overallSignificance: number;
}

interface AnalyzeResult {
  assessments: CompetitorAssessment[];
  fetchedAt: string;
}

const ANALYSIS_PROMPT = `You are a competitive intelligence analyst. Analyze the changes detected on a competitor's web pages.

For each changed source, assess:
1. What specifically changed (pricing, features, messaging, team size, etc.)
2. A significance score from 1-10:
   - 1-3: Minor (typo fixes, cosmetic changes, routine blog posts)
   - 4-6: Notable (new blog posts about strategy, minor feature additions)
   - 7-10: Significant (pricing changes, major feature launches, pivots, layoffs)
3. Business implication for our company

Return a JSON object:
{
  "changes": [
    {
      "source": "<url>",
      "whatChanged": "<description>",
      "significance": <1-10>,
      "businessImplication": "<implication>"
    }
  ]
}

Respond with valid JSON only, no markdown fences.`;

function truncateContent(content: string, maxLen: number): string {
  if (content.length <= maxLen) return content;
  return content.substring(0, maxLen) + "... [truncated]";
}

function fallbackAssessment(competitor: string, sources: ChangedSource[]): CompetitorAssessment {
  const changes: ChangeAssessment[] = sources.map((s) => ({
    source: s.url,
    whatChanged: `Content changed (${s.changeSizeBytes} bytes delta)`,
    significance: 5,
    businessImplication: "Review manually -- LLM analysis unavailable",
  }));

  const overallSignificance = changes.length > 0
    ? Math.round(changes.reduce((sum, c) => sum + c.significance, 0) / changes.length)
    : 0;

  return { competitor, changes, overallSignificance };
}

/** Analyze competitor page changes using LLM and filter by significance */
export default async function run(ctx: Context, input: unknown): Promise<AnalyzeResult> {
  const data = input as DiffResult;

  if (data.competitorChanges.length === 0) {
    ctx.log.info("No changes to analyze");
    return { assessments: [], fetchedAt: data.fetchedAt };
  }

  const anthropic = ctx.dependency("anthropic");
  const assessments: CompetitorAssessment[] = [];

  for (const cc of data.competitorChanges) {
    if (!anthropic.secret) {
      ctx.log.warn(`No anthropic.api_key, using fallback for ${cc.competitor}`);
      assessments.push(fallbackAssessment(cc.competitor, cc.changedSources));
      continue;
    }

    ctx.log.info(`Analyzing ${cc.changedSources.length} change(s) for ${cc.competitor}`);

    const sourceSummaries = cc.changedSources.map((s) => ({
      url: s.url,
      type: s.type,
      changeSizeBytes: s.changeSizeBytes,
      previousContent: truncateContent(s.previousContent, 3000),
      currentContent: truncateContent(s.currentContent, 3000),
    }));

    try {
      const response = await anthropic.fetch!("/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropic.secret,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          system: ANALYSIS_PROMPT,
          messages: [{
            role: "user",
            content: `Competitor: ${cc.competitor}\n\nChanged sources:\n${JSON.stringify(sourceSummaries, null, 2)}`,
          }],
        }),
      });

      if (!response.ok) {
        ctx.log.warn(`Anthropic API returned ${response.status} for ${cc.competitor}, using fallback`);
        assessments.push(fallbackAssessment(cc.competitor, cc.changedSources));
        continue;
      }

      const result = await response.json();
      const text = result?.content?.[0]?.text;
      if (!text) {
        ctx.log.warn(`Empty LLM response for ${cc.competitor}`);
        assessments.push(fallbackAssessment(cc.competitor, cc.changedSources));
        continue;
      }

      const parsed = JSON.parse(text);
      const changes: ChangeAssessment[] = (parsed.changes ?? [])
        .filter((c: ChangeAssessment) => c.significance >= 5);

      const overallSignificance = changes.length > 0
        ? Math.round(changes.reduce((sum, c) => sum + c.significance, 0) / changes.length)
        : 0;

      assessments.push({
        competitor: cc.competitor,
        changes,
        overallSignificance,
      });

      ctx.log.info(`${cc.competitor}: ${changes.length} significant change(s), overall significance ${overallSignificance}`);
    } catch (err) {
      ctx.log.warn(`Analysis failed for ${cc.competitor}: ${err instanceof Error ? err.message : String(err)}`);
      assessments.push(fallbackAssessment(cc.competitor, cc.changedSources));
    }
  }

  return { assessments, fetchedAt: data.fetchedAt };
}
