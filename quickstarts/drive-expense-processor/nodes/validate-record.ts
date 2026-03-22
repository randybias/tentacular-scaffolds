import type { Context } from "tentacular";

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

interface ValidatedExpense extends ExpenseRecord {
  valid: boolean;
  validationErrors: string[];
}

interface ValidateResult {
  validated: ValidatedExpense[];
  validCount: number;
  flaggedCount: number;
  pollTimestamp: string;
}

function isValidISODate(dateStr: string): boolean {
  if (!dateStr) return false;
  const parsed = Date.parse(dateStr);
  if (isNaN(parsed)) return false;
  // Verify it round-trips to a valid date
  const d = new Date(parsed);
  return d.toISOString().startsWith(dateStr.substring(0, 10));
}

/** Validate extracted expense records: check amount, date, and category */
export default async function run(ctx: Context, input: unknown): Promise<ValidateResult> {
  const data = input as ExtractResult;
  const allowedCategories = (ctx.config.allowed_categories as string[]) ?? [
    "Travel", "Meals", "Software", "Office", "Equipment", "Other",
  ];

  if (data.expenses.length === 0) {
    ctx.log.info("No expenses to validate");
    return { validated: [], validCount: 0, flaggedCount: 0, pollTimestamp: data.pollTimestamp };
  }

  const validated: ValidatedExpense[] = [];

  for (const expense of data.expenses) {
    const errors: string[] = [];

    // Validate amount
    if (expense.amount <= 0) {
      errors.push(`Invalid amount: ${expense.amount} (must be > 0)`);
    }

    // Validate date
    if (!isValidISODate(expense.date)) {
      errors.push(`Invalid date: '${expense.date}' (must be valid ISO format)`);
    }

    // Validate category
    if (!allowedCategories.includes(expense.category)) {
      errors.push(`Invalid category: '${expense.category}' (allowed: ${allowedCategories.join(", ")})`);
    }

    // Validate vendor is not empty
    if (!expense.vendor || expense.vendor === "Unknown") {
      errors.push("Vendor name is missing or unknown");
    }

    const isValid = errors.length === 0;
    validated.push({
      ...expense,
      valid: isValid,
      validationErrors: errors,
    });

    if (!isValid) {
      ctx.log.warn(`Flagged ${expense.fileName}: ${errors.join("; ")}`);
    }
  }

  const validCount = validated.filter((v) => v.valid).length;
  const flaggedCount = validated.filter((v) => !v.valid).length;

  ctx.log.info(`Validation complete: ${validCount} valid, ${flaggedCount} flagged out of ${validated.length}`);
  return { validated, validCount, flaggedCount, pollTimestamp: data.pollTimestamp };
}
