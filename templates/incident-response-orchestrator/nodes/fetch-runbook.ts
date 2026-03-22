import type { Context } from "tentacular";

interface NormalizedAlert {
  service: string;
  metric: string;
  value: string;
  threshold: string;
  timestamp: string;
  source: string;
}

interface RunbookResult {
  runbookContent: string;
  found: boolean;
}

/** Fetch the service's runbook from RustFS (stored as markdown at runbooks/{service}.md) */
export default async function run(ctx: Context, input: unknown): Promise<RunbookResult> {
  const alert = input as NormalizedAlert;
  const service = alert.service;

  const rustfs = ctx.dependency("rustfs");
  if (!rustfs.secret) {
    ctx.log.warn("No RustFS credentials, skipping runbook fetch");
    return { runbookContent: "", found: false };
  }

  const key = `/tentacular/runbooks/${service}.md`;
  ctx.log.info(`Fetching runbook from RustFS: ${key}`);

  try {
    const res = await rustfs.fetch!(key, { method: "GET" });

    if (res.status === 404 || res.status === 403) {
      ctx.log.info(`No runbook found for service: ${service}`);
      return { runbookContent: "", found: false };
    }

    if (!res.ok) {
      ctx.log.warn(`RustFS GET ${key} returned ${res.status}`);
      return { runbookContent: "", found: false };
    }

    const content = await res.text();
    ctx.log.info(`Fetched runbook for ${service}: ${content.length} chars`);
    return { runbookContent: content, found: true };
  } catch (err) {
    ctx.log.warn(`Failed to fetch runbook: ${err instanceof Error ? err.message : String(err)}`);
    return { runbookContent: "", found: false };
  }
}
