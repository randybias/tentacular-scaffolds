import type { Context } from "tentacular";
import nunjucks from "npm:nunjucks@3.2.4";
import type { AnalyzeFramesOutput } from "./analyze-frames.ts";

interface ReportSection {
  title: string;
  content: string;
  key_frame_path?: string;
  key_frame_b64?: string;
}

export interface CompileReportOutput {
  html: string;
  markdown: string;
  slack_blocks: Record<string, unknown>[];
  sections: ReportSection[];
  title: string;
}

/**
 * Synthesize batch analyses into thematic sections and render
 * HTML, Markdown, and Slack Block Kit reports via Nunjucks templates.
 */
export default async function run(
  ctx: Context,
  input: unknown,
): Promise<CompileReportOutput> {
  const data = input as AnalyzeFramesOutput;
  const cfg = ctx.config as Record<string, unknown>;
  const reportCfg = (cfg["report"] as Record<string, unknown>) ?? {};
  const title = data.title;
  const author = String(reportCfg["author"] ?? "Tentacular");
  const style = String(reportCfg["style"] ?? "narrative");

  ctx.log.info(
    `Compiling ${style} report from ${data.batches} batch analyses`,
  );

  // Synthesize batch analyses into thematic sections via LLM
  const sections = await synthesizeSections(ctx, data, title, style);

  // Load key frames as base64 for embedding in reports
  for (const section of sections) {
    if (section.key_frame_path) {
      try {
        const bytes = await Deno.readFile(section.key_frame_path);
        const chunks: string[] = [];
        for (let i = 0; i < bytes.length; i += 8192) {
          chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
        }
        section.key_frame_b64 = btoa(chunks.join(""));
      } catch {
        section.key_frame_b64 = undefined;
      }
    }
  }

  const templateData = {
    title,
    author,
    generated_at: new Date().toISOString(),
    sections,
    frames_analyzed: data.frames_analyzed,
    batches: data.batches,
    model: data.model,
    style,
  };

  // Inline templates — the builder only mounts nodes/*.ts, not templates/
  const html = nunjucks.renderString(HTML_TEMPLATE, templateData);
  const markdown = nunjucks.renderString(MD_TEMPLATE, templateData);
  const slackJson = nunjucks.renderString(SLACK_TEMPLATE, templateData);

  let slackBlocks: Record<string, unknown>[];
  try {
    slackBlocks = JSON.parse(slackJson) as Record<string, unknown>[];
  } catch {
    ctx.log.warn("Failed to parse slack-blocks.json template output");
    slackBlocks = [];
  }

  ctx.log.info(
    `Report compiled: ${sections.length} sections, ${html.length} chars HTML`,
  );

  return { html, markdown, slack_blocks: slackBlocks, sections, title };
}

async function synthesizeSections(
  ctx: Context,
  data: AnalyzeFramesOutput,
  title: string,
  style: string,
): Promise<ReportSection[]> {
  const anthropic = ctx.dependency("anthropic");

  if (!anthropic.secret) {
    ctx.log.warn("No API key — returning raw batch analyses as sections");
    return data.batch_analyses.map((b) => ({
      title: `Segment ${b.batch_index + 1}`,
      content: b.analysis,
    }));
  }

  const batchText = data.batch_analyses
    .map(
      (b) =>
        `[Frames ${b.frame_range[0] + 1}-${b.frame_range[1] + 1}]\n${b.analysis}`,
    )
    .join("\n\n---\n\n");

  const prompt =
    `You are creating a structured report titled "${title}". ` +
    `Below are sequential analyses of video frames. ` +
    `Synthesize them into ${style === "narrative" ? "a coherent narrative with" : ""} ` +
    `thematic sections. Do NOT produce a frame-by-frame summary. ` +
    `Group related content into 3-7 titled sections.\n\n` +
    `Return ONLY a JSON array of objects with "title" and "content" keys. ` +
    `The content should be well-written paragraphs (HTML allowed: <p>, <strong>, <em>).\n\n` +
    `Frame analyses:\n\n${batchText}`;

  const res = await anthropic.fetch!("/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropic.secret,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    ctx.log.warn(`Synthesis API error ${res.status} — falling back to raw sections`);
    return data.batch_analyses.map((b) => ({
      title: `Segment ${b.batch_index + 1}`,
      content: b.analysis,
    }));
  }

  const completionRaw = (await res.json()) as Record<string, unknown>;
  const content = completionRaw["content"] as Array<{ type: string; text?: string }> | undefined;
  const rawText = content?.find((b) => b.type === "text")?.text?.trim() ?? "[]";

  try {
    // Extract JSON from response (may be wrapped in markdown code block)
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found");
    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      title: string;
      content: string;
    }>;
    return parsed.map((s) => ({ title: s.title, content: s.content }));
  } catch {
    ctx.log.warn("Failed to parse synthesis response — using raw sections");
    return data.batch_analyses.map((b) => ({
      title: `Segment ${b.batch_index + 1}`,
      content: b.analysis,
    }));
  }
}

