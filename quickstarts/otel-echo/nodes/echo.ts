import type { Context } from "tentacular";

interface Input {
  message?: string;
}

interface Output {
  echoed: string;
  timestamp: string;
}

export default async function run(ctx: Context, input: Input): Promise<Output> {
  const message = input.message ?? "hello from otel-echo";
  ctx.log.info(`otel-echo: received message: ${message}`);

  const output: Output = {
    echoed: message,
    timestamp: new Date().toISOString(),
  };

  ctx.log.info(`otel-echo: echoing back: ${output.echoed}`);
  return output;
}
