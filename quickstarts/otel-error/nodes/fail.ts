import type { Context } from "tentacular";

export default async function run(ctx: Context, _input: unknown): Promise<never> {
  ctx.log.info("otel-error: about to throw deliberate error for OTel validation");
  throw new Error("deliberate error: validating OTel error span production");
}
