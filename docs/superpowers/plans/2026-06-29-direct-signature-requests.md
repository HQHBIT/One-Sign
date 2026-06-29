# Direct (Person-to-Person) Signature Requests — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a requestor send a signature request to **one specific person — any user, regardless of team or role** — by searching the directory, picking them, placing a signature box, and submitting; the recipient then sees it under "Awaiting your signature" and signs it with the existing review-and-sign UI.

**Architecture:** A "direct" request reuses the existing multi-step machinery (`request_steps` + `request_step_signers`) with **one step, `team_id = NULL`, one signer**, and `requests.target_team_id = NULL`. The signing path (`approveWorkflowStep`) is **already identity-based** (`signer.user_id === req.user.id`) — so the only backend blockers are the `requireRole("approver")` guards on the approve/reject routes and the requestor list query, which we relax. Creation skips the approver-role / team-authority / signer-signature checks that the team-workflow path enforces. Frontend adds a third New-Request mode ("Send to a specific person") and an "Awaiting your signature" surface for requestors that reuses the role-agnostic `ApproveDrawer`.

**Tech Stack:** Node.js + Express + mysql2 (ESM), React 18 + Vite. Backend verified by an integration script against the running stack; frontend verified in-browser (create as one user, sign as another).

**Scope decision:** One signer per direct request (matches "request a signature *to that individual*"). The data model already supports multiple signers in order, so multi-signer is a future extension of the same code with no schema change.

---

## File structure

| File | Modify/Create | Responsibility |
| --- | --- | --- |
| `server/src/db.js` | Modify | make `request_steps.team_id` nullable |
| `server/src/routes/users.js` | Modify | `GET /search` directory lookup |
| `server/src/routes/requests.js` | Modify | direct-create path; relax approve/reject gates; list includes signer-requests |
| `server/test/direct.integration.mjs` | Create | end-to-end backend check |
| `client/src/api.js` | Modify | `searchUsers`; `createRequest` gains `direct`/`signers` |
| `client/src/forms/NewRequest.jsx` | Modify | "Send to a specific person" mode |
| `client/src/App.jsx` | Modify | requestor "Awaiting your signature" surface + `AwaitingSignatureList` |

---

### Task 1: Schema — `request_steps.team_id` nullable

**Files:** Modify `server/src/db.js`

- [ ] **Step 1: Add the idempotent ALTER**

Find the two columns added in Phase 1:

```js
  // Self-registration: carry the applicant's typed context onto the approved user.
  await tryExec(`ALTER TABLE users ADD COLUMN reporting_manager VARCHAR(191) DEFAULT NULL`);
  await tryExec(`ALTER TABLE users ADD COLUMN requested_team VARCHAR(191) DEFAULT NULL`);
```

Add directly after them:

```js

  // Direct (person-to-person) requests: a step has no team.
  await tryExec(`ALTER TABLE request_steps MODIFY COLUMN team_id VARCHAR(64) NULL`);
```

- [ ] **Step 2: Verify syntax**

Run: `node --check server/src/db.js`
Expected: no output. (The live ALTER is exercised when the server restarts in Task 5.)

- [ ] **Step 3: Commit**

```bash
git add server/src/db.js
git commit -m "Direct requests: make request_steps.team_id nullable"
```

---

### Task 2: Directory search endpoint

**Files:** Modify `server/src/routes/users.js`

- [ ] **Step 1: Add `GET /search` right after the list route**

Find the list route (ends at the line with `res.json({ users });` then `});`):

```js
router.get("/", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const rows = await query("SELECT * FROM users ORDER BY created_at DESC");
    const users = await Promise.all(rows.map(hydrateUser));
    res.json({ users });
  } catch (e) { next(e); }
});
```

Add directly after it:

```js

// ---------- directory search (any authenticated user) ----------
// GET /api/users/search?q=  — up to 10 users whose name or email contains q
// (case-insensitive, q length >= 2). Minimal fields; excludes the caller.
// Powers the "send to a specific person" request flow. Declared before any
// "/:id" routes so the literal path is never shadowed.
router.get("/search", authRequired, async (req, res, next) => {
  try {
    const q = (req.query.q || "").toString().trim();
    if (q.length < 2) return res.json({ users: [] });
    const like = `%${q}%`;
    const rows = await query(
      `SELECT id, name, email, signature_path FROM users
       WHERE id <> ? AND (name LIKE ? OR email LIKE ?)
       ORDER BY name ASC LIMIT 10`,
      [req.user.id, like, like]
    );
    res.json({ users: rows.map(r => ({ id: r.id, name: r.name, email: r.email, hasSignature: !!r.signature_path })) });
  } catch (e) { next(e); }
});
```

- [ ] **Step 2: Verify syntax**

