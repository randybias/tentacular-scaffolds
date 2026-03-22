import type { Context } from "tentacular";

interface NormalizedAlert {
  service: string;
  metric: string;
  value: string;
  threshold: string;
  timestamp: string;
  source: string;
}

interface Deploy {
  sha: string;
  author: string;
  message: string;
  mergedAt: string;
}

interface DeploysResult {
  recentDeploys: Deploy[];
}

/** Query GitHub API for recent commits/merges to the service's repo (last 48 hours) */
export default async function run(ctx: Context, input: unknown): Promise<DeploysResult> {
  const alert = input as NormalizedAlert;
  const githubOrg = ctx.config.github_org as string ?? "";
  const serviceRepos = ctx.config.service_repos as Record<string, string> ?? {};
  const repoName = serviceRepos[alert.service];

  // Access dependency early for contract drift detection
  const github = ctx.dependency("github");

  if (!repoName) {
    ctx.log.warn(`No repo configured for service: ${alert.service}`);
    return { recentDeploys: [] };
  }
  if (!github.secret) {
    ctx.log.warn("No github.token in secrets");
    return { recentDeploys: [] };
  }

  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  ctx.log.info(`Querying recent deploys for ${githubOrg}/${repoName} since ${since}`);

  try {
    // Fetch recent commits on the default branch
    const commitsRes = await github.fetch!(
      `/repos/${githubOrg}/${repoName}/commits?since=${since}&per_page=20`,
    );

    if (!commitsRes.ok) {
      ctx.log.warn(`GitHub commits API failed: ${commitsRes.status}`);
      return { recentDeploys: [] };
    }

    const commits = await commitsRes.json();
    const deploys: Deploy[] = [];

    for (const commit of commits) {
      deploys.push({
        sha: commit.sha?.substring(0, 12) ?? "",
        author: commit.commit?.author?.name ?? commit.author?.login ?? "unknown",
        message: commit.commit?.message?.split("\n")[0] ?? "",
        mergedAt: commit.commit?.committer?.date ?? "",
      });
    }

    ctx.log.info(`Found ${deploys.length} recent commits for ${repoName}`);
    return { recentDeploys: deploys };
  } catch (err) {
    ctx.log.error(`Failed to query deploys: ${err instanceof Error ? err.message : String(err)}`);
    return { recentDeploys: [] };
  }
}
