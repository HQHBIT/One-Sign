# Expense Tracker — Design Spec

- **Date:** 2026-06-16
- **Status:** Approved (design)
- **Scope:** A lightweight expense-capture feature added *inside* HQHB SignFlow.

## 1. Problem & Goal

HQHB needs a simple way to record expenses and track repayments. Anyone should be
able to submit an expense from the SignFlow **login page without logging in**. The
admin (`it@hqhb.in`) reviews every submission in one **consolidated** place.

## 2. Requirements

Captured per expense (exactly these four fields):

- **Amount** — money paid
- **Paid By** — who paid
- **Date** — the date of the expense
- **Repayment Done** — whether the payer has been reimbursed

Functional:

- Public submission from the login page — no authentication.
- Admin-only consolidated view, visible only to `it@hqhb.in` (the `admin` role).
- Admin can flip "Repayment Done" as reimbursements happen.

Non-goals (YAGNI):

- No accounts for submitters, no categories, no receipts/attachments, no approvals,
  no multi-currency.
- No editing or deleting of a submitted amount in v1 — only the repayment flag is mutable.

## 3. Decisions

- **Currency:** ₹ INR, display-only. Stored as a plain `DECIMAL` number.
- **Paid By:** free-text input (the payer may not be a system user).
- **Repayment Done:** checkbox on the form (defaults to unchecked); admin can toggle later.
- Built inside SignFlow, reusing its MySQL DB, Express server, and React client.

## 4. Data Model

New table `expenses`, added as an idempotent `CREATE TABLE IF NOT EXISTS` block in
`runSchema()` in [db.js](../../../server/src/db.js), matching the existing style:

| Column           | Type                    | Notes                          |
| ---------------- | ----------------------- | ------------------------------ |
| `id`             | `INT AUTO_INCREMENT` PK | like `emails` / `reminders`    |
| `amount`         | `DECIMAL(12,2) NOT NULL`| money, not float               |
| `paid_by`        | `VARCHAR(191) NOT NULL` | free text, trimmed             |
| `expense_date`   | `DATE NOT NULL`         | user-picked calendar date      |
| `repayment_done` | `TINYINT(1) NOT NULL DEFAULT 0` | yes / no               |
| `created_at`     | `BIGINT NOT NULL`       | submission time, epoch ms      |

## 5. Backend — `server/src/routes/expenses.js` (new)

Mounted in [index.js](../../../server/src/index.js): `app.use("/api/expenses", expensesRoutes)`.

| Method  | Path                            | Auth        | Purpose                          |
| ------- | ------------------------------- | ----------- | -------------------------------- |
| `POST`  | `/api/expenses`                 | **public**  | submit one expense               |
| `GET`   | `/api/expenses`                 | admin only  | list all + summary, newest first |
| `PATCH` | `/api/expenses/:id/repayment`   | admin only  | flip repayment done/not-done     |

Admin routes reuse `authRequired, requireRole("admin")` exactly like
[admin.js](../../../server/src/routes/admin.js).

- **POST** body `{ amount, paidBy, date, repaymentDone }`:
  - Validate: `amount` is a finite number > 0; `paidBy` non-empty after trim, ≤ 191 chars;
    `date` parses to a valid `YYYY-MM-DD`; `repaymentDone` coerced to 0/1.
  - Insert with `created_at = Date.now()`. Return `{ ok: true }`.
  - On validation failure: `400 { error: "<message>" }`.
- **GET** returns `{ expenses: [...], summary: { count, total, repaid, outstanding } }`.
- **PATCH** body `{ done: boolean }`; `404` if id not found; returns `{ ok: true }`.

Per-expense response shape:
`{ id, amount (number), paidBy, date ("YYYY-MM-DD"), repaymentDone (bool), createdAt (number) }`.

## 6. Frontend

### `client/src/api.js`

- `submitExpense({ amount, paidBy, date, repaymentDone })` → `POST /api/expenses`
- `listExpenses()` → `GET /api/expenses` (returns `{ expenses, summary }`)
- `setExpenseRepayment(id, done)` → `PATCH /api/expenses/:id/repayment`

### `client/src/components/LoginScreen.jsx`

Add an `expense` branch to the existing right-panel state machine (today driven by
`forgotState`):

- A link under the Sign-in form: **"Submit an expense →"**.
- The form: Amount (number), Paid By (text), Date (date input, default = today),
  Repayment Done (checkbox).
- Client-side guard: amount > 0 and Paid By non-empty before enabling submit (UX only).
- On success: a **"Recorded ✓"** confirmation with "Submit another" and "Back to sign-in".
- Mirrors the visual + state pattern already used for forgot-password.

### `client/src/App.jsx` — `AdminExpenses`

- New tile in the `AdminView` tiles array:
  `{ key: "expenses", icon: Wallet, title: "Expenses", desc: "Consolidated expense submissions.", badge: <count> }`.
- New route line: `if (tab === "expenses") return <AdminExpenses {...props} back={() => setTab("home")} />;`.
- `AdminExpenses` component (modeled on `AdminReports` / `AdminEmails`):
  - Loads via `api.listExpenses()` on mount.
  - Summary cards: Count, Total ₹, Repaid ₹, Outstanding ₹.
  - Filter: All / Outstanding / Repaid.
  - Table: Date, Paid By, Amount (₹), Repayment (toggle), Submitted-at.
  - Per-row toggle calls `setExpenseRepayment` then refreshes.

## 7. Validation & Safety

- All validation enforced **server-side** (client checks are UX only).
- The POST is a **public write endpoint** — acceptable for an internal tool. Future note:
  add `express-rate-limit` if it ever faces the open internet.
- Amounts stored as `DECIMAL` to avoid float rounding.

## 8. Testing

- **Backend:** a Node script that POSTs valid + invalid payloads, logs in as admin,
  GETs the list, and asserts the valid row round-trips, totals compute correctly, and
  PATCH flips the flag.
- **Frontend:** manual verification via `npm run dev` — submit from the login page,
  confirm the row appears in the admin Expenses view with correct totals, toggle
  repayment and confirm it persists across reload.

## 9. Files Touched

- `server/src/db.js` — add `expenses` table to `runSchema()`.
- `server/src/routes/expenses.js` — **new**.
- `server/src/index.js` — mount the router.
- `client/src/api.js` — three methods.
- `client/src/components/LoginScreen.jsx` — expense mode + form + success screen.
- `client/src/App.jsx` — `AdminExpenses` component + tile + route line.
