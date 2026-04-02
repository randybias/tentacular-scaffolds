import type { Context } from "tentacular";
import type { FetchDocumentOutput } from "./fetch-document.ts";

/** Output passed to summarize-output */
export interface ConvertDocumentOutput {
  converted: string;
  from_format: string;
  to_format: string;
  char_count: number;
  source_url: string;
}

/**
 * Convert document content using the pandoc sidecar (pandoc-server on localhost:3030).
 *
 * Calls the pandoc-server POST / endpoint with the raw document text and format parameters.
 * pandoc-server returns the converted content directly as the response body (not JSON).
 * No shared volume needed: content travels entirely as HTTP body in and out.
 */
export default async function run(
  ctx: Context,
  input: unknown,
): Promise<ConvertDocumentOutput> {
  const data = input as FetchDocumentOutput;
  const cfg = ctx.config as Record<string, unknown>;
  const toFormat = String(cfg["output_format"] ?? "html");
  const fromFormat = data.detected_format;

  ctx.log.info(
    `Converting ${data.content_length} chars from ${fromFormat} to ${toFormat} via pandoc sidecar`,
  );

  const reqBody = JSON.stringify({
    text: data.content,
    from: fromFormat,
    to: toFormat,
  });

  const res = await fetch("http://localhost:3030/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: reqBody,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `pandoc-server error: HTTP ${res.status} — ${errText.slice(0, 500)}`,
    );
  }

  // pandoc-server returns the converted content directly as the response body
  // (Content-Type: application/octet-stream), not as a JSON wrapper.
  const converted = await res.text();

  ctx.log.info(
    `Conversion complete: ${converted.length} chars of ${toFormat} output`,
  );

  return {
    converted,
    from_format: fromFormat,
    to_format: toFormat,
    char_count: converted.length,
    source_url: data.source_url,
  };
}
