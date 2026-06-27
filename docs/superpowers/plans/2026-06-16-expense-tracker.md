# Expense Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public "submit an expense" entry point to the SignFlow login page (Amount, Paid By, Date, Repayment Done) and an admin-only consolidated view of all submissions.

**Architecture:** A new `expenses` MySQL table; a new Express router (`routes/expenses.js`) with a public `POST` and admin-guarded `GET`/`PATCH`; three client `api.js` methods; an expense form woven into the existing `LoginScreen` panel state machine; and a self-contained `AdminExpenses` view added to the admin dashboard in `App.jsx`. Input validation is extracted into a pure, unit-tested helper.

**Tech Stack:** Node.js + Express + mysql2 (ESM), React 18 + Vite + Tailwind v4, lucide-react icons. No test framework installed — the one pure unit is tested with Node's built-in `assert`; wired-up routes/UI are verified against the running dev server (API on `:5001`, app on `:5173`).

---

## File Structure

| File | Create/Modify | Responsibility |
| --- | --- | --- |
| `server/src/expenseValidation.js` | Create | Pure `validateExpenseInput(body)` — no DB, no Express |
| `server/test/expenseValidation.test.mjs` | Create | Node `assert` unit tests for the validator |
| `server/src/db.js` | Modify | Add `expenses` table to `runSchema()` |
| `server/src/routes/expenses.js` | Create | POST (public) + GET/PATCH (admin) handlers |
| `server/src/index.js` | Modify | Mount the expenses router |
| `server/test/expenses.integration.mjs` | Create | End-to-end check against a running server |
| `client/src/api.js` | Modify | `submitExpense` / `listExpenses` / `setExpenseRepayment` |
| `client/src/components/LoginScreen.jsx` | Modify | Public expense form + success screen |
| `client/src/App.jsx` | Modify | `AdminExpenses` component + tile + route line + icon import |

---

### Task 1: Expense input validation (pure helper, TDD)

**Files:**
- Create: `server/src/expenseValidation.js`
- Test: `server/test/expenseValidation.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `server/test/expenseValidation.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node server/test/expenseValidation.test.mjs`
Expected: FAIL — `Cannot find module '.../src/expenseValidation.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/expenseValidation.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node server/test/expenseValidation.test.mjs`
Expected: PASS — prints `expenseValidation: all tests passed`.

- [ ] **Step 5: Commit**

```bash
git add server/src/expenseValidation.js server/test/expenseValidation.test.mjs
git commit -m "Expenses: pure input validation helper + unit tests"
```

---

### Task 2: `expenses` table in the schema

**Files:**
- Modify: `server/src/db.js` (the `stmts` array inside `runSchema()`)

- [ ] **Step 1: Add the table DDL**

In `server/src/db.js`, find the end of the `stmts` array in `runSchema()`. The last entry is the `request_step_signers` table, which ends with:

```js
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  ];
```

Change it to append the `expenses` table (note the added comma after the closing backtick of the previous entry):

```js
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS expenses (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      amount          DECIMAL(12,2) NOT NULL,
      paid_by         VARCHAR(191)  NOT NULL,
      expense_date    DATE          NOT NULL,
      repayment_done  TINYINT(1)    NOT NULL DEFAULT 0,
      created_at      BIGINT        NOT NULL,
      INDEX idx_expenses_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  ];
```

- [ ] **Step 2: Verify the table is created on boot**

Ensure MySQL is running, then start the API server:

Run: `npm --prefix server start`
Expected: the startup banner prints and `[db] MySQL connected → …` appears with no error. (`CREATE TABLE IF NOT EXISTS` is idempotent, so re-runs are safe.)

Confirm the table exists (separate terminal, leave the server running):

Run: `node --input-type=module -e "import('./server/src/db.js').then(async m => { await m.initDb(); const r = await m.query(\"SHOW TABLES LIKE 'expenses'\"); console.log(r.length ? 'expenses table present' : 'MISSING'); process.exit(0); })"`
Expected: prints `expenses table present`.

Stop the server (Ctrl-C) once confirmed.