// --- Inline Nunjucks templates (builder only mounts nodes/*.ts) ---

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ title }}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 900px; margin: 0 auto; padding: 2rem 1.5rem; background: #fafafa; }
    header { border-bottom: 3px solid #2563eb; padding-bottom: 1.5rem; margin-bottom: 2rem; }
    header h1 { font-size: 1.8rem; color: #111; margin-bottom: 0.5rem; }
    header .meta { color: #666; font-size: 0.9rem; }
    header .meta span { margin-right: 1.5rem; }
    section { margin-bottom: 2.5rem; }
    section h2 { font-size: 1.3rem; color: #1e40af; border-left: 4px solid #2563eb; padding-left: 0.75rem; margin-bottom: 1rem; }
    section .content { padding-left: 1rem; }
    section .content p { margin-bottom: 0.8rem; }
    .key-frame { display: block; max-width: 100%; height: auto; border-radius: 6px; margin: 1rem 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    footer { border-top: 1px solid #ddd; padding-top: 1rem; margin-top: 2rem; color: #888; font-size: 0.8rem; }
    footer span { margin-right: 1.5rem; }
  </style>
</head>
<body>
  <header>
    <h1>{{ title }}</h1>
    <div class="meta">
      <span>By {{ author }}</span>
      <span>Generated {{ generated_at }}</span>
      <span>{{ frames_analyzed }} frames analyzed</span>
    </div>
  </header>
  {% for section in sections %}
  <section>
    <h2>{{ section.title }}</h2>
    <div class="content">
      {{ section.content | safe }}
      {% if section.key_frame_b64 %}
      <img class="key-frame" src="data:image/jpeg;base64,{{ section.key_frame_b64 }}" alt="Key frame from {{ section.title }}">
      {% endif %}
    </div>
  </section>
  {% endfor %}
  <footer>
    <span>{{ batches }} analysis batches</span>
    <span>Model: {{ model }}</span>
    <span>Style: {{ style }}</span>
    <span>Generated by Tentacular</span>
  </footer>
</body>
</html>`;

const MD_TEMPLATE = `# {{ title }}

**Author:** {{ author }} | **Generated:** {{ generated_at }} | **Frames analyzed:** {{ frames_analyzed }}

---

{% for section in sections %}
## {{ section.title }}

{{ section.content }}

{% if section.key_frame_b64 %}
![Key frame from {{ section.title }}](data:image/jpeg;base64,{{ section.key_frame_b64 }})
{% endif %}

{% endfor %}
---

*{{ batches }} analysis batches | Model: {{ model }} | Style: {{ style }} | Generated by Tentacular*`;

const SLACK_TEMPLATE = `[
  {"type":"header","text":{"type":"plain_text","text":"{{ title }}"}},
  {"type":"section","text":{"type":"mrkdwn","text":"*Video Analysis Report*\\n{{ sections | length }} sections from {{ frames_analyzed }} analyzed frames"}},
  {% for section in sections %}
  {"type":"section","text":{"type":"mrkdwn","text":"*{{ section.title }}*"}}{% if not loop.last %},{% endif %}
  {% endfor %},
  {"type":"context","elements":[{"type":"mrkdwn","text":"Model: {{ model }} | {{ batches }} batches | {{ style }} style | Generated by Tentacular at {{ generated_at }}"}]}
]`;
