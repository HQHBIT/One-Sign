# Self-Registration (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let new users self-register from the login page (Name, Email, Password, Team name, Reporting manager); the request waits as a pending registration; an admin approves on the console, which creates the user (role `requestor`) so they can sign in with the password they chose, or rejects with a reason.

**Architecture:** Pending sign-ups live in a new `registrations` table — never in `users` — so the existing login (which checks `users`) blocks them automatically until approval creates the user row. Public `POST /api/auth/register`; admin `GET/POST /api/registrations*`. Reuses the existing panel-state pattern in `LoginScreen.jsx` and the admin-tile pattern in `App.jsx`.

**Tech Stack:** Node.js + Express + mysql2 (ESM), bcryptjs, React 18 + Vite. Backend validation tested with Node's built-in `assert`; endpoints + UI verified against the running dev stack (API `:5001`, app `:5173`).

---

## File structure

| File | Create/Modify | Responsibility |
| --- | --- | --- |
| `server/src/registrationValidation.js` | Create | Pure `validateRegistration(body)` |
| `server/test/registrationValidation.test.mjs` | Create | `node assert` unit tests |
| `server/src/db.js` | Modify | `registrations` table + `users.reporting_manager`/`requested_team` |
| `server/src/routes/auth.js` | Modify | public `POST /register` |
| `server/src/routes/registrations.js` | Create | admin list/approve/reject |
| `server/src/index.js` | Modify | mount registrations router |
| `server/test/registrations.integration.mjs` | Create | end-to-end check |
| `client/src/api.js` | Modify | `register`/`listRegistrations`/`approve`/`reject` |
| `client/src/components/LoginScreen.jsx` | Modify | registration panel |
| `client/src/App.jsx` | Modify | Registrations tile + `AdminRegistrations` |

---

### Task 1: Registration validation helper (pure, TDD)

**Files:** Create `server/src/registrationValidation.js`; Test `server/test/registrationValidation.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import { validateRegistration } from "../src/registrationValidation.js";

// valid → normalised (trimmed, email lowercased)
{
  const r = validateRegistration({ name: "  Asha Rao ", email: "Asha.Rao@HQHB.in", password: "secret1", teamName: " Finance ", reportingManager: " Moiz " });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { name: "Asha Rao", email: "asha.rao@hqhb.in", password: "secret1", teamName: "Finance", reportingManager: "Moiz" });
}
assert.equal(validateRegistration({ name: "", email: "a@b.co", password: "secret1" }).ok, false);     // name required
assert.equal(validateRegistration({ name: "A", email: "not-an-email", password: "secret1" }).ok, false); // bad email
assert.equal(validateRegistration({ name: "A", email: "a@b.co", password: "short" }).ok, false);       // < 6 chars
// team/manager optional → default to ""
{
  const r = validateRegistration({ name: "A", email: "a@b.co", password: "secret1" });
  assert.equal(r.ok, true);
  assert.equal(r.value.teamName, "");
  assert.equal(r.value.reportingManager, "");
}
console.log("registrationValidation: all tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node server/test/registrationValidation.test.mjs`
Expected: FAIL — `Cannot find module '.../src/registrationValidation.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// Pure input validation for a self-registration submission. No DB, no framework.
const MAX = 191;

export function validateRegistration(body = {}) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };
  if (name.length > MAX) return { ok: false, error: `Name must be ${MAX} characters or fewer` };

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "A valid email is required" };
  if (email.length > MAX) return { ok: false, error: "Email is too long" };

  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters" };

  const teamName = typeof body.teamName === "string" ? body.teamName.trim().slice(0, MAX) : "";
  const reportingManager = typeof body.reportingManager === "string" ? body.reportingManager.trim().slice(0, MAX) : "";

  return { ok: true, value: { name, email, password, teamName, reportingManager } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node server/test/registrationValidation.test.mjs`
Expected: PASS — prints `registrationValidation: all tests passed`.

- [ ] **Step 5: Commit**

```bash
git add server/src/registrationValidation.js server/test/registrationValidation.test.mjs
git commit -m "Registration: pure validation helper + unit tests"
```

---

### Task 2: Schema — `registrations` table + `users` columns

**Files:** Modify `server/src/db.js`

- [ ] **Step 1: Add the table to the `stmts` array in `runSchema()`**

Find the last array element (the `request_step_signers` table) ending with:

```js
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  ];
```

