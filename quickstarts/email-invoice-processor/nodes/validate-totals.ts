import type { Context } from "tentacular";

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

interface ValidatedInvoice extends InvoiceRecord {
  validationStatus: "PASS" | "FAIL";
  validationErrors: string[];
}

interface ValidateResult {
  validated: ValidatedInvoice[];
  passCount: number;
  failCount: number;
  pollTimestamp: string;
}

const TOLERANCE = 0.01; // Allow $0.01 rounding tolerance

/** Validate invoice arithmetic: line items sum, subtotal + tax = total */
export default async function run(ctx: Context, input: unknown): Promise<ValidateResult> {
  const data = input as ExtractResult;

  if (data.invoices.length === 0) {
    ctx.log.info("No invoices to validate");
    return { validated: [], passCount: 0, failCount: 0, pollTimestamp: data.pollTimestamp };
  }

  const validated: ValidatedInvoice[] = [];

  for (const invoice of data.invoices) {
    const errors: string[] = [];

    // Check line item amounts sum to subtotal
    if (invoice.lineItems.length > 0 && invoice.subtotal > 0) {
      const lineItemSum = invoice.lineItems.reduce((sum, li) => sum + li.amount, 0);
      const subtotalDiff = Math.abs(lineItemSum - invoice.subtotal);

      if (subtotalDiff > TOLERANCE) {
        errors.push(
          `Line items sum to $${lineItemSum.toFixed(2)} but subtotal shows $${invoice.subtotal.toFixed(2)} (diff: $${subtotalDiff.toFixed(2)})`,
        );
      }
    }

    // Check subtotal + tax = total
    if (invoice.subtotal > 0 && invoice.total > 0) {
      const expectedTotal = invoice.subtotal + invoice.tax;
      const totalDiff = Math.abs(expectedTotal - invoice.total);

      if (totalDiff > TOLERANCE) {
        errors.push(
          `Subtotal ($${invoice.subtotal.toFixed(2)}) + tax ($${invoice.tax.toFixed(2)}) = $${expectedTotal.toFixed(2)} but total shows $${invoice.total.toFixed(2)}`,
        );
      }
    }

    // Check individual line item arithmetic (quantity * unitPrice = amount)
    for (let i = 0; i < invoice.lineItems.length; i++) {
      const li = invoice.lineItems[i];
      if (li.quantity > 0 && li.unitPrice > 0) {
        const expectedAmount = li.quantity * li.unitPrice;
        const diff = Math.abs(expectedAmount - li.amount);

        if (diff > TOLERANCE) {
          errors.push(
            `Line item ${i + 1} "${li.description}": qty ${li.quantity} x $${li.unitPrice.toFixed(2)} = $${expectedAmount.toFixed(2)} but shows $${li.amount.toFixed(2)}`,
          );
        }
      }
    }

    // Check total is positive
    if (invoice.total <= 0) {
      errors.push(`Total is $${invoice.total.toFixed(2)} (expected positive amount)`);
    }

    // Check due date is valid if present
    if (invoice.dueDate) {
      const parsed = Date.parse(invoice.dueDate);
      if (isNaN(parsed)) {
        errors.push(`Invalid due date: '${invoice.dueDate}'`);
      }
    }

    const validationStatus = errors.length === 0 ? "PASS" : "FAIL";
    validated.push({
      ...invoice,
      validationStatus,
      validationErrors: errors,
    });

    if (errors.length > 0) {
      ctx.log.warn(`FAIL ${invoice.vendor} #${invoice.invoiceNumber}: ${errors.join("; ")}`);
    } else {
      ctx.log.info(`PASS ${invoice.vendor} #${invoice.invoiceNumber}: $${invoice.total.toFixed(2)}`);
    }
  }

  const passCount = validated.filter((v) => v.validationStatus === "PASS").length;
  const failCount = validated.filter((v) => v.validationStatus === "FAIL").length;

  ctx.log.info(`Validation complete: ${passCount} PASS, ${failCount} FAIL out of ${validated.length}`);
  return { validated, passCount, failCount, pollTimestamp: data.pollTimestamp };
}
