import type { Context } from "tentacular";

interface Input {
  summary: string;
  keyCount: number;
  transformedAt: string;
}

interface Output {
  notified: boolean;
  message: string;
}

export default async function run(ctx: Context, input: Input): Promise<Output> {
  ctx.log.info(`otel-multi-node notify: summary="${input.summary}"`);

  // Log pipeline completion for OTel trace correlation validation
  ctx.log.info(`otel-multi-node notify: pipeline complete, keyCount=${input.keyCount}, transformedAt=${input.transformedAt}`);

  return {
    notified: true,
    message: input.summary,
  };
}