- [ ] **Step 3: Commit**

```bash
git add server/src/db.js
git commit -m "Expenses: add expenses table to schema migration"
```

---

### Task 3: Expense API routes (public POST, admin GET/PATCH)

**Files:**
- Create: `server/src/routes/expenses.js`
- Modify: `server/src/index.js` (import + mount)
- Test: `server/test/expenses.integration.mjs`

- [ ] **Step 1: Create the router**

Create `server/src/routes/expenses.js`:

```js
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
    createdAt: Number(r.created_at)
  };
}

const round2 = n => Math.round(n * 100) / 100;

// PUBLIC — submit one expense. No auth: reachable straight from the login page.
router.post("/", async (req, res, next) => {
  try {
    const v = validateExpenseInput(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { amount, paidBy, expenseDate, repaymentDone } = v.value;
    await execute(
      "INSERT INTO expenses (amount, paid_by, expense_date, repayment_done, created_at) VALUES (?, ?, ?, ?, ?)",
      [amount, paidBy, expenseDate, repaymentDone, Date.now()]
    );
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

// ADMIN — list all expenses + summary, newest first.
router.get("/", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const rows = await query(
      "SELECT id, amount, paid_by, DATE_FORMAT(expense_date, '%Y-%m-%d') AS expense_date, repayment_done, created_at " +
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
```

- [ ] **Step 2: Mount the router in `index.js`**

In `server/src/index.js`, add the import alongside the other route imports (after line 14, `import adminRoutes from "./routes/admin.js";`):

```js
import expensesRoutes from "./routes/expenses.js";
```

Then mount it. Find:

```js
  app.use("/api/requests", requestsRoutes);
  app.use("/api", adminRoutes);
```

Change to (mount the specific path before the catch-all `/api`):

```js
  app.use("/api/requests", requestsRoutes);
  app.use("/api/expenses", expensesRoutes);
  app.use("/api", adminRoutes);
```

- [ ] **Step 3: Write the integration check**

Create `server/test/expenses.integration.mjs` (exercises the real HTTP API end-to-end):

```js
// Run against a RUNNING server (default :5001). Requires MySQL + seeded admin.
// Usage: node server/test/expenses.integration.mjs
const BASE = process.env.API_BASE || "http://localhost:5001";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "it@hqhb.in";
const ADMIN_PASS = process.env.ADMIN_PASS || "Taha@011023"; // adjust if changed

const j = async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) });
let failures = 0;
const check = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) failures++; };

// 1) public POST — valid
const ok = await j(await fetch(`${BASE}/api/expenses`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ amount: 250.75, paidBy: "Integration Test", date: "2026-06-16", repaymentDone: false })
}));
check("public POST valid → 201", ok.status === 201 && ok.body.ok === true);

// 2) public POST — invalid (amount 0)
const bad = await j(await fetch(`${BASE}/api/expenses`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ amount: 0, paidBy: "X", date: "2026-06-16" })
}));
check("public POST invalid → 400", bad.status === 400);

// 3) GET without auth → 401
const noauth = await j(await fetch(`${BASE}/api/expenses`));
check("GET without token → 401", noauth.status === 401);

// 4) login as admin
const login = await j(await fetch(`${BASE}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS })
}));
check("admin login → token", login.status === 200 && !!login.body.token);
const token = login.body.token;
const auth = { Authorization: `Bearer ${token}` };

// 5) GET as admin — our row is present, summary is consistent
const list = await j(await fetch(`${BASE}/api/expenses`, { headers: auth }));
const mine = (list.body.expenses || []).find(e => e.paidBy === "Integration Test" && e.amount === 250.75);
check("admin GET → list + summary", list.status === 200 && !!mine && typeof list.body.summary.outstanding === "number");

// 6) PATCH repayment → flips flag
const patch = await j(await fetch(`${BASE}/api/expenses/${mine.id}/repayment`, {
  method: "PATCH", headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ done: true })
}));
check("PATCH repayment → ok", patch.status === 200 && patch.body.ok === true);

