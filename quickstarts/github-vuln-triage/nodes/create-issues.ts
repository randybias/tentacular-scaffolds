import type { Context } from "tentacular";
import type { TriageOutput, TriagedAlert } from "./triage.ts";

export interface CreatedIssue {
  repo: string;
  issueNumber: number;
  issueUrl: string;
  alertId: number;
  severity: string;
}

export interface CreateIssuesOutput {
  createdIssues: CreatedIssue[];
  triageOutput: TriageOutput;
}

/** Create GitHub Issues for critical_action alerts with severity labels and remediation steps */
export default async function run(ctx: Context, input: unknown): Promise<CreateIssuesOutput> {
  const triage = input as TriageOutput;

  if (triage.criticalAction.length === 0) {
    ctx.log.info("No critical alerts requiring issue creation");
    return { createdIssues: [], triageOutput: triage };
  }

  const github = ctx.dependency("github");
  const org = triage.org;
  const createdIssues: CreatedIssue[] = [];

  ctx.log.info(`Creating issues for ${triage.criticalAction.length} critical alerts`);

  for (const alert of triage.criticalAction) {
    const title = `[${alert.severity.toUpperCase()}] ${alert.source === "dependabot" ? "Dependency" : "Code"} vulnerability: ${alert.identifier}`;

    const body = buildIssueBody(alert, org);

    const labels = [
      "security",
      `severity:${alert.severity}`,
      alert.source === "dependabot" ? "dependency" : "code-quality",
    ];

    try {
      const res = await github.fetch!(`/repos/${org}/${alert.repo}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body,
          labels,
        }),
      });

      if (!res.ok) {
        ctx.log.warn(`Failed to create issue for ${alert.repo}#${alert.alertId}: ${res.status}`);
        continue;
      }

      const issue = await res.json();
      createdIssues.push({
        repo: alert.repo,
        issueNumber: issue.number,
        issueUrl: issue.html_url,
        alertId: alert.alertId,
        severity: alert.severity,
      });

      ctx.log.info(`Created issue ${issue.html_url} for ${alert.identifier} in ${alert.repo}`);
    } catch (err) {
      ctx.log.warn(`Error creating issue for ${alert.repo}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  ctx.log.info(`Created ${createdIssues.length}/${triage.criticalAction.length} issues`);
  return { createdIssues, triageOutput: triage };
}

function buildIssueBody(alert: TriagedAlert, org: string): string {
  return `## Security Alert

| Field | Value |
|-------|-------|
| **Source** | ${alert.source} |
| **Severity** | ${alert.severity.toUpperCase()} |
| **CVSS** | ${alert.cvss} |
| **Package/Rule** | \`${alert.identifier}\` |
| **Alert** | [View on GitHub](${alert.htmlUrl}) |
| **Team** | ${alert.repoContext.team} |
| **Environment** | ${alert.repoContext.environment} |
| **Customer-facing** | ${alert.repoContext.customer_facing ? "Yes" : "No"} |

### Summary

${alert.summary}

### Triage Reason

${alert.triageReason}

### Suggested Remediation

${alert.suggestedRemediation}

---
*Auto-created by Tentacular GitHub Vulnerability Triage*`;
}
