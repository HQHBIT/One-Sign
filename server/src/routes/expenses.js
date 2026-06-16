import { Router } from "express";
import { query, queryOne, execute } from "../db.js";
import { authRequired, requireRole } from "../auth.js";
import { validateExpenseInput } from "../expenseValidation.js";

const router = Router();

// Shape a DB row for the API. DATE comes back via DATE_FORMAT as a string,
// but guard against a Date object too (format in local time to avoid TZ shift).
function hydrate(r) {
  const date = r.expense_date instanceof Date
    ? `${r.expense_date.getFullYear()}-${String(r.expense_date.getMonth() + 1).padStart(2, "0")}-${String(r.expense_date.getDate()).padStart(2, "0")}`
    : String(r.expense_date);
  return {
    id: r.id,
    amount: Number(r.amount),
    paidBy: r.paid_by,
    date,
    repaymentDone: !!r.repayment_done,
    description: r.description || "",
    createdAt: Number(r.created_at)
  };
}

const round2 = n => Math.round(n * 100) / 100;

// PUBLIC — submit one expense. No auth: reachable straight from the login page.
router.post("/", async (req, res, next) => {
  try {
    const v = validateExpenseInput(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { amount, paidBy, expenseDate, repaymentDone, description } = v.value;
    await execute(
      "INSERT INTO expenses (amount, paid_by, expense_date, repayment_done, description, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [amount, paidBy, expenseDate, repaymentDone, description || null, Date.now()]
    );
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

// ADMIN — list all expenses + summary, newest first.
router.get("/", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const rows = await query(
      "SELECT id, amount, paid_by, DATE_FORMAT(expense_date, '%Y-%m-%d') AS expense_date, repayment_done, description, created_at " +
      "FROM expenses ORDER BY expense_date DESC, id DESC"
    );
    const expenses = rows.map(hydrate);
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const repaid = expenses.filter(e => e.repaymentDone).reduce((s, e) => s + e.amount, 0);
    res.json({
      expenses,
      summary: {
        count: expenses.length,
        total: round2(total),
        repaid: round2(repaid),
        outstanding: round2(total - repaid)
      }
    });
  } catch (e) { next(e); }
});

// ADMIN — flip the repayment flag.
router.patch("/:id/repayment", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const done = req.body?.done === true || req.body?.done === "true" ? 1 : 0;
    const existing = await queryOne("SELECT id FROM expenses WHERE id = ?", [req.params.id]);
    if (!existing) return res.status(404).json({ error: "Expense not found" });
    await execute("UPDATE expenses SET repayment_done = ? WHERE id = ?", [done, req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
