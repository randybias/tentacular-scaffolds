import type { Context } from "tentacular";

interface ChangedPage {
  url: string;
  previousContent: string;
  currentContent: string;
  diff: string;
  changedAt: string;
}

interface DiffResult {
  changedPages: ChangedPage[];
  unchangedCount: number;
}

interface ChangeSummary {
  url: string;
  summary: string;
  changedAt: string;
}

interface SummarizeOutput {
  summaries: ChangeSummary[];
  totalChanged: number;
}

/** Use LLM to summarize what changed in each page in business terms */
export default async function run(ctx: Context, input: unknown): Promise<SummarizeOutput> {
  const data = input as DiffResult;

  if (data.changedPages.length === 0) {
    ctx.log.info("No changed pages to summarize");
    return { summaries: [], totalChanged: 0 };
  }

  const anthropic = ctx.dependency("anthropic");
  const summaries: ChangeSummary[] = [];

  for (const page of data.changedPages) {
    // Truncate diff for LLM context
    const truncatedDiff = page.diff.length > 3000 ? page.diff.substring(0, 3000) + "\n...(truncated)" : page.diff;

    if (!anthropic.secret) {
      ctx.log.warn("No Anthropic API key, using raw diff as summary");
      summaries.push({
        url: page.url,
        summary: truncatedDiff,
        changedAt: page.changedAt,
      });
      continue;
    }

    const prompt = `You are monitoring a web page for meaningful changes. Analyze the following diff and summarize what changed in plain business language.

Ignore boilerplate changes like:
- Navigation menu updates
- Footer text changes
- Date/time stamps updating
- Cookie banners or ad content

Focus on substantive content changes: new announcements, pricing changes, policy updates, feature additions, etc.

If the changes are only boilerplate, respond with "No meaningful changes detected."

URL: ${page.url}

Diff (- = removed, + = added):
${truncatedDiff}

Provide a brief 1-3 sentence summary.`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropic.secret,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 512,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!res.ok) {
        ctx.log.error(`Anthropic API error for ${page.url}: ${res.status}`);
        summaries.push({ url: page.url, summary: truncatedDiff, changedAt: page.changedAt });
        continue;
      }

      const body = await res.json();
      const content = body.content?.[0];
      const summary = content?.type === "text" ? content.text : truncatedDiff;

      summaries.push({ url: page.url, summary, changedAt: page.changedAt });
      ctx.log.info(`Summarized changes for ${page.url}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.log.error(`LLM summarization failed for ${page.url}: ${message}`);
      summaries.push({ url: page.url, summary: truncatedDiff, changedAt: page.changedAt });
    }
  }

  ctx.log.info(`Summarized ${summaries.length} changed pages`);
  return { summaries, totalChanged: summaries.length };
}