Change to append a comma and the new table:

```js
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS registrations (
      id                VARCHAR(64)  NOT NULL PRIMARY KEY,
      name              VARCHAR(191) NOT NULL,
      email             VARCHAR(191) NOT NULL,
      password_hash     VARCHAR(255) NOT NULL,
      team_name         VARCHAR(191) DEFAULT NULL,
      reporting_manager VARCHAR(191) DEFAULT NULL,
      status            ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      reject_reason     TEXT,
      created_at        BIGINT       NOT NULL,
      decided_at        BIGINT       DEFAULT NULL,
      decided_by        VARCHAR(64)  DEFAULT NULL,
      INDEX idx_registrations_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  ];
```

- [ ] **Step 2: Add idempotent `users` columns**

Find (near the other `tryExec` ALTERs, after the `fk_signers_user` re-add):

```js
  await tryExec(`ALTER TABLE request_step_signers ADD CONSTRAINT fk_signers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL`);
}
```

Change to:

```js
  await tryExec(`ALTER TABLE request_step_signers ADD CONSTRAINT fk_signers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL`);

  // Self-registration: carry the applicant's typed context onto the approved user.
  await tryExec(`ALTER TABLE users ADD COLUMN reporting_manager VARCHAR(191) DEFAULT NULL`);
  await tryExec(`ALTER TABLE users ADD COLUMN requested_team VARCHAR(191) DEFAULT NULL`);
}
```

- [ ] **Step 3: Verify on boot**

Ensure MySQL is running, then: `npm --prefix server start`
Expected: startup banner + `[db] MySQL connected …`, no schema error. Stop with Ctrl-C. (The integration test in Task 4 exercises the table.)

- [ ] **Step 4: Commit**

```bash
git add server/src/db.js
git commit -m "Registration: registrations table + users context columns"
```

---

### Task 3: Public `POST /api/auth/register`

**Files:** Modify `server/src/routes/auth.js`

- [ ] **Step 1: Add imports + the endpoint**

At the top of `server/src/routes/auth.js`, the imports currently are:

```js
import { Router } from "express";
import bcrypt from "bcryptjs";
import { queryOne, hydrateUser, execute } from "../db.js";
import { signToken, authRequired } from "../auth.js";
import { sendEmail } from "../email.js";
import { genTempPassword } from "./users.js";
```

Add the validator import after them:

```js
import { validateRegistration } from "../registrationValidation.js";
```

Then, immediately before `export default router;`, add:

```js
// ---------- public: self-registration ----------
// POST /api/auth/register  body: { name, email, password, teamName, reportingManager }
// Creates a PENDING registration. The user is not created and cannot sign in
// until an admin approves it. Rejects duplicate emails (existing user OR a
// pending registration) so people don't queue twice.
router.post("/register", async (req, res, next) => {
  try {
    const v = validateRegistration(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { name, email, password, teamName, reportingManager } = v.value;

    const existingUser = await queryOne("SELECT id FROM users WHERE LOWER(email) = LOWER(?)", [email]);
    if (existingUser) return res.status(409).json({ error: "An account with this email already exists" });
    const existingReg = await queryOne("SELECT id FROM registrations WHERE LOWER(email) = LOWER(?) AND status = 'pending'", [email]);
    if (existingReg) return res.status(409).json({ error: "A registration with this email is already awaiting approval" });

    const id = "r_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
    const hash = bcrypt.hashSync(password, 10);
    await execute(
      "INSERT INTO registrations (id, name, email, password_hash, team_name, reporting_manager, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
      [id, name, email, hash, teamName || null, reportingManager || null, Date.now()]
    );
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});
```

- [ ] **Step 2: Commit** (verified together with Task 4)

```bash
git add server/src/routes/auth.js
git commit -m "Registration: public register endpoint"
```

---

### Task 4: Admin registrations routes + mount + integration check

**Files:** Create `server/src/routes/registrations.js`; Modify `server/src/index.js`; Test `server/test/registrations.integration.mjs`

- [ ] **Step 1: Create the router**

