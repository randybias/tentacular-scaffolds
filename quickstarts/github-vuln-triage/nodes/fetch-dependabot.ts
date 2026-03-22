import type { Context } from "tentacular";

export interface DependabotAlert {
  repo: string;
  alertId: number;
  severity: string;
  cvss: number;
  epss: number;
  package: string;
  ecosystem: string;
  state: string;
  createdAt: string;
  htmlUrl: string;
  summary: string;
}

export interface DependabotOutput {
  alerts: DependabotAlert[];
  fetchedAt: string;
  org: string;
}

interface GHDependabotAlert {
  number: number;
  state: string;
  security_advisory: {
    summary: string;
    severity: string;
    cvss: { score: number };
  };
  security_vulnerability: {
    package: { name: string; ecosystem: string };
    severity: string;
  };
  html_url: string;
  created_at: string;
}

/** Fetch Dependabot alerts across all repos in a GitHub org */
export default async function run(ctx: Context, _input: unknown): Promise<DependabotOutput> {
  const github = ctx.dependency("github");
  const org = ctx.config.github_org as string;

  if (!org) {
    ctx.log.warn("No github_org configured -- returning empty (test mode)");
    return { alerts: [], fetchedAt: "", org: "" };
  }

  ctx.log.info(`Fetching Dependabot alerts for org: ${org}`);

  // Get all org repos
  const repoNames: string[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const res = await github.fetch!(`/orgs/${org}/repos?per_page=100&page=${page}`);
    if (!res.ok) {
      ctx.log.error(`Failed to fetch org repos: ${res.status} ${res.statusText}`);
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

  ctx.log.info(`Scanning ${repoNames.length} repos for Dependabot alerts`);

  const alerts: DependabotAlert[] = [];

  for (const repoName of repoNames) {
    let repoPage = 1;
    let repoHasMore = true;

    while (repoHasMore) {
      const res = await github.fetch!(
        `/repos/${org}/${repoName}/dependabot/alerts?state=open&per_page=100&page=${repoPage}`,
      );

      if (res.status === 404 || res.status === 403) {
        ctx.log.info(`Dependabot not enabled for ${org}/${repoName}, skipping`);
        break;
      }

      if (!res.ok) {
        ctx.log.error(`Failed to fetch Dependabot alerts for ${org}/${repoName}: ${res.status}`);
        break;
      }

      const items: GHDependabotAlert[] = await res.json();
      if (items.length === 0) {
        repoHasMore = false;
      } else {
        for (const item of items) {
          alerts.push({
            repo: repoName,
            alertId: item.number,
            severity: item.security_advisory?.severity ?? item.security_vulnerability?.severity ?? "unknown",
            cvss: item.security_advisory?.cvss?.score ?? 0,
            epss: 0,
            package: item.security_vulnerability?.package?.name ?? "unknown",
            ecosystem: item.security_vulnerability?.package?.ecosystem ?? "unknown",
            state: item.state,
            createdAt: item.created_at,
            htmlUrl: item.html_url,
            summary: item.security_advisory?.summary ?? "",
          });
        }
        repoPage++;
        if (items.length < 100) repoHasMore = false;
      }
    }
  }

  ctx.log.info(`Fetched ${alerts.length} open Dependabot alerts across ${repoNames.length} repos`);
  return { alerts, fetchedAt: new Date().toISOString(), org };
}
