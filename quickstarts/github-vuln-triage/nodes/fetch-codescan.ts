import type { Context } from "tentacular";

export interface CodeScanAlert {
  repo: string;
  alertId: number;
  severity: string;
  rule: string;
  tool: string;
  state: string;
  createdAt: string;
  htmlUrl: string;
  summary: string;
}

export interface CodeScanOutput {
  alerts: CodeScanAlert[];
  fetchedAt: string;
  org: string;
}

interface GHCodeScanAlert {
  number: number;
  state: string;
  rule: {
    id: string;
    severity: string;
    description: string;
  };
  tool: {
    name: string;
  };
  html_url: string;
  created_at: string;
}

/** Fetch Code Scanning (CodeQL) alerts across all repos in the org */
export default async function run(ctx: Context, _input: unknown): Promise<CodeScanOutput> {
  const github = ctx.dependency("github");
  const org = ctx.config.github_org as string;

  if (!org) {
    ctx.log.warn("No github_org configured -- returning empty (test mode)");
    return { alerts: [], fetchedAt: "", org: "" };
  }

  ctx.log.info(`Fetching Code Scanning alerts for org: ${org}`);

  // Get all org repos
  const repoNames: string[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const res = await github.fetch!(`/orgs/${org}/repos?per_page=100&page=${page}`);
    if (!res.ok) {
      ctx.log.error(`Failed to fetch org repos: ${res.status}`);
      break;
    }
    const repos: { name: string }[] = await res.json();
    if (repos.length === 0) {
      hasMore = false;
    } else {
      repoNames.push(...repos.map((r) => r.name));
      page++;
      if (repos.length < 100) hasMore = false;
    }
  }

  ctx.log.info(`Scanning ${repoNames.length} repos for Code Scanning alerts`);

  const alerts: CodeScanAlert[] = [];

  for (const repoName of repoNames) {
    let repoPage = 1;
    let repoHasMore = true;

    while (repoHasMore) {
      const res = await github.fetch!(
        `/repos/${org}/${repoName}/code-scanning/alerts?state=open&per_page=100&page=${repoPage}`,
      );

      if (res.status === 404 || res.status === 403) {
        ctx.log.info(`Code scanning not enabled for ${org}/${repoName}, skipping`);
        break;
      }

      if (!res.ok) {
        ctx.log.error(`Failed to fetch code scanning alerts for ${org}/${repoName}: ${res.status}`);
        break;
      }

      const items: GHCodeScanAlert[] = await res.json();
      if (items.length === 0) {
        repoHasMore = false;
      } else {
        for (const item of items) {
          alerts.push({
            repo: repoName,
            alertId: item.number,
            severity: item.rule?.severity ?? "unknown",
            rule: item.rule?.id ?? "unknown",
            tool: item.tool?.name ?? "unknown",
            state: item.state,
            createdAt: item.created_at,
            htmlUrl: item.html_url,
            summary: item.rule?.description ?? "",
          });
        }
        repoPage++;
        if (items.length < 100) repoHasMore = false;
      }
    }
  }

  ctx.log.info(`Fetched ${alerts.length} open code scanning alerts across ${repoNames.length} repos`);
  return { alerts, fetchedAt: new Date().toISOString(), org };
}