Run: `node --check server/src/routes/users.js`
Expected: no output. (Exercised live in Task 5.)

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/users.js
git commit -m "Direct requests: directory search endpoint"
```

---

### Task 3: Direct-create path in requests.js

**Files:** Modify `server/src/routes/requests.js`

- [ ] **Step 1: Let the direct path skip the creator-signature requirement**

Find (top of `POST /`):

```js
router.post("/", authRequired, requireRole("requestor"), upload.single("file"), async (req, res, next) => {
  try {
    if (!req.user.hasSignature) return res.status(400).json({ error: "Add your signature first" });
```

Change the `if` line to:

```js
router.post("/", authRequired, requireRole("requestor"), upload.single("file"), async (req, res, next) => {
  try {
    const isDirect = req.body?.direct === "true" || req.body?.direct === true;
    // A direct request only routes a document to someone else to sign — the
    // sender isn't signing, so they don't need a signature of their own.
    if (!isDirect && !req.user.hasSignature) return res.status(400).json({ error: "Add your signature first" });
```

- [ ] **Step 2: Branch to the direct path before the legacy path**

Find:

```js
    if (Array.isArray(workflow) && workflow.length > 0) {
      return await createWorkflowRequest({ req, res, file, ext, fileType, note, instantApproval, workflow, requestType });
    }

    // ---------- legacy single-marker single-team path ----------
```

Insert the direct branch between them:

```js
    if (Array.isArray(workflow) && workflow.length > 0) {
      return await createWorkflowRequest({ req, res, file, ext, fileType, note, instantApproval, workflow, requestType });
    }

    // ---------- direct (person-to-person) path ----------
    if (isDirect) {
      let signers = null;
      try { signers = JSON.parse(req.body.signers || "[]"); }
      catch { return res.status(400).json({ error: "signers must be valid JSON" }); }
      return await createDirectRequest({ req, res, file, ext, fileType, note, instantApproval, signers, requestType });
    }

    // ---------- legacy single-marker single-team path ----------
```

- [ ] **Step 3: Add the `createDirectRequest` function**

Find the end of `createWorkflowRequest` (the closing brace right before `async function notifyNextSigner`):

```js
  const row = await queryOne("SELECT * FROM requests WHERE id = ?", [id]);
  res.json({ request: await hydrateRequest(row) });
}

async function notifyNextSigner(requestId, fileName, requestorName) {
```

Insert the new function between them:

```js
  const row = await queryOne("SELECT * FROM requests WHERE id = ?", [id]);
  res.json({ request: await hydrateRequest(row) });
}

// Direct request: one step, no team, one (or more) arbitrary signers. Unlike the
// team-workflow path it does NOT require the signer to be an approver, to have
// team signing authority, or to already have a signature on file — the recipient
// adds a signature when they go to sign. PDF only (the signing path stamps PDFs).
async function createDirectRequest({ req, res, file, ext, fileType, note, instantApproval, signers, requestType = "general" }) {
  if (fileType !== "pdf") return res.status(400).json({ error: "Direct requests support PDF documents only" });
  if (!Array.isArray(signers) || signers.length === 0) return res.status(400).json({ error: "Add at least one recipient" });
  for (const [i, s] of signers.entries()) {
    if (!s.userId) return res.status(400).json({ error: `Recipient ${i + 1}: userId required` });
    if (typeof s.x !== "number" || typeof s.y !== "number" || typeof s.w !== "number" || typeof s.h !== "number") {
      return res.status(400).json({ error: `Recipient ${i + 1}: signature box not placed` });
    }
  }

  const userIds = [...new Set(signers.map(s => s.userId))];
  if (userIds.includes(req.user.id)) return res.status(400).json({ error: "You can't request a signature from yourself" });
  const userRows = await query(`SELECT id FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`, userIds);
  if (userRows.length !== userIds.length) return res.status(400).json({ error: "One or more recipients no longer exist" });

  const orientation = parseOrientation(req.body?.orientation);
  let bakedBuffer, pageRotations;
  try {
    ({ bakedBuffer, pageRotations } = await bakeRequestFile({ buffer: file.buffer, fileType, orientation }));
  } catch (e) {
    console.error("[create direct] bake failed", e);
    return res.status(400).json({ error: "Could not process PDF orientation" });
  }
  for (const s of signers) {
    const baked = transformMarkerForBake({ x: s.x, y: s.y, w: s.w, h: s.h, page: s.page || 1 }, pageRotations);
    s.x = baked.x; s.y = baked.y; s.w = baked.w; s.h = baked.h;
  }

  const id = uid();
  const storedName = `${id}.${ext}`;
  await fs.mkdir(DOC_DIR, { recursive: true });
  await fs.writeFile(path.join(DOC_DIR, storedName), bakedBuffer);

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`
      INSERT INTO requests (id, requestor_id, file_name, file_path, file_type, target_team_id, marker_json, note, status, created_at, instant_approval, current_step, request_type)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 'pending', ?, ?, 1, ?)
    `, [id, req.user.id, file.originalname, storedName, fileType, note, Date.now(), instantApproval, requestType]);

    const stepId = uid("st");
    await conn.execute(
      "INSERT INTO request_steps (id, request_id, step_order, team_id, status, created_at) VALUES (?, ?, 1, NULL, 'active', ?)",
      [stepId, id, Date.now()]
    );
    for (let j = 0; j < signers.length; j++) {
      const s = signers[j];
      await conn.execute(
        `INSERT INTO request_step_signers (id, step_id, signer_order, user_id, page, marker_x, marker_y, marker_w, marker_h, rotation, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [uid("sg"), stepId, j + 1, s.userId, s.page || 1, s.x, s.y, s.w, s.h, 0]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  await notifyNextSigner(id, file.originalname, req.user.name);
  const row = await queryOne("SELECT * FROM requests WHERE id = ?", [id]);
  res.json({ request: await hydrateRequest(row) });
}
```

- [ ] **Step 4: Verify syntax**

Run: `node --check server/src/routes/requests.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/requests.js
git commit -m "Direct requests: create path (no team / authority / signature checks)"
```

---

### Task 4: Relax sign/reject gates + show signer-requests to requestors

**Files:** Modify `server/src/routes/requests.js`

- [ ] **Step 1: Requestor list includes requests they must sign**

Find:

```js
    } else if (u.role === "requestor") {
      rows = await query("SELECT * FROM requests WHERE requestor_id = ? ORDER BY created_at DESC", [u.id]);
    } else {
```

Change to:

```js
    } else if (u.role === "requestor") {
      // Own requests PLUS any request where they are an assigned signer (direct requests).
      rows = await query(`
        SELECT DISTINCT r.* FROM requests r
        LEFT JOIN request_steps st ON st.request_id = r.id
        LEFT JOIN request_step_signers sg ON sg.step_id = st.id
        WHERE r.requestor_id = ? OR sg.user_id = ?
        ORDER BY r.created_at DESC
      `, [u.id, u.id]);
    } else {
```

- [ ] **Step 2: Allow any assigned signer to approve (not just approvers)**

Find the approve route signature:

```js
router.post("/:id/approve", authRequired, requireRole("approver"), async (req, res, next) => {
```

Change to (drop the role gate — authorization happens per-signer inside):

```js
router.post("/:id/approve", authRequired, async (req, res, next) => {
```

Then find, further down in the same handler, the legacy branch:

```js
    // Legacy single-marker
    if (!row.target_team_id || !row.marker_json) return res.status(400).json({ error: "Request misconfigured" });
    const auth = await queryOne("SELECT 1 AS ok FROM signing_authority WHERE user_id = ? AND team_id = ?", [req.user.id, row.target_team_id]);
```

Change to (re-assert approver-only for the team path, since the route no longer does):

```js
    // Legacy single-marker (team path) — still approver-only + team authority.
    if (req.user.role !== "approver") return res.status(403).json({ error: "Not authorised to sign this request" });
    if (!row.target_team_id || !row.marker_json) return res.status(400).json({ error: "Request misconfigured" });
    const auth = await queryOne("SELECT 1 AS ok FROM signing_authority WHERE user_id = ? AND team_id = ?", [req.user.id, row.target_team_id]);
```

- [ ] **Step 3: Allow any assigned signer to reject**

Find the reject route signature:

```js
router.post("/:id/reject", authRequired, requireRole("approver"), async (req, res, next) => {
```

Change to (the internal checks already gate by next-signer / team-authority / approver_id):

```js
router.post("/:id/reject", authRequired, async (req, res, next) => {
```

- [ ] **Step 4: Verify syntax**

Run: `node --check server/src/routes/requests.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/requests.js
git commit -m "Direct requests: any assigned signer can sign/reject; requestors see signer-requests"
```

---

### Task 5: Backend integration check

**Files:** Create `server/test/direct.integration.mjs`

This verifies search, direct creation, list visibility, and the relaxed authorization — without the heavy PDF-stamp path (the actual stamped signing is browser-verified in Task 9). The decisive assertion: a **requestor** recipient who hits approve gets the *signature* prompt (400), proving they passed the role gate that previously returned 403 Forbidden.

- [ ] **Step 1: Write the check**

```js
// Run against a RUNNING server (default :5001) + MySQL.
// Usage: node server/test/direct.integration.mjs
import { config } from "dotenv";
config({ path: "server/.env" });
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { PDFDocument } from "pdf-lib";

const BASE = process.env.API_BASE || "http://localhost:5001";
const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TS = Date.now();
const TARGET_ID = "u_directtgt_" + TS.toString(36);
const TARGET_EMAIL = "direct.target." + TS + "@hqhb.in";

let fail = 0;
const check = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fail++; };
const j = async r => ({ status: r.status, body: await r.json().catch(() => ({})) });
const tokenFor = id => jwt.sign({ sub: id }, SECRET, { expiresIn: "1h" });

const conn = await mysql.createConnection({ host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });

// A requestor sender (seeded) + a fresh requestor recipient with NO signature.
const [[sender]] = [await conn.execute("SELECT id FROM users WHERE role='requestor' ORDER BY created_at ASC LIMIT 1")].map(x => x[0]);
await conn.execute(
  "INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, 'x', 'Direct Target', 'requestor', ?)",
  [TARGET_ID, TARGET_EMAIL, TS]
);
const senderTok = tokenFor(sender.id);
const targetTok = tokenFor(TARGET_ID);

// 1) search finds the new user
const search = await j(await fetch(`${BASE}/api/users/search?q=direct.target`, { headers: { Authorization: `Bearer ${senderTok}` } }));
const found = (search.body.users || []).some(u => u.id === TARGET_ID);
check("search finds the recipient", search.status === 200 && found);

// 2) create a direct request (minimal 1-page PDF) to the target
const pdf = await PDFDocument.create(); pdf.addPage([600, 800]);
const pdfBytes = await pdf.save();
const fd = new FormData();
fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "direct-test.pdf");
fd.append("direct", "true");
fd.append("signers", JSON.stringify([{ userId: TARGET_ID, page: 1, x: 20, y: 70, w: 25, h: 8 }]));
fd.append("requestType", "general");
const create = await j(await fetch(`${BASE}/api/requests`, { method: "POST", headers: { Authorization: `Bearer ${senderTok}` }, body: fd }));
const reqId = create.body?.request?.id;
const wf = create.body?.request?.workflow || [];
check("create direct -> ok with one team-less step+signer",
  create.status === 200 && !!reqId && wf.length === 1 && wf[0].teamId == null
  && wf[0].signers?.length === 1 && wf[0].signers[0].userId === TARGET_ID);

// 3) the target sees it in their list; an unrelated approver does not
const targetList = await j(await fetch(`${BASE}/api/requests`, { headers: { Authorization: `Bearer ${targetTok}` } }));
check("recipient sees the request", (targetList.body.requests || []).some(r => r.id === reqId));

const [[approver]] = [await conn.execute("SELECT id FROM users WHERE role='approver' ORDER BY created_at ASC LIMIT 1")].map(x => x[0]);
if (approver) {
  const approverList = await j(await fetch(`${BASE}/api/requests`, { headers: { Authorization: `Bearer ${tokenFor(approver.id)}` } }));
  check("unrelated approver does NOT see it", !(approverList.body.requests || []).some(r => r.id === reqId));
}

// 4) the recipient (a requestor, no signature) reaches the sign logic -> 400 "signature",
//    NOT 403 Forbidden. This proves the approver-only gate was relaxed.
const tryApprove = await j(await fetch(`${BASE}/api/requests/${reqId}/approve`, { method: "POST", headers: { Authorization: `Bearer ${targetTok}` } }));
check("recipient reaches sign logic (400 signature, not 403)",
  tryApprove.status === 400 && /signature/i.test(tryApprove.body.error || ""));

// cleanup
if (reqId) {
  await conn.execute("DELETE sg FROM request_step_signers sg JOIN request_steps st ON st.id=sg.step_id WHERE st.request_id=?", [reqId]);
  await conn.execute("DELETE FROM request_steps WHERE request_id=?", [reqId]);
  await conn.execute("DELETE FROM requests WHERE id=?", [reqId]);
}
await conn.execute("DELETE FROM users WHERE id=?", [TARGET_ID]);
await conn.end();

console.log(fail ? `\n${fail} check(s) failed` : "\nAll direct-request checks passed");
process.exitCode = fail ? 1 : 0;
```

- [ ] **Step 2: Restart the server, then run**

The server must be restarted to pick up Tasks 1–4. Stop the old one and start fresh (MySQL up):

```bash
# stop whatever is on :5001, then:
npm --prefix server start   # in a background terminal
```

Then: `node server/test/direct.integration.mjs`
Expected: five `PASS` lines + `All direct-request checks passed`.

- [ ] **Step 3: Commit**

```bash
git add server/test/direct.integration.mjs
git commit -m "Direct requests: backend integration check"
```

---

### Task 6: Client api methods

**Files:** Modify `client/src/api.js`

- [ ] **Step 1: Extend `createRequest` and add `searchUsers`**

Find:

```js
  createRequest({ file, targetTeamId, marker, workflow, instantApproval, note, requestType }) {
    const fd = new FormData();
    fd.append("file", file, file.name);
    if (workflow) fd.append("workflow", JSON.stringify(workflow));
    if (targetTeamId) fd.append("targetTeamId", targetTeamId);
    if (marker) fd.append("marker", JSON.stringify(marker));
    if (instantApproval) fd.append("instantApproval", "true");
    if (note) fd.append("note", note);
    if (requestType) fd.append("requestType", requestType);
    return this.fetch("/api/requests", { method: "POST", body: fd });
  },
```

Change to:

```js
  createRequest({ file, targetTeamId, marker, workflow, direct, signers, instantApproval, note, requestType }) {
    const fd = new FormData();
    fd.append("file", file, file.name);
    if (workflow) fd.append("workflow", JSON.stringify(workflow));
    if (direct) fd.append("direct", "true");
    if (signers) fd.append("signers", JSON.stringify(signers));
    if (targetTeamId) fd.append("targetTeamId", targetTeamId);
    if (marker) fd.append("marker", JSON.stringify(marker));
    if (instantApproval) fd.append("instantApproval", "true");
    if (note) fd.append("note", note);
    if (requestType) fd.append("requestType", requestType);
    return this.fetch("/api/requests", { method: "POST", body: fd });
  },
  searchUsers(q) { return this.fetch(`/api/users/search?q=${encodeURIComponent(q)}`).then(r => r.users); },
```

- [ ] **Step 2: Verify + commit**

Run: `node --check client/src/api.js`
Expected: no output.

```bash
git add client/src/api.js
git commit -m "Direct requests: client api (searchUsers + createRequest direct/signers)"
```

---

### Task 7: "Send to a specific person" mode in NewRequest

**Files:** Modify `client/src/forms/NewRequest.jsx`

- [ ] **Step 1: Import the api**

Find:

```js
import { STEP_COLORS, REQUEST_TYPES } from "../lib/constants.js";
import { BackHeader } from "../components/BackHeader.jsx";
import { Section } from "../components/Section.jsx";
```

Add after them:

```js
import { api } from "../api.js";
```

- [ ] **Step 2: Add direct-mode state**

Find:

```js
  // workflow mode: [{teamId, signers: [{userId, page, x, y, w, h}]}]
  const [workflow, setWorkflow] = useState([]);
  const [placingSlot, setPlacingSlot] = useState(null); // {stepIdx, signerIdx}
```

Add after it:

```js

  // direct mode: search the directory + pick ONE person, place ONE marker
  const [directSigner, setDirectSigner] = useState(null); // {id, name, email, hasSignature}
  const [directQuery, setDirectQuery] = useState("");
  const [directResults, setDirectResults] = useState([]);
  const [directSearching, setDirectSearching] = useState(false);
```

- [ ] **Step 3: Debounced directory search effect**

Directly after the direct-mode state block from Step 2, add:

```js

  // Debounced directory search for "send to a specific person".
  useEffect(() => {
    if (mode !== "direct") return;
    const q = directQuery.trim();
    if (q.length < 2) { setDirectResults([]); setDirectSearching(false); return; }
    setDirectSearching(true);
    const t = setTimeout(async () => {
      try { setDirectResults(await api.searchUsers(q)); }
      catch { setDirectResults([]); }
      finally { setDirectSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [directQuery, mode]);
```

- [ ] **Step 4: Reset the chosen signer whenever the file changes**

In `handleFile`, find:

```js
      setFile({ name: f.name, base64: reader.result, type: f.type, ext, blob: f });
      setMarker(null);
      setWorkflow([]);
      setPlacingSlot(null);
```

Change to:

```js
      setFile({ name: f.name, base64: reader.result, type: f.type, ext, blob: f });
      setMarker(null);
      setWorkflow([]);
      setPlacingSlot(null);
      setDirectSigner(null);
```

- [ ] **Step 5: Marker helpers handle direct like single**

Find `allMarkers`:

```js
  const allMarkers = useMemo(() => {
    if (mode === "single") {
      if (!marker) return [];
      return [{ ...marker, label: "SIGN HERE" }];
    }
    const out = [];
```

Change to:

```js
  const allMarkers = useMemo(() => {
    if (mode === "single") {
      if (!marker) return [];
      return [{ ...marker, label: "SIGN HERE" }];
    }
    if (mode === "direct") {
      if (!marker) return [];
      return [{ ...marker, label: directSigner ? directSigner.name : "SIGN HERE" }];
    }
    const out = [];
```

And add `directSigner` to its dependency array — find:

```js
  }, [mode, marker, workflow, teams]);
```

Change to:

```js
  }, [mode, marker, workflow, teams, directSigner]);
```

In `onAddMarker`, find:

```js
  const onAddMarker = (page, x, y, w, h) => {
    if (mode === "single") {
      setMarker({ page, x, y, w, h });
      return;
    }
```

Change the condition to:

```js
  const onAddMarker = (page, x, y, w, h) => {
    if (mode === "single" || mode === "direct") {
      setMarker({ page, x, y, w, h });
      return;
    }
```

In `onUpdateMarker`, find:

```js
  const onUpdateMarker = (markerId, patch) => {
    if (mode === "single") {
      setMarker(prev => prev ? { ...prev, ...patch } : prev);
      return;
    }
```

Change to:

```js
  const onUpdateMarker = (markerId, patch) => {
    if (mode === "single" || mode === "direct") {
      setMarker(prev => prev ? { ...prev, ...patch } : prev);
      return;
    }
```

In `onDeleteMarker`, find:

```js
  const onDeleteMarker = (markerId) => {
    if (mode === "single") { setMarker(null); return; }
```

Change to:

```js
  const onDeleteMarker = (markerId) => {
    if (mode === "single" || mode === "direct") { setMarker(null); return; }
```

- [ ] **Step 6: Submittable flag + submit branch**

Find:

```js
  const canSubmitWorkflow = effectiveFile && workflow.length > 0
    && workflow.every(st => st.teamId && st.signers.length > 0
        && st.signers.every(s => s.userId && s.x != null));
```

Add after it:

```js
  const canSubmitDirect = effectiveFile && file?.ext === "pdf" && !!directSigner && !!marker;
```

Find the submit branch:

```js
      if (mode === "single") {
        if (!canSubmitSingle) { notify("Complete all steps first", "error"); return; }
        const submitMarker = isLeave ? { page: 1, x: 30, y: 85, w: 22, h: 6 } : marker;
        await addRequest({ file: submitFile, targetTeamId: targetTeam, marker: submitMarker, instantApproval, note, requestType });
      } else {
        if (!canSubmitWorkflow) { notify("Complete the workflow — every signer needs a placed signature", "error"); return; }
        await addRequest({ file: submitFile, workflow, instantApproval, note, requestType });
      }
```

Change to:

```js
      if (mode === "single") {
        if (!canSubmitSingle) { notify("Complete all steps first", "error"); return; }
        const submitMarker = isLeave ? { page: 1, x: 30, y: 85, w: 22, h: 6 } : marker;
        await addRequest({ file: submitFile, targetTeamId: targetTeam, marker: submitMarker, instantApproval, note, requestType });
      } else if (mode === "direct") {
        if (!canSubmitDirect) { notify("Pick a person and place their signature box", "error"); return; }
        await addRequest({ file: submitFile, direct: true, signers: [{ userId: directSigner.id, page: marker.page, x: marker.x, y: marker.y, w: marker.w, h: marker.h }], instantApproval, note, requestType });
      } else {
        if (!canSubmitWorkflow) { notify("Complete the workflow — every signer needs a placed signature", "error"); return; }
        await addRequest({ file: submitFile, workflow, instantApproval, note, requestType });
      }
```

- [ ] **Step 7: Add the third mode button**

Find the mode selector grid:

```js
              <div className="grid sm:grid-cols-2 gap-3">
                <button onClick={() => setMode("single")}
                  className={`card p-4 text-left tile-hover ${mode === "single" ? "ring-2" : ""}`}
                  style={{ borderColor: mode === "single" ? "#B8894A" : undefined, backgroundColor: mode === "single" ? "rgba(184,137,74,.08)" : undefined }}>
                  <Stamp size={18} className="mb-3 opacity-70" />
                  <div className="font-medium">Single approver</div>
                  <div className="text-xs opacity-60 mt-1">Any approver from one team can sign.</div>
                </button>
                <button onClick={() => setMode("workflow")}
                  className={`card p-4 text-left tile-hover ${mode === "workflow" ? "ring-2" : ""}`}
                  style={{ borderColor: mode === "workflow" ? "#B8894A" : undefined, backgroundColor: mode === "workflow" ? "rgba(184,137,74,.08)" : undefined }}>
                  <GitBranch size={18} className="mb-3 opacity-70" />
                  <div className="font-medium">Multi-step workflow</div>
                  <div className="text-xs opacity-60 mt-1">Specific signers across one or more teams, in order.</div>
                </button>
              </div>
```

Change to (`sm:grid-cols-2` → `sm:grid-cols-3`, add the direct button):

```js
              <div className="grid sm:grid-cols-3 gap-3">
                <button onClick={() => setMode("single")}
                  className={`card p-4 text-left tile-hover ${mode === "single" ? "ring-2" : ""}`}
                  style={{ borderColor: mode === "single" ? "#B8894A" : undefined, backgroundColor: mode === "single" ? "rgba(184,137,74,.08)" : undefined }}>
                  <Stamp size={18} className="mb-3 opacity-70" />
                  <div className="font-medium">Single approver</div>
                  <div className="text-xs opacity-60 mt-1">Any approver from one team can sign.</div>
                </button>
                <button onClick={() => setMode("workflow")}
                  className={`card p-4 text-left tile-hover ${mode === "workflow" ? "ring-2" : ""}`}
                  style={{ borderColor: mode === "workflow" ? "#B8894A" : undefined, backgroundColor: mode === "workflow" ? "rgba(184,137,74,.08)" : undefined }}>
                  <GitBranch size={18} className="mb-3 opacity-70" />
                  <div className="font-medium">Multi-step workflow</div>
                  <div className="text-xs opacity-60 mt-1">Specific signers across one or more teams, in order.</div>
                </button>
                <button onClick={() => setMode("direct")}
                  className={`card p-4 text-left tile-hover ${mode === "direct" ? "ring-2" : ""}`}
                  style={{ borderColor: mode === "direct" ? "#B8894A" : undefined, backgroundColor: mode === "direct" ? "rgba(184,137,74,.08)" : undefined }}>
                  <Send size={18} className="mb-3 opacity-70" />
                  <div className="font-medium">Send to a specific person</div>
                  <div className="text-xs opacity-60 mt-1">Search any user and request their signature directly.</div>
                </button>
              </div>
```

- [ ] **Step 8: Add the direct-mode section**

Find the start of the workflow section:

```js
          {/* 3b. workflow mode */}
          {!isLeave && effectiveFile && mode === "workflow" && (
```

Insert the direct-mode section directly before it:

```js
          {/* 3c. direct mode: pick a person + place marker */}
          {!isLeave && effectiveFile && mode === "direct" && (
            <Section n="03" title="Choose who should sign" desc="Search any user by name or email, then place their signature box.">
              {file.ext !== "pdf" ? (
                <div className="card p-4 text-sm" style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>
                  Direct requests support PDF documents only. Upload a PDF to use this mode.
                </div>
              ) : (
                <>
                  {!directSigner ? (
                    <div>
                      <input type="text" value={directQuery} onChange={e => setDirectQuery(e.target.value)}
                        className="w-full mb-3" placeholder="Search by name or email (min 2 characters)…" autoFocus />
                      {directSearching && <div className="text-xs opacity-50 px-1 mb-2">Searching…</div>}
                      {!directSearching && directQuery.trim().length >= 2 && directResults.length === 0 && (
                        <div className="text-xs opacity-50 px-1 mb-2">No user found for "{directQuery}".</div>
                      )}
                      <div className="space-y-1">
                        {directResults.map(u => (
                          <button key={u.id} onClick={() => { setDirectSigner(u); setDirectResults([]); setDirectQuery(""); }}
                            className="w-full text-left px-3 py-2 rounded card tile-hover flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate">{u.name}</div>
                              <div className="text-xs opacity-60 font-mono truncate">{u.email}</div>
                            </div>
                            {!u.hasSignature && <span className="pill pill-rejected text-[10px] shrink-0">no signature yet</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="card p-4 flex items-center gap-3 mb-4">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{directSigner.name}</div>
                        <div className="text-xs opacity-60 font-mono truncate">{directSigner.email}</div>
                      </div>
                      {!directSigner.hasSignature && <span className="pill pill-rejected text-[10px] shrink-0">no signature yet</span>}
                      <button className="btn-ghost text-xs shrink-0" onClick={() => { setDirectSigner(null); setMarker(null); }}>Change</button>
                    </div>
                  )}

                  {directSigner && (
                    <>
                      <Suspense fallback={<ViewerFallback />}>
                        <DocPreview file={file} markers={allMarkers} editable
                          onAddMarker={onAddMarker} onUpdateMarker={onUpdateMarker} onDeleteMarker={onDeleteMarker} />
                      </Suspense>
                      {marker
                        ? <div className="mt-3 text-xs font-mono opacity-60">Signature box placed on page {marker.page}.<button className="ml-2 underline" onClick={() => setMarker(null)}>Reset</button></div>
                        : <div className="mt-3 text-xs opacity-60">Click and drag on the document to place {directSigner.name}'s signature box.</div>}
                    </>
                  )}
                </>
              )}
            </Section>
          )}

          {/* 3b. workflow mode */}
          {!isLeave && effectiveFile && mode === "workflow" && (
```

- [ ] **Step 9: Include direct mode in the submit-section gate + button**

Find:

```js
          {/* 5. submit */}
          {effectiveFile && (mode === "single" ? ((isLeave || marker) && targetTeam) : workflow.length > 0) && (
            <Section n={isLeave ? "04" : (mode === "single" ? "05" : "04")} title="Add a note (optional)" desc="">
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className="w-full" placeholder="Context for the approver(s)…" />
              <div className="flex justify-end mt-4 gap-3">
                <button className="btn-ghost" onClick={onDone}>Cancel</button>
                <button className="btn-primary" onClick={submit} disabled={busy || !(mode === "single" ? canSubmitSingle : canSubmitWorkflow)}>
                  <Send size={14} /> {busy ? "Submitting…" : "Submit request"}
                </button>
              </div>
            </Section>
          )}
```

Change to:

```js
          {/* 5. submit */}
          {effectiveFile && (mode === "single" ? ((isLeave || marker) && targetTeam) : mode === "direct" ? (directSigner && marker) : workflow.length > 0) && (
            <Section n={isLeave ? "04" : (mode === "single" ? "05" : "04")} title="Add a note (optional)" desc="">
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className="w-full" placeholder="Context for the signer(s)…" />
              <div className="flex justify-end mt-4 gap-3">
                <button className="btn-ghost" onClick={onDone}>Cancel</button>
                <button className="btn-primary" onClick={submit} disabled={busy || !(mode === "single" ? canSubmitSingle : mode === "direct" ? canSubmitDirect : canSubmitWorkflow)}>
                  <Send size={14} /> {busy ? "Submitting…" : "Submit request"}
                </button>
              </div>
            </Section>
          )}
```

- [ ] **Step 10: Build (verified with Task 8 in Task 9)**

(No separate run here — Task 9 builds + browser-verifies the whole frontend. Commit now.)

```bash
git add client/src/forms/NewRequest.jsx
git commit -m "Direct requests: 'send to a specific person' mode in NewRequest"
```

---

### Task 8: "Awaiting your signature" surface for requestors

**Files:** Modify `client/src/App.jsx`

- [ ] **Step 1: Compute the awaiting list + route the tab in `RequestorView`**

Find the top of `RequestorView`:

```js
function RequestorView(props) {
  const { user, requests } = props;
  const [tab, setTab] = useState("home");
  const [newType, setNewType] = useState(null);
  const my = requests.filter(r => r.requestorId === user.id);
  const pending = my.filter(r => r.status === "pending");
  const approved = my.filter(r => r.status === "approved");
```

Change to:

```js
function RequestorView(props) {
  const { user, requests } = props;
  const [tab, setTab] = useState("home");
  const [newType, setNewType] = useState(null);
  const my = requests.filter(r => r.requestorId === user.id);
  const pending = my.filter(r => r.status === "pending");
  const approved = my.filter(r => r.status === "approved");
  // Requests sent directly to me where it's my turn to sign (computed from the
  // full list, not just my own requests).
  const awaitingMySig = requests.filter(r => {
    if (r.status !== "pending" || !r.workflow?.length) return false;
    const active = r.workflow.find(s => s.status === "active");
    const next = active?.signers?.find(s => s.status === "pending");
    return next?.userId === user.id;
  });
```

Find the tab routing:

```js
  if (tab === "new") return <NewRequest {...props} defaultType={newType} onDone={() => { setNewType(null); setTab("home"); }} />;
  if (tab === "pending") return <PendingList {...props} back={() => setTab("home")} items={pending.concat(my.filter(r => r.status === "approved_pending"))} />;
```

Add the awaiting-sig route after the `new` route:

```js
  if (tab === "new") return <NewRequest {...props} defaultType={newType} onDone={() => { setNewType(null); setTab("home"); }} />;
  if (tab === "awaiting-sig") return <AwaitingSignatureList {...props} back={() => setTab("home")} items={awaitingMySig} />;
  if (tab === "pending") return <PendingList {...props} back={() => setTab("home")} items={pending.concat(my.filter(r => r.status === "approved_pending"))} />;
```

- [ ] **Step 2: Add the dashboard tile**

Find the requestor tiles array:

```js
  const tiles = [
    { key: "new", icon: FilePlus, title: "Make a new request", desc: "Upload a document and route it for signing.", color: "var(--c-gold)" },
    { key: "pending", icon: Clock, title: "Pending requests", desc: "Track what's awaiting approval.", badge: pending.length + my.filter(r => r.status === "approved_pending").length },
    { key: "approved", icon: CheckCircle, title: "Approved requests", desc: "Download finalised, signed documents.", badge: approved.length }
  ];
```

(The first three properties may differ slightly in your copy — match on the `key` values.) Change to add the awaiting-sig tile between `new` and `pending`:

```js
  const tiles = [
    { key: "new", icon: FilePlus, title: "Make a new request", desc: "Upload a document and route it for signing.", color: "var(--c-gold)" },
    { key: "awaiting-sig", icon: Stamp, title: "Awaiting your signature", desc: "Requests sent directly to you to sign.", badge: awaitingMySig.length },
    { key: "pending", icon: Clock, title: "Pending requests", desc: "Track what's awaiting approval.", badge: pending.length + my.filter(r => r.status === "approved_pending").length },
    { key: "approved", icon: CheckCircle, title: "Approved requests", desc: "Download finalised, signed documents.", badge: approved.length }
  ];
```

- [ ] **Step 3: Add the `AwaitingSignatureList` component**

Directly before `function ApproverPending(` (the component opens at the line `function ApproverPending({ items, user, users, teams, ...`), insert:

```js
// Requestor-facing list of direct requests waiting for THIS user's signature.
// Reuses the role-agnostic ApproveDrawer for the actual review + sign.
function AwaitingSignatureList({ items, user, users, teams, approveRequest, rejectRequest, undoApproval, back, notify }) {
  const [openId, setOpenId] = useState(null);
  const open = items.find(r => r.id === openId);
  return (
    <div>
      <BackHeader back={back} title="Awaiting your signature" step={`${items.length} to sign`} />
      {items.length === 0 ? (
        <Empty icon={Inbox} text="No requests are waiting for your signature." />
      ) : (
        <div className="card mt-4 overflow-hidden">
          {items.map((r, i) => (
            <div key={r.id} className={`flex items-center ${i > 0 ? "border-t" : ""}`} style={{ borderColor: "var(--c-ink-08)" }}>
              <div className="flex-1">
                <RequestRow r={r} teams={teams} users={users} i={0}
                  actions={<button className="btn-primary text-xs" onClick={() => setOpenId(r.id)}>Review &amp; sign <ArrowRight size={12} /></button>} />
              </div>
            </div>
          ))}
        </div>
      )}
      {open && <ApproveDrawer req={open} user={user} users={users} teams={teams}
        approveRequest={approveRequest} rejectRequest={rejectRequest} undoApproval={undoApproval}
        onClose={() => setOpenId(null)} notify={notify} />}
    </div>
  );
}

```

- [ ] **Step 4: Commit** (built + verified in Task 9)

```bash
git add client/src/App.jsx
git commit -m "Direct requests: requestor 'Awaiting your signature' surface (reuses ApproveDrawer)"
```

---

### Task 9: Build + browser verification

**Files:** none (verification + final checks)

- [ ] **Step 1: Build the client**

Run: `npm --prefix client run build`
Expected: `✓ built` with exit 0 (no JSX/compile errors across NewRequest.jsx + App.jsx).

- [ ] **Step 2: Browser-verify the full flow**

With the dev stack running (API `:5001` + Vite `:5173`):
1. Sign in as a **requestor** (e.g. `mufaddal.safdari@hqhb.in`). New request → upload a PDF → **Send to a specific person** → search for another user (e.g. the approver or a second requestor) → pick them → place a signature box → Submit. Expect `POST /api/requests → 200` (network) and a success toast.
2. Sign in as **that recipient**. Home shows **Awaiting your signature** with a badge → open it → **Review & sign** → the `ApproveDrawer` renders the PDF + the placed box → approve. Expect `POST /api/requests/:id/approve → 200` and the request leaving the awaiting list. (If the recipient has no signature yet, the existing first-signature prompt appears — add one, then sign.)

Use `preview_snapshot` / `preview_eval` to drive and assert each step, and `preview_console_logs` (level error) — expect only the pre-existing Tile `key`-spread dev warning, nothing new.

- [ ] **Step 3: Clean up any test data**

Remove any requests/users created purely for verification (a short mysql2 script as in Phase 1), so the live DB isn't polluted.

- [ ] **Step 4: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "Direct requests: verification fixes"   # only if needed
```

---

## Self-Review

**Spec coverage (Feature B section of the design spec):**
- Third New-Request mode "Send to a specific person" → Task 7. ✓
- Search the directory by name/email → Task 2 (`GET /search`) + Task 6 (`searchUsers`) + Task 7 (search UI). ✓
- Add a signer + place a box + submit → Task 7 (single signer, one box). ✓
- Works regardless of team/role; signing authorized by "are you the assigned signer" → Task 3 (create skips authority) + Task 4 (approve/reject relaxed to identity). ✓
- "Awaiting your signature" for all roles, reusing the approver sign UI → Task 8 (`AwaitingSignatureList` + `ApproveDrawer`). ✓
- Direct requests reuse requests/steps/signers with NULL team → Task 1 (nullable `team_id`) + Task 3 (`createDirectRequest`). ✓
- Search excludes self; "No user found" empty state → Task 2 (`id <> ?`) + Task 7 (empty message). ✓
- A direct signer with no signature → prompted before signing → existing first-signature flow + the integration test asserts the 400 "signature" path. ✓

**Placeholder scan:** none — every step has complete code or an exact command + expected output.

**Type consistency:** the signer object shape `{ userId, page, x, y, w, h }` is identical across `createDirectRequest` (validation + INSERT), `api.createRequest` (`signers`), and `NewRequest` submit. The request object's `workflow[].signers[].{userId,status}` shape used by `AwaitingSignatureList`/`RequestorView` matches what `hydrateRequest` returns and what `ApproverPending` already consumes. The `direct` flag is a string `"true"` over the wire (FormData) and parsed as such on the server (`=== "true"`). ✓

---

## Risk notes
- **PDF-only:** the signing path (`approveWorkflowStep`/`stampPdfMulti`) stamps PDFs only, so direct requests are constrained to PDF at creation (`createDirectRequest`) and in the UI (Task 7). Excel direct requests are intentionally rejected.
- **Relaxed approve/reject routes:** removing `requireRole("approver")` is safe because the workflow/direct path authorizes per-signer (`signer.user_id === req.user.id`) and the legacy team path re-asserts `role === "approver"` + team authority (Task 4, Step 2). Reject's internal checks already gate by next-signer/authority/approver.
- **Self-registered users:** a brand-new requestor (Phase 1) with no signature can *send* a direct request (creator-signature requirement relaxed for direct), and is prompted to add a signature when they first need to *sign* one — consistent with the existing onboarding flow.
