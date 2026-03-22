import type { Context } from "tentacular";
import { connect } from "https://deno.land/x/nats@v1.28.2/src/mod.ts";

interface IncidentBrief {
  severity: string;
  brief: string;
  suggestedActions: string[];
  relatedDeploy: string;
  service: string;
  metric: string;
  timestamp: string;
}

interface PublishResult {
  published: boolean;
  subject: string;
}

/** Publish structured incident event to NATS for downstream consumers */
export default async function run(ctx: Context, input: unknown): Promise<PublishResult> {
  const brief = input as IncidentBrief;

  const nats = ctx.dependency("tentacular-nats");
  if (!nats.secret) {
    ctx.log.warn("No NATS token, skipping event publish");
    return { published: false, subject: "" };
  }

  const subject = `tentacular.incidents.${brief.severity.toLowerCase()}.${brief.service}`;

  try {
    const nc = await connect({
      servers: `${nats.host}:${nats.port}`,
      token: nats.secret,
    });

    const event = JSON.stringify({
      type: "incident.created",
      severity: brief.severity,
      service: brief.service,
      metric: brief.metric,
      brief: brief.brief,
      suggestedActions: brief.suggestedActions,
      relatedDeploy: brief.relatedDeploy,
      timestamp: brief.timestamp,
      publishedAt: new Date().toISOString(),
    });

    nc.publish(subject, new TextEncoder().encode(event));
    await nc.flush();
    await nc.close();

    ctx.log.info(`Published incident event to NATS subject: ${subject}`);
    return { published: true, subject };
  } catch (err) {
    ctx.log.error(`Failed to publish NATS event: ${err instanceof Error ? err.message : String(err)}`);
    return { published: false, subject };
  }
}