const list2 = await j(await fetch(`${BASE}/api/expenses`, { headers: auth }));
const flipped = (list2.body.expenses || []).find(e => e.id === mine.id);
check("repayment flag persisted", !!flipped && flipped.repaymentDone === true);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll integration checks passed");
process.exit(failures ? 1 : 0);
```

- [ ] **Step 4: Run the integration check**

Start the server in one terminal: `npm --prefix server start` (MySQL must be running).
In another terminal, run: `node server/test/expenses.integration.mjs`
Expected: six `PASS` lines and `All integration checks passed`.

> If admin login fails, the seeded admin password was changed — re-run with `ADMIN_PASS=<current> node server/test/expenses.integration.mjs`.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/expenses.js server/src/index.js server/test/expenses.integration.mjs
git commit -m "Expenses: API routes (public POST, admin GET/PATCH) + integration check"
```

---

### Task 4: Client API methods

**Files:**
- Modify: `client/src/api.js`

- [ ] **Step 1: Add the three methods**

In `client/src/api.js`, find the admin/reports section that ends with the `downloadReportCsv` block:

```js
  downloadReportCsv() {
    // Returns a blob URL for download
    return this.fetch("/api/reports/csv", { raw: true }).then(async res => {
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    });
  },
```

Immediately after that closing `},`, insert:

```js

  // -------- expenses --------
  // POST is public (login page) — fetch wrapper omits the auth header when no token is set.
  submitExpense({ amount, paidBy, date, repaymentDone }) {
    return this.fetch("/api/expenses", {
      method: "POST",
      body: JSON.stringify({ amount, paidBy, date, repaymentDone })
    });
  },
  listExpenses() { return this.fetch("/api/expenses"); }, // returns { expenses, summary }
  setExpenseRepayment(id, done) {
    return this.fetch(`/api/expenses/${id}/repayment`, {
      method: "PATCH",
      body: JSON.stringify({ done })
    });
  },
```

- [ ] **Step 2: Verify the bundle still compiles**

Run: `npm --prefix client run build`
Expected: Vite build completes with no errors (the new methods are syntactically valid).

- [ ] **Step 3: Commit**

```bash
git add client/src/api.js
git commit -m "Expenses: client api methods (submit, list, set repayment)"
```

---

### Task 5: Public expense form on the login page

**Files:**
- Modify: `client/src/components/LoginScreen.jsx`

- [ ] **Step 1: Add a `todayStr` helper above the component**

In `client/src/components/LoginScreen.jsx`, after the imports and before `export function LoginScreen(...)`, add:

```js
// Local-time YYYY-MM-DD for the date input's default value.
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
```

- [ ] **Step 2: Add expense state inside the component**

Right after the existing forgot-password state declarations (the `const [forgotErr, setForgotErr] = useState(null);` line), add:

```js
  // Expense panel: anyone can record an expense without signing in.
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [exp, setExp] = useState({ amount: "", paidBy: "", date: todayStr(), repaymentDone: false });
  const [expState, setExpState] = useState("form"); // form | saving | done | error
  const [expErr, setExpErr] = useState(null);

  const resetExp = () => { setExp({ amount: "", paidBy: "", date: todayStr(), repaymentDone: false }); setExpState("form"); setExpErr(null); };
  const openExpense = () => { resetExp(); setExpenseOpen(true); };
  const closeExpense = () => { setExpenseOpen(false); resetExp(); };

  const submitExpense = async e => {
    e.preventDefault();
    const amt = Number(exp.amount);
    if (!Number.isFinite(amt) || amt <= 0 || !exp.paidBy.trim()) return;
    setExpState("saving"); setExpErr(null);
    try {
      await api.submitExpense({ amount: amt, paidBy: exp.paidBy.trim(), date: exp.date, repaymentDone: exp.repaymentDone });
      setExpState("done");
    } catch (err) {
      setExpErr(err.message || "Could not save expense");
      setExpState("error");
    }
  };
```

- [ ] **Step 3: Gate the sign-in form so the expense panel can replace it**

Find the sign-in form opening line:

