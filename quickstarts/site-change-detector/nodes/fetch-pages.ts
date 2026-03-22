import type { Context } from "tentacular";

interface PageContent {
  url: string;
  content: string;
  fetchedAt: string;
  statusCode: number;
}

interface FetchPagesOutput {
  pages: PageContent[];
}

/** Strip HTML tags and extract readable text content */
function stripHtml(html: string): string {
  // Remove script and style blocks entirely
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode common HTML entities
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

/** Fetch configured URLs and extract readable text content */
export default async function run(ctx: Context, _input: unknown): Promise<FetchPagesOutput> {
  // Access probe-targets dependency to declare network intent for dynamic URLs
  const probeTargets = ctx.dependency("probe-targets");

  const urls = ctx.config.urls as string[];

  if (!urls || urls.length === 0) {
    ctx.log.warn("No URLs configured for monitoring");
    return { pages: [] };
  }

  // In test mode (no real network intent), return empty pages
  if (!probeTargets.host) {
    ctx.log.warn("No probe-targets available (test mode), returning empty pages");
    return { pages: [] };
  }

  ctx.log.info(`Fetching ${urls.length} pages for change detection`);

  const pages: PageContent[] = [];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Tentacular-SiteChangeDetector/1.0",
          "Accept": "text/html",
        },
        redirect: "follow",
      });

      const html = await res.text();
      const content = stripHtml(html);

      pages.push({
        url,
        content,
        fetchedAt: new Date().toISOString(),
        statusCode: res.status,
      });

      ctx.log.info(`Fetched ${url}: ${res.status}, ${content.length} chars of text`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.log.error(`Failed to fetch ${url}: ${message}`);
      pages.push({
        url,
        content: "",
        fetchedAt: new Date().toISOString(),
        statusCode: 0,
      });
    }
  }

  ctx.log.info(`Fetched ${pages.length} pages`);
  return { pages };
}
