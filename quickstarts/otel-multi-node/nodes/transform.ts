import type { Context } from "tentacular";

interface Input {
  data: Record<string, unknown>;
  fetchedAt: string;
}

interface Output {
  summary: string;
  keyCount: number;
  transformedAt: string;
}

export default async function run(ctx: Context, input: Input): Promise<Output> {
  ctx.log.info("otel-multi-node transform: processing fetched data");

  const keyCount = Object.keys(input.data).length;
  const summary = `Fetched at ${input.fetchedAt}: ${keyCount} top-level keys`;

  ctx.log.info(`otel-multi-node transform: produced summary with ${keyCount} keys`);

  return {
    summary,
    keyCount,
    transformedAt: new Date().toISOString(),
  };
}