```jsx
          {forgotState === "idle" && (
            <form onSubmit={submit}>
```

Change the condition to also require the expense panel to be closed:

```jsx
          {forgotState === "idle" && !expenseOpen && (
            <form onSubmit={submit}>
```

- [ ] **Step 4: Add the "Submit an expense" link under the Continue button**

Find the Continue button at the end of the sign-in form:

```jsx
              <button className="btn-primary w-full justify-center" disabled={busy}>
                {busy ? "Signing in…" : <>Continue <ArrowRight size={16} /></>}
              </button>
            </form>
          )}
```

Change to add the link before `</form>`:

```jsx
              <button className="btn-primary w-full justify-center" disabled={busy}>
                {busy ? "Signing in…" : <>Continue <ArrowRight size={16} /></>}
              </button>
              <div className="text-center mt-6">
                <button type="button" onClick={openExpense}
                  className="text-xs opacity-60 hover:opacity-100 underline">
                  Submit an expense →
                </button>
              </div>
            </form>
          )}
```

- [ ] **Step 5: Add the expense form + success panels**

Immediately after the sign-in form block (the `)}` that closes `{forgotState === "idle" && !expenseOpen && ( … )}`), insert:

```jsx
          {expenseOpen && expState !== "done" && (
            <form onSubmit={submitExpense}>
              <div className="font-display text-2xl sm:text-3xl mb-2">Submit an expense</div>
              <div className="text-sm opacity-60 mb-8">No sign-in needed — just record the details.</div>

              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Amount (₹)</label>
              <input type="number" min="0" step="0.01" value={exp.amount}
                onChange={e => setExp({ ...exp, amount: e.target.value })}
                className="w-full mb-5" required autoFocus />

              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Paid By</label>
              <input type="text" value={exp.paidBy}
                onChange={e => setExp({ ...exp, paidBy: e.target.value })}
                className="w-full mb-5" maxLength={191} required />

              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Date</label>
              <input type="date" value={exp.date}
                onChange={e => setExp({ ...exp, date: e.target.value })}
                className="w-full mb-5" required />

              <label className="flex items-center gap-2 mb-6 text-sm cursor-pointer">
                <input type="checkbox" checked={exp.repaymentDone}
                  onChange={e => setExp({ ...exp, repaymentDone: e.target.checked })} />
                Repayment done
              </label>

              {expErr && (
                <div className="text-xs px-3 py-2 rounded mb-4"
                  style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>
                  {expErr}
                </div>
              )}

              <div className="flex gap-2">
                <button type="button" className="btn-ghost" onClick={closeExpense}>
                  <ArrowLeft size={14} /> Back
                </button>
                <button className="btn-primary flex-1 justify-center"
                  disabled={expState === "saving" || !exp.paidBy.trim() || !(Number(exp.amount) > 0)}>
                  {expState === "saving" ? "Saving…" : <>Record expense <ArrowRight size={14} /></>}
                </button>
              </div>
            </form>
          )}

          {expenseOpen && expState === "done" && (
            <div className="anim-in">
              <div className="font-display text-2xl sm:text-3xl mb-2">Recorded ✓</div>
              <div className="text-sm opacity-70 mb-6 leading-relaxed">Your expense has been saved. Thank you.</div>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={closeExpense}>
                  <ArrowLeft size={14} /> Back to sign-in
                </button>
                <button className="btn-primary flex-1 justify-center" onClick={resetExp}>
                  Submit another <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}
```

- [ ] **Step 6: Verify in the browser**

Start the app: `npm run dev` (from repo root; starts API on :5001 + Vite on :5173, with MySQL running).
- Open http://localhost:5173 → on the sign-in panel, click **"Submit an expense →"**.
- Fill Amount `250.75`, Paid By `Test Payer`, leave Date as today, leave Repayment unchecked → click **Record expense**.
- Expected: the panel switches to **"Recorded ✓"**.
- Click **Back to sign-in** → the normal sign-in form returns.

