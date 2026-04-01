import type { Context } from "tentacular";
import type { ConvertDocumentOutput } from "./convert-document.ts";

/** Anthropic Messages API response (minimal subset) */
interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
}

/** Final output of the doc-converter workflow */
export interface SummarizeOutput {
  summary: string;
  model: string;
  from_format: string;
  to_format: string;
  source_url: string;
  converted_chars: number;
}

/**
 * Summarize the converted document output using Claude.
 *
 * Sends a truncated preview of the converted content to the Anthropic Messages API
 * and asks for a brief summary. Includes a mock fallback when no API key is available,
 * so the scaffold works in test and demo contexts without credentials.
 */
export default async function run(
  ctx: Context,
  input: unknown,
): Promise<SummarizeOutput> {
  const data = input as ConvertDocumentOutput;
  const cfg = ctx.config as Record<string, unknown>;
  const maxChars = Number(cfg["max_summary_chars"] ?? 2000);

  const preview = data.converted.slice(0, maxChars);
  const truncated = data.converted.length > maxChars;

  ctx.log.info(
    `Summarizing ${data.to_format} output (${data.converted.length} chars, ` +
    `sending first ${preview.length})`,
  );

  const prompt =
    `The following is a ${data.to_format} document converted from ${data.from_format}.\n` +
    `Source: ${data.source_url}\n\n` +
    `Please provide a concise 2-3 sentence summary of what this document contains.\n\n` +
    `---\n\n${preview}` +
    (truncated ? `\n\n[... document truncated at ${maxChars} chars ...]` : "");

  // --- Call Anthropic Messages API ---
  const anthropic = ctx.dependency("anthropic");

  if (!anthropic.secret) {
    ctx.log.warn("No Anthropic API key configured — returning mock summary");
    return mockSummary(data);
  }

  const res = await anthropic.fetch!("/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropic.secret,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    // If the API key is missing/invalid, fall back to mock summary
    if (res.status === 401 || res.status === 403) {
      ctx.log.warn("Anthropic API auth failed — returning mock summary");
      return mockSummary(data);
    }
    throw new Error(`Anthropic API error: ${res.status} — ${errText.slice(0, 300)}`);
  }

  const completionRaw = await res.json() as Record<string, unknown>;
  const content = completionRaw["content"] as AnthropicResponse["content"] | undefined;
  const rawText = content?.find((b) => b.type === "text")?.text?.trim() ?? "";

  if (!rawText) {
    ctx.log.warn("Empty AI response — returning mock summary");
    return mockSummary(data);
  }

  ctx.log.info(`Summary complete (${rawText.length} chars)`);

  return {
    summary: rawText,
    model: "claude-haiku-4-5-20251001",
    from_format: data.from_format,
    to_format: data.to_format,
    source_url: data.source_url,
    converted_chars: data.char_count,
  };
}

function mockSummary(data: ConvertDocumentOutput): SummarizeOutput {
  return {
    summary:
      `Mock summary: converted ${data.char_count} chars from ${data.from_format} to ` +
      `${data.to_format}. Source: ${data.source_url}`,
    model: "mock",
    from_format: data.from_format,
    to_format: data.to_format,
    source_url: data.source_url,
    converted_chars: data.char_count,
  };
}
