import type { Context } from "tentacular";

/** Output passed to convert-document */
export interface FetchDocumentOutput {
  content: string;
  detected_format: string;
  source_url: string;
  content_length: number;
}

/** Infer pandoc format from a URL path or Content-Type header */
function detectFormat(url: string, contentType: string): string {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith(".md") || path.endsWith(".markdown")) return "markdown";
  if (path.endsWith(".html") || path.endsWith(".htm")) return "html";
  if (path.endsWith(".rst")) return "rst";
  if (path.endsWith(".org")) return "org";
  if (path.endsWith(".tex")) return "latex";
  if (path.endsWith(".txt")) return "plain";
  if (contentType.includes("text/markdown")) return "markdown";
  if (contentType.includes("text/html")) return "html";
  if (contentType.includes("text/plain")) return "plain";
  // Default to markdown — works well as a fallback for plain text
  return "markdown";
}

/**
 * Fetch a document from a URL and return its raw text content.
 *
 * Detects the pandoc input format from the URL extension or Content-Type header.
 * Falls back to config.input_format if detection is ambiguous.
 * The detected_format is passed downstream to convert-document.
 */
export default async function run(
  ctx: Context,
  _input: unknown,
): Promise<FetchDocumentOutput> {
  const cfg = ctx.config as Record<string, unknown>;
  const docUrl = String(cfg["document_url"] ?? "");
  const configFormat = String(cfg["input_format"] ?? "markdown");

  if (!docUrl) {
    throw new Error("config.document_url is required");
  }

  ctx.log.info(`Fetching document from ${docUrl}`);

  const docSource = ctx.dependency("doc-source");
  const res = await docSource.fetch!(docUrl);

  if (!res.ok) {
    throw new Error(`Failed to fetch document: HTTP ${res.status} from ${docUrl}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const content = await res.text();

  // Prefer URL-based detection; fall back to Content-Type; then config
  const detected = detectFormat(docUrl, contentType);
  const finalFormat = detected !== "markdown" ? detected : configFormat;

  ctx.log.info(
    `Fetched ${content.length} chars, content-type="${contentType}", format="${finalFormat}"`,
  );

  return {
    content,
    detected_format: finalFormat,
    source_url: docUrl,
    content_length: content.length,
  };
}