(Verify with the preview tools: `preview_snapshot` after each step; `preview_console_logs` shows no errors; `preview_network` shows `POST /api/expenses → 201`.)

- [ ] **Step 7: Commit**

```bash
git add client/src/components/LoginScreen.jsx
git commit -m "Expenses: public submit form on the login page"
```

---

### Task 6: Admin consolidated Expenses view

**Files:**
- Modify: `client/src/App.jsx` (icon import + route line + tile + new component)

- [ ] **Step 1: Import the `Wallet` icon**

In `client/src/App.jsx`, find the end of the lucide-react import:

```js
  KeyRound
} from "lucide-react";
```

Change to:

```js
  KeyRound, Wallet
} from "lucide-react";
```

- [ ] **Step 2: Add the route line in `AdminView`**

Find (around line 994):

```js
  if (tab === "emails") return <AdminEmails {...props} back={() => setTab("home")} />;
```

Add directly after it:

```js
  if (tab === "expenses") return <AdminExpenses {...props} back={() => setTab("home")} />;
```

- [ ] **Step 3: Add the dashboard tile**

Find the last entry of the `tiles` array in `AdminView`:

```js
    { key: "emails", icon: Mail, title: "Email log", desc: "Inspect every notification sent by SignFlow.", badge: emails.length }
  ];
```

Change to (add a comma and the new tile):

```js
    { key: "emails", icon: Mail, title: "Email log", desc: "Inspect every notification sent by SignFlow.", badge: emails.length },
    { key: "expenses", icon: Wallet, title: "Expenses", desc: "Consolidated expense submissions, with repayment tracking." }
  ];
```

- [ ] **Step 4: Add the `AdminExpenses` component**

In `client/src/App.jsx`, immediately after the `AdminEmails` function closes (the `}` ending `AdminEmails`, around line 2289), add:

```js
function AdminExpenses({ notify, back }) {
  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState({ count: 0, total: 0, repaid: 0, outstanding: 0 });
  const [filter, setFilter] = useState("all"); // all | outstanding | repaid

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listExpenses();
      setExpenses(data.expenses || []);
      setSummary(data.summary || { count: 0, total: 0, repaid: 0, outstanding: 0 });
    } catch (e) {
      notify?.(e.message || "Could not load expenses", "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (exp) => {
    try {
      await api.setExpenseRepayment(exp.id, !exp.repaymentDone);
      await load();
    } catch (e) {
      notify?.(e.message || "Could not update repayment", "error");
    }
  };

  const inr = n => `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const shown = expenses.filter(e =>
    filter === "all" ? true : filter === "repaid" ? e.repaymentDone : !e.repaymentDone
  );

  return (
    <div>
      <BackHeader back={back} title="Expenses" step={`${summary.count} recorded`} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <div className="card p-5">
          <div className="text-[10px] tracking-wider uppercase opacity-50">Entries</div>
          <div className="font-display text-2xl mt-1">{summary.count}</div>
        </div>
        <div className="card p-5">
          <div className="text-[10px] tracking-wider uppercase opacity-50">Total</div>
          <div className="font-display text-2xl mt-1">{inr(summary.total)}</div>
        </div>
        <div className="card p-5">
          <div className="text-[10px] tracking-wider uppercase opacity-50">Repaid</div>
          <div className="font-display text-2xl mt-1" style={{ color: "var(--c-forest)" }}>{inr(summary.repaid)}</div>
        </div>
        <div className="card p-5">
          <div className="text-[10px] tracking-wider uppercase opacity-50">Outstanding</div>
          <div className="font-display text-2xl mt-1" style={{ color: "var(--c-rust)" }}>{inr(summary.outstanding)}</div>
        </div>
      </div>

      <div className="flex gap-2 mt-8 mb-4">
        {["all", "outstanding", "repaid"].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded text-sm capitalize ${filter === f ? "btn-primary" : "btn-ghost"}`}>
            {f}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-12 text-[10px] tracking-wider uppercase opacity-50 px-5 py-3 border-b" style={{ borderColor: "var(--c-ink-08)" }}>
          <div className="col-span-2">Date</div>
          <div className="col-span-4">Paid by</div>
          <div className="col-span-2">Amount</div>
          <div className="col-span-2">Repayment</div>
          <div className="col-span-2">Submitted</div>
        </div>
        {loading ? (
          <div className="p-10 text-center opacity-50 text-sm">Loading…</div>
        ) : shown.length === 0 ? (
          <div className="p-10 text-center opacity-50 text-sm">No expenses{filter !== "all" ? ` (${filter})` : ""} yet.</div>
        ) : shown.map((e, i) => (
          <div key={e.id} className={`grid grid-cols-12 items-center px-5 py-4 ${i > 0 ? "border-t" : ""}`} style={{ borderColor: "rgba(15,26,46,.06)" }}>
            <div className="col-span-2 text-sm">{e.date}</div>
            <div className="col-span-4 font-medium text-sm truncate">{e.paidBy}</div>
            <div className="col-span-2 font-mono text-sm">{inr(e.amount)}</div>
            <div className="col-span-2">
              <button onClick={() => toggle(e)}
                className={`pill ${e.repaymentDone ? "pill-approved" : "pill-rejected"}`}
                title="Click to toggle repayment">
                {e.repaymentDone ? "Repaid" : "Outstanding"}
              </button>
            </div>
            <div className="col-span-2 text-xs opacity-50">{fmtShort(e.createdAt)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify in the browser**

With `npm run dev` running and at least one expense submitted (from Task 5):
- Sign in as admin (`it@hqhb.in`).
- On the Administration dashboard, click the **Expenses** tile.
- Expected: summary cards show Entries/Total/Repaid/Outstanding; the table lists submitted expenses (Date, Paid by, Amount in ₹, Repayment pill, Submitted time).
- Click an **Outstanding** pill → it flips to **Repaid**, and the Repaid/Outstanding totals update.
- Switch the **all / outstanding / repaid** filter → the table filters accordingly.

(Verify with preview tools: `preview_snapshot` of the Expenses view; `preview_click` the repayment pill then `preview_snapshot` to confirm the flip; `preview_console_logs` clean.)

- [ ] **Step 6: Commit**

```bash
git add client/src/App.jsx
git commit -m "Expenses: admin consolidated view with repayment toggle"
```

---

## Self-Review

**Spec coverage:**
- Capture Amount / Paid By / Date / Repayment Done → Task 1 (validation) + Task 2 (columns) + Task 5 (form fields). ✓
- Public submission from the login page, no auth → Task 3 (public POST) + Task 5 (login-page form). ✓
- Admin-only consolidated view under `it@hqhb.in` → Task 3 (`requireRole("admin")` GET) + Task 6 (Expenses tile/view, admin role only). ✓
- Admin can flip Repayment Done → Task 3 (PATCH) + Task 6 (toggle pill). ✓
- ₹ display, free-text Paid By, checkbox default-off → Task 5 (form) + Task 6 (`inr` formatting). ✓
- DECIMAL amount, idempotent table, epoch-ms `created_at` → Task 2. ✓
- Server-side validation → Task 1 + Task 3. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code; every command lists expected output. ✓

**Type consistency:** Validator returns `{ amount, paidBy, expenseDate, repaymentDone }`; the route reads exactly those keys. API responses use `{ id, amount, paidBy, date, repaymentDone, createdAt }` + `summary { count, total, repaid, outstanding }`; `AdminExpenses` reads exactly those. Client `submitExpense` sends `{ amount, paidBy, date, repaymentDone }`; the server validates those keys. ✓

---

## Notes / Assumptions

- **Ports:** dev API on `:5001` (Vite proxy target), app on `:5173`. MySQL must be running for any server-side step.
- **Public write endpoint:** `POST /api/expenses` is intentionally unauthenticated. Acceptable for an internal tool; add `express-rate-limit` if it ever faces the open internet.
- **No badge on the Expenses tile:** the view is self-contained and fetches its own data, so `AdminView` needs no extra wiring. (A count badge would require loading expenses at the `App` level — deferred as YAGNI.)