```js
import { Router } from "express";
import { query, queryOne, execute } from "../db.js";
import { authRequired, requireRole } from "../auth.js";

const router = Router();

function hydrate(r) {
  return {
    id: r.id, name: r.name, email: r.email,
    teamName: r.team_name || "", reportingManager: r.reporting_manager || "",
    status: r.status, rejectReason: r.reject_reason || "",
    createdAt: Number(r.created_at),
    decidedAt: r.decided_at ? Number(r.decided_at) : null
  };
}

// ADMIN — list registrations (pending first, newest first) + pending count.
router.get("/", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const rows = await query("SELECT * FROM registrations ORDER BY (status = 'pending') DESC, created_at DESC");
    res.json({ registrations: rows.map(hydrate), pending: rows.filter(r => r.status === "pending").length });
  } catch (e) { next(e); }
});

// ADMIN — approve: create the user (role requestor) and mark approved.
router.post("/:id/approve", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const reg = await queryOne("SELECT * FROM registrations WHERE id = ?", [req.params.id]);
    if (!reg) return res.status(404).json({ error: "Registration not found" });
    if (reg.status !== "pending") return res.status(400).json({ error: "Already " + reg.status });

    const dup = await queryOne("SELECT id FROM users WHERE LOWER(email) = LOWER(?)", [reg.email]);
    if (dup) {
      await execute("UPDATE registrations SET status='rejected', reject_reason=?, decided_at=?, decided_by=? WHERE id=?",
        ["Email already a user", Date.now(), req.user.id, reg.id]);
      return res.status(409).json({ error: "A user with this email already exists" });
    }

    const userId = "u_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
    await execute(
      "INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, reporting_manager, requested_team) VALUES (?, ?, ?, ?, 'requestor', NULL, ?, ?, ?)",
      [userId, reg.email, reg.password_hash, reg.name, Date.now(), reg.reporting_manager, reg.team_name]
    );
    await execute("UPDATE registrations SET status='approved', decided_at=?, decided_by=? WHERE id=?",
      [Date.now(), req.user.id, reg.id]);
    res.json({ ok: true, userId });
  } catch (e) { next(e); }
});

// ADMIN — reject with an optional reason.
router.post("/:id/reject", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
    const reg = await queryOne("SELECT id, status FROM registrations WHERE id = ?", [req.params.id]);
    if (!reg) return res.status(404).json({ error: "Registration not found" });
    if (reg.status !== "pending") return res.status(400).json({ error: "Already " + reg.status });
    await execute("UPDATE registrations SET status='rejected', reject_reason=?, decided_at=?, decided_by=? WHERE id=?",
      [reason || null, Date.now(), req.user.id, req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
```

- [ ] **Step 2: Mount in `index.js`**

Add the import after `import adminRoutes from "./routes/admin.js";`:

```js
import registrationsRoutes from "./routes/registrations.js";
```

Find:

```js
  app.use("/api/requests", requestsRoutes);
  app.use("/api", adminRoutes);
```

Change to:

```js
  app.use("/api/requests", requestsRoutes);
  app.use("/api/registrations", registrationsRoutes);
  app.use("/api", adminRoutes);
```

- [ ] **Step 3: Create the integration check**

```js
// Run against a RUNNING server (default :5001) + MySQL.
// Usage: node server/test/registrations.integration.mjs
// Mints an admin token from the DB (independent of the admin password) and
// cleans up its own rows.
import { config } from "dotenv";
config({ path: "server/.env" });
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";

const BASE = process.env.API_BASE || "http://localhost:5001";
const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const EMAIL = "reg.test." + Date.now() + "@hqhb.in";
const PW = "regtest123";

let fail = 0;
const check = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fail++; };
const j = async r => ({ status: r.status, body: await r.json().catch(() => ({})) });

const conn = await mysql.createConnection({ host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const [admins] = await conn.execute("SELECT id FROM users WHERE role='admin' ORDER BY created_at ASC LIMIT 1");
const token = jwt.sign({ sub: admins[0].id }, SECRET, { expiresIn: "1h" });
const auth = { Authorization: `Bearer ${token}` };

// 1) public register — valid
const reg = await j(await fetch(`${BASE}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Reg Test", email: EMAIL, password: PW, teamName: "QA", reportingManager: "Lead" }) }));
check("register valid -> 201", reg.status === 201);

