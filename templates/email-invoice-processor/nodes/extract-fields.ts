import type { Context } from "tentacular";

interface StoredInvoice {
  messageId: string;
  from: string;
  subject: string;
  date: string;
  filename: string;
  mimeType: string;
  s3Path: string;
  content: string; // base64
}

interface StoreResult {
  storedInvoices: StoredInvoice[];
  pollTimestamp: string;
}

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface InvoiceRecord {
  messageId: string;
  from: string;
  subject: string;
  filename: string;
  s3Path: string;
  vendor: string;
  invoiceNumber: string;
  lineItems: LineItem[];
  subtotal: number;
  tax: number;
  total: number;
  dueDate: string;
  paymentTerms: string;
}

interface ExtractResult {
  invoices: InvoiceRecord[];
  pollTimestamp: string;
}

const EXTRACTION_PROMPT = `You are an invoice data extractor. Extract structured data from the provided invoice PDF content.

Return a JSON object with these fields:
- "vendor": The company/vendor name on the invoice
- "invoiceNumber": The invoice number/reference
- "lineItems": An array of line items, each with:
  - "description": Item description
  - "quantity": Quantity as a number
  - "unitPrice": Unit price as a number
  - "amount": Line item total as a number
- "subtotal": Subtotal before tax as a number
- "tax": Tax amount as a number
- "total": Grand total as a number
- "dueDate": Due date in ISO 8601 format (YYYY-MM-DD)
- "paymentTerms": Payment terms (e.g., "Net 30", "Due on receipt")

If a field cannot be determined, use null for strings, 0 for numbers, and [] for arrays.
Respond with valid JSON only, no markdown fences.`;

/** Extract structured invoice fields from PDF content using LLM */
export default async function run(ctx: Context, input: unknown): Promise<ExtractResult> {
  const data = input as StoreResult;

  if (data.storedInvoices.length === 0) {
    ctx.log.info("No invoices to extract from");
    return { invoices: [], pollTimestamp: data.pollTimestamp };
  }

  const anthropic = ctx.dependency("anthropic");
  if (!anthropic.secret) {
    ctx.log.error("No anthropic.api_key in secrets -- cannot extract fields");
    return { invoices: [], pollTimestamp: data.pollTimestamp };
  }

  const invoices: InvoiceRecord[] = [];

  for (const invoice of data.storedInvoices) {
    ctx.log.info(`Extracting fields from ${invoice.filename} (message: ${invoice.messageId})`);

    try {
      const response = await anthropic.fetch!("/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropic.secret,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          system: EXTRACTION_PROMPT,
          messages: [{
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: invoice.content,
                },
              },
              {
                type: "text",
                text: `Extract all invoice data from this PDF. Email subject: "${invoice.subject}", from: "${invoice.from}"`,
              },
            ],
          }],
        }),
      });

      if (!response.ok) {
        ctx.log.warn(`Anthropic API returned ${response.status} for ${invoice.filename}`);
        continue;
      }

      const result = await response.json();
      const text = result?.content?.[0]?.text;
      if (!text) {
        ctx.log.warn(`Empty response for ${invoice.filename}`);
        continue;
      }

      const parsed = JSON.parse(text);

      const lineItems: LineItem[] = (parsed.lineItems ?? []).map((li: Record<string, unknown>) => ({
        description: String(li.description ?? ""),
        quantity: Number(li.quantity) || 0,
        unitPrice: Number(li.unitPrice) || 0,
        amount: Number(li.amount) || 0,
      }));

      invoices.push({
        messageId: invoice.messageId,
        from: invoice.from,
        subject: invoice.subject,
        filename: invoice.filename,
        s3Path: invoice.s3Path,
        vendor: parsed.vendor ?? "Unknown",
        invoiceNumber: parsed.invoiceNumber ?? "",
        lineItems,
        subtotal: Number(parsed.subtotal) || 0,
        tax: Number(parsed.tax) || 0,
        total: Number(parsed.total) || 0,
        dueDate: parsed.dueDate ?? "",
        paymentTerms: parsed.paymentTerms ?? "",
      });

      ctx.log.info(`Extracted: ${parsed.vendor} #${parsed.invoiceNumber} $${parsed.total}`);
    } catch (err) {
      ctx.log.warn(`Extraction failed for ${invoice.filename}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  ctx.log.info(`Extracted ${invoices.length}/${data.storedInvoices.length} invoice records`);
  return { invoices, pollTimestamp: data.pollTimestamp };
}
