import assert from "node:assert/strict";
import { validateExpenseInput } from "../src/expenseValidation.js";

// valid input is normalised (trimmed name, rounded amount, coerced flag)
{
  const r = validateExpenseInput({ amount: "120.5", paidBy: "  Moiz  ", date: "2026-06-16", repaymentDone: "true" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { amount: 120.5, paidBy: "Moiz", expenseDate: "2026-06-16", repaymentDone: 1 });
}
// amount must be > 0
assert.equal(validateExpenseInput({ amount: 0, paidBy: "X", date: "2026-06-16" }).ok, false);
// amount must be a number
assert.equal(validateExpenseInput({ amount: "abc", paidBy: "X", date: "2026-06-16" }).ok, false);
// paidBy required (whitespace-only rejected)
assert.equal(validateExpenseInput({ amount: 10, paidBy: "   ", date: "2026-06-16" }).ok, false);
// date format must be YYYY-MM-DD
assert.equal(validateExpenseInput({ amount: 10, paidBy: "X", date: "16/06/2026" }).ok, false);
// impossible calendar date rejected
assert.equal(validateExpenseInput({ amount: 10, paidBy: "X", date: "2026-02-30" }).ok, false);
// repaymentDone defaults to 0 when omitted
{
  const r = validateExpenseInput({ amount: 10, paidBy: "X", date: "2026-06-16" });
  assert.equal(r.ok, true);
  assert.equal(r.value.repaymentDone, 0);
}

console.log("expenseValidation: all tests passed");
