import type { Context } from "tentacular";
import type { FetchDocumentOutput } from "./fetch-document.ts";

/** pandoc-server POST / response */
interface PandocResponse {
  output: string;
  base64: boolean;
  messages?: Array<{ type: string; message: string }>;
}

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
 * The sidecar runs pandoc as a long-lived HTTP server — no process-per-request overhead.
 * No shared volume needed: content travels entirely as JSON HTTP body in and out.
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

  const result = await res.json() as PandocResponse;

  // pandoc-server returns base64-encoded output for binary formats (e.g. docx).
  // For text formats (html, markdown, plain, latex), base64 is false.
  let converted: string;
  if (result.base64) {
    // Decode base64 output for binary/PDF-like formats
    converted = atob(result.output);
  } else {
    converted = result.output;
  }

  // Log any pandoc warnings
  if (result.messages && result.messages.length > 0) {
    for (const msg of result.messages) {
      ctx.log.warn(`pandoc [${msg.type}]: ${msg.message}`);
    }
  }

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
