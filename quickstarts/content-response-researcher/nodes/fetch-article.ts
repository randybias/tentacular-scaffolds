import type { Context } from "tentacular";

export interface ArticleContent {
  url: string;
  title: string;
  content: string;
  publishedDate: string;
}

/** Fetch a web page, strip HTML, and extract clean text content */
export default async function run(ctx: Context, _input: unknown): Promise<ArticleContent> {
  const url = ctx.config.target_url as string;

  // Access declared dependency so contract drift checker sees it
  const probeTargets = ctx.dependency("probe-targets");

  if (!url) {
    ctx.log.warn("No target_url configured -- returning empty (test mode)");
    return { url: "", title: "", content: "", publishedDate: "" };
  }

  ctx.log.info(`Fetching article from ${url}`);

  const res = await probeTargets.fetch!(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch article: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();

  // Strip HTML tags and extract text content
  const title = extractTitle(html);
  const content = stripHtml(html);
  const publishedDate = extractDate(html);

  ctx.log.info(`Extracted article: "${title}" (${content.length} chars)`);

  return { url, title, content, publishedDate };
}

/** Extract <title> content from HTML */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/is);
  if (match) return decodeEntities(match[1].trim());

  // Try og:title
  const ogMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"[^>]*>/i);
  if (ogMatch) return decodeEntities(ogMatch[1].trim());

  return "Untitled";
}

/** Extract published date from meta tags */
function extractDate(html: string): string {
  const patterns = [
    /<meta[^>]*property="article:published_time"[^>]*content="([^"]*)"[^>]*>/i,
    /<meta[^>]*name="date"[^>]*content="([^"]*)"[^>]*>/i,
    /<time[^>]*datetime="([^"]*)"[^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1].trim();
  }

  return new Date().toISOString();
}

/** Strip HTML tags and normalize whitespace */
function stripHtml(html: string): string {
  // Remove script and style blocks
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");

  // Replace block elements with newlines
  text = text.replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote)[^>]*>/gi, "\n");

  // Remove all remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  text = decodeEntities(text);

  // Normalize whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n/g, "\n\n");
  text = text.trim();

  return text;
}

/** Decode common HTML entities */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
