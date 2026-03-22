import type { Context } from "tentacular";

interface IncidentBrief {
  severity: string;
  brief: string;
  suggestedActions: string[];
  relatedDeploy: string;
  service: string;
  metric: string;
  timestamp: string;
}

interface TicketResult {
  created: boolean;
  issueUrl: string;
  issueNumber: number;
}

/** Create a GitHub Issue in the service's repo with the incident brief */
export default async function run(ctx: Context, input: unknown): Promise<TicketResult> {
  const brief = input as IncidentBrief;
  const githubOrg = ctx.config.github_org as string ?? "";
  const serviceRepos = ctx.config.service_repos as Record<string, string> ?? {};
  const repoName = serviceRepos[brief.service];

  if (!repoName) {
    ctx.log.warn(`No repo configured for service: ${brief.service}, skipping ticket creation`);
    return { created: false, issueUrl: "", issueNumber: 0 };
  }

  const github = ctx.dependency("github");
  if (!github.secret) {
    ctx.log.warn("No github.token in secrets");
    return { created: false, issueUrl: "", issueNumber: 0 };
  }

  const title = `[${brief.severity}] ${brief.service}: ${brief.metric} alert`;
  const body = [
    `## Incident Brief`,
    ``,
    `**Severity:** ${brief.severity}`,
    `**Service:** ${brief.service}`,
    `**Metric:** ${brief.metric}`,
    `**Timestamp:** ${brief.timestamp}`,
    ``,
    brief.brief,
    ``,
    `## Suggested Actions`,
    ``,
    ...brief.suggestedActions.map((a) => `- [ ] ${a}`),
    ``,
    brief.relatedDeploy ? `## Possibly Related Deploy\n\n\`${brief.relatedDeploy}\`` : "",
    ``,
    `---`,
    `*Created by Tentacular Incident Response Orchestrator*`,
  ].join("\n");

  const labels = [brief.severity.toLowerCase(), "incident"];

  ctx.log.info(`Creating GitHub issue in ${githubOrg}/${repoName}: ${title}`);

  try {
    const res = await github.fetch!(`/repos/${githubOrg}/${repoName}/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, labels }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      ctx.log.error(`GitHub issue creation failed: ${res.status} ${errBody}`);
      return { created: false, issueUrl: "", issueNumber: 0 };
    }

    const issue = await res.json();
    ctx.log.info(`Created issue #${issue.number}: ${issue.html_url}`);
    return {
      created: true,
      issueUrl: issue.html_url ?? "",
      issueNumber: issue.number ?? 0,
    };
  } catch (err) {
    ctx.log.error(`Failed to create ticket: ${err instanceof Error ? err.message : String(err)}`);
    return { created: false, issueUrl: "", issueNumber: 0 };
  }
}
