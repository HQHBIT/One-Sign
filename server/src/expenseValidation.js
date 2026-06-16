// Pure input validation for an incoming expense submission.
// No DB, no framework — easy to unit-test and reuse from the route handler.

const MAX_PAID_BY = 191;

/**
 * Validate + normalise an expense submission body.
 * @param {object} body raw req.body
 * @returns {{ ok: true, value: { amount: number, paidBy: string, expenseDate: string, repaymentDone: 0|1 } }
 *          | { ok: false, error: string }}
 */
export function validateExpenseInput(body = {}) {
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Amount must be a number greater than 0" };
  }
  const roundedAmount = Math.round(amount * 100) / 100; // currency → 2 dp

  const paidBy = typeof body.paidBy === "string" ? body.paidBy.trim() : "";
  if (!paidBy) return { ok: false, error: "Paid By is required" };
  if (paidBy.length > MAX_PAID_BY) {
    return { ok: false, error: `Paid By must be ${MAX_PAID_BY} characters or fewer` };
  }

  // Expect an ISO calendar date (YYYY-MM-DD), as produced by <input type="date">.
  const date = typeof body.date === "string" ? body.date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "Date must be in YYYY-MM-DD format" };
  }
  const parsed = new Date(date + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return { ok: false, error: "Date is not a valid calendar date" };
  }

  const repaymentDone =
    body.repaymentDone === true || body.repaymentDone === "true" ||
    body.repaymentDone === 1 || body.repaymentDone === "1" ? 1 : 0;

  return { ok: true, value: { amount: roundedAmount, paidBy, expenseDate: date, repaymentDone } };
}
