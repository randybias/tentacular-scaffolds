import type { Context } from "tentacular";

interface NormalizedAlert {
  service: string;
  metric: string;
  value: string;
  threshold: string;
  timestamp: string;
  source: string;
}

/** Receive and normalize alert data from config (manual trigger) */
export default async function run(ctx: Context, _input: unknown): Promise<NormalizedAlert> {
  const service = ctx.config.alert_service as string ?? "";
  const metric = ctx.config.alert_metric as string ?? "";
  const value = ctx.config.alert_value as string ?? "";
  const threshold = ctx.config.alert_threshold as string ?? "";
  const timestamp = ctx.config.alert_timestamp as string || "";

  if (!service || !metric) {
    ctx.log.error("Missing required config: alert_service and alert_metric");
    return {
      service: service || "unknown",
      metric: metric || "unknown",
      value: value || "0",
      threshold: threshold || "0",
      timestamp,
      source: "manual",
    };
  }

  const alert: NormalizedAlert = {
    service,
    metric,
    value,
    threshold,
    timestamp: timestamp || new Date().toISOString(),
    source: "manual",
  };

  ctx.log.info(`Received alert: ${service} - ${metric} = ${value} (threshold: ${threshold})`);
  return alert;
}
