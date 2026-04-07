import type { Context } from "tentacular";

interface Input {
  prompt?: string;
}

interface Output {
  response: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5";

export default async function run(ctx: Context, input: Input): Promise<Output> {
  const prompt = input.prompt ?? "Reply with one word: hello";
  ctx.log.info(`otel-llm-echo: sending prompt to ${MODEL}`);

  const apiKey = await ctx.secrets.get("anthropic.api_key");

  const requestBody = {
    model: MODEL,
    max_tokens: 10,
    messages: [
      { role: "user", content: prompt },
    ],
  };

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text?: string }>;
    model: string;
    usage: { input_tokens: number; output_tokens: number };
  };

  const text = data.content.find((c) => c.type === "text")?.text ?? "";
  ctx.log.info(`otel-llm-echo: received response, input_tokens=${data.usage.input_tokens} output_tokens=${data.usage.output_tokens}`);

  return {
    response: text,
    model: data.model,
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
  };
}
