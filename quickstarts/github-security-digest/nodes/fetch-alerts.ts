import type { Context } from "tentacular";

interface Alert {
  alertId: number;
  repo: string;
  severity: string;
  package: string;
  ecosystem: string;
  cvss: number;
  epss: number;
  summary: string;
  createdAt: string;
  htmlUrl: string;
}

interface FetchAlertsOutput {
  alerts: Alert[];
  fetchedAt: string;
  org: string;
}

interface DependabotAlert {
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

/** Fetch Dependabot alerts from configured GitHub repos via API */
export default async function run(ctx: Context, _input: unknown): Promise<FetchAlertsOutput> {
  const github = ctx.dependency("github");
  const org = ctx.config.github_org as string;
  const configuredRepos = ctx.config.repos as string[];

  if (!github.secret) {
    ctx.log.warn("No GitHub credentials available, returning empty alerts");
    return { alerts: [], fetchedAt: "", org: org ?? "" };
  }

  ctx.log.info(`Fetching security alerts for org: ${org}`);

  let repoNames: string[] = configuredRepos ?? [];

  // If no repos configured, fetch all org repos
  if (repoNames.length === 0) {
    ctx.log.info("No repos configured, fetching all org repos");
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const res = await github.fetch!(`/orgs/${org}/repos?per_page=100&page=${page}`);
      if (!res.ok) {
        ctx.log.error(`Failed to fetch org repos: ${res.status} ${res.statusText}`);
        break;
      }
      const repos = await res.json();
      if (!Array.isArray(repos) || repos.length === 0) {
        hasMore = false;
      } else {
        repoNames.push(...repos.map((r: { name: string }) => r.name));
        page++;
      }
    }
    ctx.log.info(`Found ${repoNames.length} repos in org ${org}`);
  }

  const alerts: Alert[] = [];

  for (const repoName of repoNames) {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const res = await github.fetch!(
        `/repos/${org}/${repoName}/dependabot/alerts?state=open&per_page=100&page=${page}`,
      );

      if (res.status === 404 || res.status === 403) {
        ctx.log.info(`Dependabot not enabled or no access for ${org}/${repoName}, skipping`);
        break;
      }

      if (!res.ok) {
        ctx.log.error(`Failed to fetch alerts for ${org}/${repoName}: ${res.status}`);
        break;
      }

      const items: DependabotAlert[] = await res.json();
      if (items.length === 0) {
        hasMore = false;
      } else {
        for (const item of items) {
          alerts.push({
            alertId: item.number,
            repo: `${org}/${repoName}`,
            severity: item.security_advisory?.severity ?? item.security_vulnerability?.severity ?? "unknown",
            package: item.security_vulnerability?.package?.name ?? "unknown",
            ecosystem: item.security_vulnerability?.package?.ecosystem ?? "unknown",
            cvss: item.security_advisory?.cvss?.score ?? 0,
            epss: 0, // EPSS not available via Dependabot API; enriched externally if needed
            summary: item.security_advisory?.summary ?? "",
            createdAt: item.created_at,
            htmlUrl: item.html_url,
          });
        }
        page++;
        if (items.length < 100) hasMore = false;
      }
    }
  }

  ctx.log.info(`Fetched ${alerts.length} open Dependabot alerts across ${repoNames.length} repos`);
  return { alerts, fetchedAt: new Date().toISOString(), org };
}
