import type { Context } from "tentacular";

interface StoredFile {
  fileId: string;
  fileName: string;
  mimeType: string;
  s3Path: string;
  content: string; // base64
}

interface StoreResult {
  storedFiles: StoredFile[];
  pollTimestamp: string;
}

interface ExpenseRecord {
  fileId: string;
  fileName: string;
  s3Path: string;
  vendor: string;
  amount: number;
  currency: string;
  date: string;
  category: string;
  description: string;
  extractionConfidence: string;
}

interface ExtractResult {
  expenses: ExpenseRecord[];
  pollTimestamp: string;
}

const EXTRACTION_PROMPT = `You are an expense receipt parser. Extract structured data from the provided receipt content.

Return a JSON object with these fields:
- "vendor": The business/merchant name
- "amount": The total amount as a number (no currency symbols)
- "currency": The 3-letter currency code (e.g., "USD", "EUR")
- "date": The receipt date in ISO 8601 format (YYYY-MM-DD)
- "category": Best-fit category from: Travel, Meals, Software, Office, Equipment, Other
- "description": A brief one-line description of the expense
- "confidence": "high", "medium", or "low" indicating extraction confidence

Respond with valid JSON only, no markdown fences.`;

/** Extract structured expense fields from receipt content using LLM */
export default async function run(ctx: Context, input: unknown): Promise<ExtractResult> {
  const data = input as StoreResult;

  if (data.storedFiles.length === 0) {
    ctx.log.info("No files to extract from");
    return { expenses: [], pollTimestamp: data.pollTimestamp };
  }

  const anthropic = ctx.dependency("anthropic");
  if (!anthropic.secret) {
    ctx.log.error("No anthropic.api_key in secrets -- cannot extract fields");
    return { expenses: [], pollTimestamp: data.pollTimestamp };
  }

  const expenses: ExpenseRecord[] = [];

  for (const file of data.storedFiles) {
    ctx.log.info(`Extracting fields from ${file.fileName}`);

    try {
      const isImage = file.mimeType.startsWith("image/");
      const mediaType = isImage ? file.mimeType : "application/pdf";

      const userContent: unknown[] = isImage
        ? [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: file.content },
            },
            { type: "text", text: "Extract expense data from this receipt image." },
          ]
        : [
            { type: "text", text: `Receipt file: ${file.fileName}\n\nBase64 content (decode to read):\n${file.content.substring(0, 5000)}` },
          ];

      const response = await anthropic.fetch!("/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropic.secret,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: EXTRACTION_PROMPT,
          messages: [{ role: "user", content: userContent }],
        }),
      });

      if (!response.ok) {
        ctx.log.warn(`Anthropic API returned ${response.status} for ${file.fileName}`);
        continue;
      }

      const result = await response.json();
      const text = result?.content?.[0]?.text;
      if (!text) {
        ctx.log.warn(`Empty response for ${file.fileName}`);
        continue;
      }

      const parsed = JSON.parse(text);
      expenses.push({
        fileId: file.fileId,
        fileName: file.fileName,
        s3Path: file.s3Path,
        vendor: parsed.vendor ?? "Unknown",
        amount: Number(parsed.amount) || 0,
        currency: parsed.currency ?? "USD",
        date: parsed.date ?? "",
        category: parsed.category ?? "Other",
        description: parsed.description ?? "",
        extractionConfidence: parsed.confidence ?? "low",
      });

      ctx.log.info(`Extracted: ${parsed.vendor} ${parsed.amount} ${parsed.currency}`);
    } catch (err) {
      ctx.log.warn(`Extraction failed for ${file.fileName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  ctx.log.info(`Extracted ${expenses.length}/${data.storedFiles.length} expense records`);
  return { expenses, pollTimestamp: data.pollTimestamp };
}