// 2) duplicate pending -> 409
const dupReg = await j(await fetch(`${BASE}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Reg Test", email: EMAIL, password: PW }) }));
check("duplicate pending -> 409", dupReg.status === 409);

// 3) cannot log in yet (no user row)
const preLogin = await j(await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PW }) }));
check("login before approval -> 401", preLogin.status === 401);

// 4) admin sees it pending
const list = await j(await fetch(`${BASE}/api/registrations`, { headers: auth }));
const mine = (list.body.registrations || []).find(r => r.email === EMAIL);
check("admin list shows pending", list.status === 200 && mine && mine.status === "pending");

// 5) approve -> user created
const appr = await j(await fetch(`${BASE}/api/registrations/${mine.id}/approve`, { method: "POST", headers: auth }));
check("approve -> ok", appr.status === 200 && appr.body.ok === true);

// 6) now login works with the chosen password
const postLogin = await j(await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PW }) }));
check("login after approval -> token", postLogin.status === 200 && !!postLogin.body.token);

// cleanup
await conn.execute("DELETE FROM users WHERE LOWER(email) = LOWER(?)", [EMAIL]);
await conn.execute("DELETE FROM registrations WHERE LOWER(email) = LOWER(?)", [EMAIL]);
await conn.end();

console.log(fail ? `\n${fail} check(s) failed` : "\nAll registration checks passed");
process.exitCode = fail ? 1 : 0;
```

- [ ] **Step 4: Run it**

Start the server (`npm --prefix server start`, MySQL up). In another terminal: `node server/test/registrations.integration.mjs`
Expected: six `PASS` lines + `All registration checks passed`.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/registrations.js server/src/index.js server/test/registrations.integration.mjs
git commit -m "Registration: admin routes (list/approve/reject) + integration check"
```

---

### Task 5: Client api methods

**Files:** Modify `client/src/api.js`

- [ ] **Step 1: Add the methods**

Find the auth section (after `forgotPassword(...)` / `changePassword(...)`). Immediately after the `changePassword` method's closing `},`, insert:

```js

  // -------- self-registration --------
  register({ name, email, password, teamName, reportingManager }) {
    return this.fetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password, teamName, reportingManager })
    });
  },
  listRegistrations() { return this.fetch("/api/registrations"); }, // { registrations, pending }
  approveRegistration(id) { return this.fetch(`/api/registrations/${id}/approve`, { method: "POST" }); },
  rejectRegistration(id, reason) {
    return this.fetch(`/api/registrations/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
  },
```

- [ ] **Step 2: Verify the bundle compiles**

Run: `node --check client/src/api.js`
Expected: no output (syntax OK).

- [ ] **Step 3: Commit**

```bash
git add client/src/api.js
git commit -m "Registration: client api methods"
```

---

### Task 6: Registration panel on the login page

**Files:** Modify `client/src/components/LoginScreen.jsx`

- [ ] **Step 1: Add registration state**

After the forgot-password state block (the line `const [forgotErr, setForgotErr] = useState(null);`), insert:

```js
  // Self-registration panel.
  const [regOpen, setRegOpen] = useState(false);
  const [reg, setReg] = useState({ name: "", email: "", password: "", teamName: "", reportingManager: "" });
  const [regState, setRegState] = useState("form"); // form | saving | done | error
  const [regErr, setRegErr] = useState(null);

  const resetReg = () => { setReg({ name: "", email: "", password: "", teamName: "", reportingManager: "" }); setRegState("form"); setRegErr(null); };
  const openReg = () => { resetReg(); setRegOpen(true); };
  const closeReg = () => { setRegOpen(false); resetReg(); };

  const submitReg = async e => {
    e.preventDefault();
    if (!reg.name.trim() || !reg.email.trim() || reg.password.length < 6) return;
    setRegState("saving"); setRegErr(null);
    try {
      await api.register({ name: reg.name.trim(), email: reg.email.trim(), password: reg.password, teamName: reg.teamName.trim(), reportingManager: reg.reportingManager.trim() });
      setRegState("done");
    } catch (err) {
      setRegErr(err.message || "Could not submit registration");
      setRegState("error");
    }
  };
```

- [ ] **Step 2: Gate the sign-in form so the panel can replace it**

Find:

```jsx
          {forgotState === "idle" && (
            <form onSubmit={submit}>
```

Change to:

```jsx
          {forgotState === "idle" && !regOpen && (
            <form onSubmit={submit}>
```

- [ ] **Step 3: Add the "Create an account" link under the Continue button**

Find the Continue button block:

```jsx
              <button className="btn-primary w-full justify-center" disabled={busy}>
                {busy ? "Signing in…" : <>Continue <ArrowRight size={16} /></>}
              </button>
            </form>
          )}
```

Change to:

```jsx
              <button className="btn-primary w-full justify-center" disabled={busy}>
                {busy ? "Signing in…" : <>Continue <ArrowRight size={16} /></>}
              </button>
              <div className="text-center mt-6">
                <button type="button" onClick={openReg}
                  className="text-xs opacity-60 hover:opacity-100 underline">
                  New here? Create an account →
                </button>
              </div>
            </form>
          )}
```

- [ ] **Step 4: Add the registration form + success panels**

Immediately after the `)}` that closes the sign-in form block (from Step 3), insert:

```jsx
          {regOpen && regState !== "done" && (
            <form onSubmit={submitReg}>
              <div className="font-display text-2xl sm:text-3xl mb-2">Create an account</div>
              <div className="text-sm opacity-60 mb-8">Your request goes to IT for approval. You'll be able to sign in once it's approved.</div>

              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Full name</label>
              <input type="text" value={reg.name} onChange={e => setReg({ ...reg, name: e.target.value })} className="w-full mb-4" maxLength={191} required autoFocus />

              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Work email</label>
              <input type="email" value={reg.email} onChange={e => setReg({ ...reg, email: e.target.value })} className="w-full mb-4" maxLength={191} required />

              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Password</label>
              <input type="password" value={reg.password} onChange={e => setReg({ ...reg, password: e.target.value })} className="w-full mb-4" placeholder="At least 6 characters" required />

              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Team / Department</label>
              <input type="text" value={reg.teamName} onChange={e => setReg({ ...reg, teamName: e.target.value })} className="w-full mb-4" maxLength={191} placeholder="e.g., Finance" />

              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Reporting manager</label>
              <input type="text" value={reg.reportingManager} onChange={e => setReg({ ...reg, reportingManager: e.target.value })} className="w-full mb-5" maxLength={191} placeholder="Manager's name" />

              {regErr && (
                <div className="text-xs px-3 py-2 rounded mb-4" style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>{regErr}</div>
              )}

              <div className="flex gap-2">
                <button type="button" className="btn-ghost" onClick={closeReg}><ArrowLeft size={14} /> Back</button>
                <button className="btn-primary flex-1 justify-center" disabled={regState === "saving" || !reg.name.trim() || !reg.email.trim() || reg.password.length < 6}>
                  {regState === "saving" ? "Submitting…" : <>Request access <ArrowRight size={14} /></>}
                </button>
              </div>
            </form>
          )}

          {regOpen && regState === "done" && (
            <div className="anim-in">
              <div className="font-display text-2xl sm:text-3xl mb-2">Request submitted ✓</div>
              <div className="text-sm opacity-70 mb-6 leading-relaxed">Thanks! IT will review your request. Once approved, sign in with the email and password you just chose.</div>
              <button className="btn-primary w-full justify-center" onClick={closeReg}><ArrowLeft size={14} /> Back to sign-in</button>
            </div>
          )}
```

- [ ] **Step 5: Verify in the browser**

Start the dev stack (`npm run dev` at repo root; MySQL up). Open http://localhost:5173 → click **"New here? Create an account →"** → fill the form → **Request access** → expect **"Request submitted ✓"**. (`preview_snapshot` after each step; `preview_network` shows `POST /api/auth/register → 201`; `preview_console_logs` clean.)

- [ ] **Step 6: Commit**

```bash
git add client/src/components/LoginScreen.jsx
git commit -m "Registration: create-an-account panel on the login page"
```

---

### Task 7: Admin Registrations view

**Files:** Modify `client/src/App.jsx`

- [ ] **Step 1: Add the route line in `AdminView`**

Find:

```js
  if (tab === "emails") return <AdminEmails {...props} back={() => setTab("home")} />;
```

Add directly after it:

```js
  if (tab === "registrations") return <AdminRegistrations {...props} back={() => setTab("home")} />;
```

- [ ] **Step 2: Add the dashboard tile**

Find the last tile entry:

```js
    { key: "emails", icon: Mail, title: "Email log", desc: "Inspect every notification sent by SignFlow.", badge: emails.length }
    // DISABLED: expense feature commented out — Expenses dashboard tile
```

Change the `emails` line to add a comma and insert the registrations tile:

```js
    { key: "emails", icon: Mail, title: "Email log", desc: "Inspect every notification sent by SignFlow.", badge: emails.length },
    { key: "registrations", icon: UserPlus, title: "Registrations", desc: "Approve or reject new self-sign-up requests." }
    // DISABLED: expense feature commented out — Expenses dashboard tile
```

- [ ] **Step 3: Add the `AdminRegistrations` component**

Immediately after the `AdminEmails` function closes (its final `}` near the `<pre>{open.body}</pre>` block), add:

```js
function AdminRegistrations({ notify, back }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [pending, setPending] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listRegistrations();
      setItems(data.registrations || []);
      setPending(data.pending || 0);
    } catch (e) {
      notify?.(e.message || "Could not load registrations", "error");
    } finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const approve = async (r) => {
    try { await api.approveRegistration(r.id); notify?.(`${r.name} approved — they can now sign in.`, "success"); await load(); }
    catch (e) { notify?.(e.message || "Could not approve", "error"); }
  };
  const reject = async (r) => {
    const reason = window.prompt(`Reject ${r.name}'s registration? Optional reason:`, "");
    if (reason === null) return;
    try { await api.rejectRegistration(r.id, reason); notify?.(`${r.name}'s registration rejected.`, "info"); await load(); }
    catch (e) { notify?.(e.message || "Could not reject", "error"); }
  };

  const pillFor = s => s === "pending" ? "pill-pending" : s === "approved" ? "pill-approved" : "pill-rejected";

  return (
    <div>
      <BackHeader back={back} title="Registrations" step={`${pending} pending`} />
      <div className="card mt-4 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center opacity-50 text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center opacity-50 text-sm">No registration requests yet.</div>
        ) : items.map((r, i) => (
          <div key={r.id} className={`px-5 py-4 flex items-start gap-4 ${i > 0 ? "border-t" : ""}`} style={{ borderColor: "rgba(15,26,46,.06)" }}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{r.name}</span>
                <span className={`pill ${pillFor(r.status)}`}>{r.status}</span>
              </div>
              <div className="text-xs opacity-60 font-mono mt-1">{r.email}</div>
              <div className="text-xs opacity-60 mt-1">
                Team: {r.teamName || "—"} · Manager: {r.reportingManager || "—"} · {fmtShort(r.createdAt)}
                {r.status === "rejected" && r.rejectReason ? ` · Reason: ${r.rejectReason}` : ""}
              </div>
            </div>
            {r.status === "pending" && (
              <div className="flex gap-2 shrink-0">
                <button className="btn-ghost text-xs" onClick={() => reject(r)}>Reject</button>
                <button className="btn-primary text-xs" onClick={() => approve(r)}><Check size={13} /> Approve</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify in the browser**

With `npm run dev` running and a pending registration (from Task 6): sign in as admin → **Registrations** tile → see the pending request → **Approve** → it flips to `approved`. Then sign out and sign in as the newly-approved user with the email + password from Task 6 → expect success. (`preview_snapshot` of the view; `preview_click` Approve then `preview_snapshot`; `preview_console_logs` clean.)

- [ ] **Step 5: Commit**

```bash
git add client/src/App.jsx
git commit -m "Registration: admin Registrations view (approve/reject)"
```

---

## Self-Review

**Spec coverage:**
- Self-register form (Name/Email/Password/Team/Manager) → Task 1 (validation) + Task 6 (form). ✓
- Pending store + login gate → Task 2 (table) + Task 3 (insert) + integration "login before approval -> 401". ✓
- Admin sees + approves/rejects → Task 4 (routes) + Task 7 (view). ✓
- Approved user signs in with chosen password → Task 4 approve (inserts `password_hash` from registration) + integration "login after approval -> token". ✓
- DB tables updated with details → Task 2 (`registrations` + `users.reporting_manager`/`requested_team`); approve carries them over. ✓

**Placeholder scan:** none — every code step is complete; commands list expected output.

**Type consistency:** registration object keys `{ name, email, password, teamName, reportingManager }` are identical across the validator, the endpoint, `api.register`, and the form. The API response shape `{ registrations:[{id,name,email,teamName,reportingManager,status,rejectReason,createdAt,decidedAt}], pending }` matches `AdminRegistrations`. ✓

---

## Notes
- **Phase 2 (direct person-to-person signature requests)** is a separate plan, written after Phase 1 is built and verified.
- Self-registration is a public write endpoint — the approval gate contains spam; a rate-limit / invite code is a future hardening.
- The approve step deliberately sets `role = requestor` and `team_id = NULL`; IT assigns the real team/role afterward in Users.
