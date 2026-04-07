import type { Context } from "tentacular";

interface Output {
  data: Record<string, unknown>;
  fetchedAt: string;
}

export default async function run(ctx: Context, _input: unknown): Promise<Output> {
  ctx.log.info("otel-multi-node fetch-data: fetching data from httpbin");

  const response = await fetch("https://httpbin.org/json");
  if (!response.ok) {
    throw new Error(`fetch-data: HTTP error ${response.status}`);
  }

  const data = await response.json() as Record<string, unknown>;
  ctx.log.info(`otel-multi-node fetch-data: received ${Object.keys(data).length} top-level keys`);

  return {
    data,
    fetchedAt: new Date().toISOString(),
  };
}
