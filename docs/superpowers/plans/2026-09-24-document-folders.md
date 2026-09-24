# Document Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every person file their finished documents into personal, one-level folders by drag-and-drop (or a "Move to…" menu), on every approved/signed list.

**Architecture:** Two new tables (`folders`, `folder_items`) keyed per person, a small `/api/folders` route scoped to the signed-in user, a `useFolders` hook that keeps folders/placements in the browser with optimistic updates, and a `FolderedList` component that wraps the two existing finished-document lists (`ApprovedList`, `ApproverApproved`) with a folder strip, drop targets and a "Move to…" menu.

**Tech Stack:** Node/Express ESM + MySQL (mysql2) on the server; React 18 + Vite + Tailwind + lucide-react on the client; integration tests are plain Node scripts that spawn the API (pattern: `server/test/issues.integration.mjs`); browser checks via the Playwright install in the scratchpad.

**Spec:** `docs/superpowers/specs/2026-09-24-document-folders-design.md`

**Branch:** `feature/document-folders` (from `origin/master` — the live sites deploy from `master`, not `UAT`). Work in the `D:\OneSign-master` worktree. `node_modules` there are junctions — never `git worktree remove` it.

---

## File map

| File | Responsibility |
|---|---|
| `server/src/db.js` | two new tables, created at boot like every other table |
| `server/src/routes/requests.js` | export `authoriseAccess` (one-line change) |
| `server/src/routes/folders.js` | **new** — the five folder calls |
| `server/src/index.js` | mount `/api/folders` |
| `server/src/routes/users.js` | `mergeUsers` carries folders and placements to the keeper |
| `server/test/folders.integration.mjs` | **new** — server behaviour, isolation, merge |
| `client/src/api.js` | five folder calls |
| `client/src/lib/useFolders.js` | **new** — state + optimistic mutations |
| `client/src/components/BackHeader.jsx` | an `actions` slot beside the count |
| `client/src/components/RequestRow.jsx` | optional drag source |
| `client/src/components/FolderStrip.jsx` | **new** — tiles, create/rename/delete, drop targets |
| `client/src/components/MoveToMenu.jsx` | **new** — the per-row "Move to…" menu |
| `client/src/components/FolderedList.jsx` | **new** — composes strip + filtered list; used by both lists |
| `client/src/App.jsx` | `ApprovedList` and `ApproverApproved` render through `FolderedList` |

---

### Task 1: The two tables

**Files:**
- Modify: `server/src/db.js` (after the `issue_reports` block, ~line 452)

- [ ] **Step 1: Add the tables to `runSchema()`**

Find the line `await tryExec("ALTER TABLE issue_reports ADD COLUMN attachments_json TEXT DEFAULT NULL");` (or, if that line is absent on this branch, the closing of the `issue_reports` CREATE) and add directly after it:

```js
  // Personal folders for finished documents. Filing is PER PERSON: the same
  // document appears in the requestor's list and in each signer's, and one
  // person's tidying must not rearrange anyone else's screen — so placement
  // lives in folder_items keyed by (user, request), not on the request.
  //
  // The primary key on folder_items is what makes "one folder per document"
  // a rule the database keeps, not one the screen remembers to follow. The
  // cascades do the housekeeping: delete a folder and its documents fall back
  // into the main list; delete a document or a user and the placements go.
  await tryExec(`CREATE TABLE IF NOT EXISTS folders (
    id          VARCHAR(64)  NOT NULL PRIMARY KEY,
    user_id     VARCHAR(64)  NOT NULL,
    org_id      VARCHAR(32)  DEFAULT NULL,
    name        VARCHAR(60)  NOT NULL,
    created_at  BIGINT       NOT NULL,
    UNIQUE KEY uq_folders_user_name (user_id, name),
    INDEX idx_folders_user (user_id),
    CONSTRAINT fk_folders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await tryExec(`CREATE TABLE IF NOT EXISTS folder_items (
    user_id     VARCHAR(64)  NOT NULL,
    request_id  VARCHAR(64)  NOT NULL,
    folder_id   VARCHAR(64)  NOT NULL,
    added_at    BIGINT       NOT NULL,
    PRIMARY KEY (user_id, request_id),
    INDEX idx_folder_items_folder (folder_id),
    CONSTRAINT fk_folder_items_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
    CONSTRAINT fk_folder_items_request FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_folder_items_folder  FOREIGN KEY (folder_id)  REFERENCES folders(id)  ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
```

The `utf8mb4_unicode_ci` collation makes the unique key case-insensitive, so "Finance" and "finance" collide, as the spec requires.

- [ ] **Step 2: Boot the server once so the tables are created**

Run (from `server/`): `node --env-file=.env -e "import('./src/db.js').then(async m => { await m.initDb(); const t = await m.query(\"SHOW TABLES LIKE 'folder%'\"); console.log(t); process.exit(0); })"`
Expected: two rows, `folder_items` and `folders`.

- [ ] **Step 3: Commit**

```bash
git add server/src/db.js
git commit -m "folders: two tables — a person's folders, and where each of their documents sits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The folders route, test first

**Files:**
- Create: `server/test/folders.integration.mjs`
- Create: `server/src/routes/folders.js`
- Modify: `server/src/routes/requests.js:743` (export `authoriseAccess`)
- Modify: `server/src/index.js:13,86` (import + mount)

- [ ] **Step 1: Write the failing test**

Create `server/test/folders.integration.mjs`:

```js
// Can a person file their finished documents into folders of their own — and
// only their own?
//
//   node test/folders.integration.mjs          (from server/, MySQL running)
//
// Starts its own API on a spare port with email and storage off. Requests are
// inserted directly: what is under test is filing, not the request lifecycle.
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..");
config({ path: path.join(SERVER, ".env") });

const PORT = 5000 + 80 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;

// Migrations first, from here, so the API is not running the same DDL at the
// same moment — two processes migrating at once wait on each other's locks.
const { initDb, query, execute, queryOne } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
const { mergeUsers } = await import("../src/routes/users.js");
await initDb();

const api = spawn(process.execPath, ["src/index.js"], {
  cwd: SERVER,
  env: { ...process.env, PORT: String(PORT), SENDGRID_API_KEY: "", STORAGE_BUCKET: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
api.stdout.on("data", (d) => { log += d; });
api.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
  if (i === 59) { console.log(log); throw new Error("API did not start"); }
}

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);
const T = Date.now().toString(36);
const U = `u_fld_req_${T}`, A = `u_fld_app_${T}`, O = `u_fld_other_${T}`, TEAM = `t_fld_${T}`;
const REQ1 = `req_fld1_${T}`, REQ2 = `req_fld2_${T}`, REQ_HIDDEN = `req_fldh_${T}`;
const json = (id) => ({ Authorization: "Bearer " + signToken(id), "Content-Type": "application/json" });
const call = (id, method, url, body) =>
  fetch(`${BASE}${url}`, { method, headers: json(id), body: body === undefined ? undefined : JSON.stringify(body) });
const folders = async (id) => (await call(id, "GET", "/api/folders")).json();

const cleanup = async () => {
  await execute("DELETE FROM folder_items WHERE user_id IN (?, ?, ?)", [U, A, O]);
  await execute("DELETE FROM folders WHERE user_id IN (?, ?, ?)", [U, A, O]);
  await execute("DELETE FROM requests WHERE id IN (?, ?, ?)", [REQ1, REQ2, REQ_HIDDEN]);
  await execute("DELETE FROM users WHERE id IN (?, ?, ?)", [U, A, O]);
  await execute("DELETE FROM teams WHERE id = ?", [TEAM]);
};

try {
  const hash = bcrypt.hashSync("x", 4);
  await execute("INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)", [TEAM, `Folder Probe ${T}`, Date.now()]);
  for (const [id, role, name] of [[U, "requestor", "Folder Requestor"], [A, "approver", "Folder Approver"], [O, "requestor", "Folder Outsider"]]) {
    await execute("INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
      [id, `${id}@folder.test`, hash, name, role, TEAM, Date.now()]);
  }
  // Two approved documents U raised and A signed, and one U has nothing to do with.
  for (const [id, requestor] of [[REQ1, U], [REQ2, U], [REQ_HIDDEN, O]]) {
    await execute(
      `INSERT INTO requests (id, requestor_id, file_name, file_path, file_type, target_team_id, marker_json, note, status, created_at, approver_id, approved_at, finalized_at)
       VALUES (?, ?, ?, ?, 'pdf', ?, '[]', '', 'approved', ?, ?, ?, ?)`,
      [id, requestor, `${id}.pdf`, `${id}.pdf`, TEAM, Date.now(), A, Date.now(), Date.now()]);
  }

  // ---- nothing yet ----
  let r = await call(U, "GET", "/api/folders");
  let b = await r.json();
  ck(r.status === 200 && Array.isArray(b.folders) && b.folders.length === 0, `a new person has no folders (${r.status})`);
  ck(b.placements && Object.keys(b.placements).length === 0, "and nothing filed");

  // ---- create ----
  r = await call(U, "POST", "/api/folders", { name: "  Finance   2026 " });
  b = await r.json();
  ck(r.status === 200 && b.folder?.id, `a folder is created (${r.status} ${b.error || ""})`);
  ck(b.folder?.name === "Finance 2026", `with its name tidied (${b.folder?.name})`);
  const FIN = b.folder?.id;
  ck((await call(U, "POST", "/api/folders", { name: "   " })).status === 400, "a blank name is refused");
  ck((await call(U, "POST", "/api/folders", { name: "x".repeat(61) })).status === 400, "a 61-character name is refused");
  r = await call(U, "POST", "/api/folders", { name: "finance 2026" });
  ck(r.status === 409, `the same name in different case is refused (${r.status})`);
  ck(/Finance 2026/.test((await r.json()).error || ""), "and the existing name is shown");
  r = await call(U, "POST", "/api/folders", { name: "Leave" });
  const LEAVE = (await r.json()).folder?.id;
  ck(!!LEAVE, "a second folder is created");

  // ---- file, move, unfile ----
  r = await call(U, "PUT", `/api/folders/items/${REQ1}`, { folderId: FIN });
  ck(r.status === 200, `a document is filed (${r.status})`);
  b = await folders(U);
  ck(b.placements[REQ1] === FIN, "and the placement is reported");
  ck(b.folders.find((f) => f.id === FIN)?.count === 1, `and the folder counts it (${b.folders.find((f) => f.id === FIN)?.count})`);

  await call(U, "PUT", `/api/folders/items/${REQ1}`, { folderId: LEAVE });
  b = await folders(U);
  ck(b.placements[REQ1] === LEAVE, "moving it to another folder replaces the placement");
  ck(b.folders.find((f) => f.id === FIN)?.count === 0 && b.folders.find((f) => f.id === LEAVE)?.count === 1, "and the counts follow");
  ck((await queryOne("SELECT COUNT(*) AS n FROM folder_items WHERE user_id = ? AND request_id = ?", [U, REQ1])).n === 1, "one placement row, not two");

  await call(U, "PUT", `/api/folders/items/${REQ1}`, { folderId: null });
  b = await folders(U);
  ck(!(REQ1 in b.placements), "unfiling removes the placement");

  // ---- delete a folder: documents return to the main list ----
  await call(U, "PUT", `/api/folders/items/${REQ1}`, { folderId: FIN });
  await call(U, "PUT", `/api/folders/items/${REQ2}`, { folderId: FIN });
  r = await call(U, "DELETE", `/api/folders/${FIN}`);
  ck(r.status === 200, `a folder is deleted (${r.status})`);
  b = await folders(U);
  ck(!b.folders.some((f) => f.id === FIN), "and is gone");
  ck(!(REQ1 in b.placements) && !(REQ2 in b.placements), "and its documents are back in the main list");
  ck((await queryOne("SELECT COUNT(*) AS n FROM requests WHERE id IN (?, ?)", [REQ1, REQ2])).n === 2, "the documents themselves are untouched");

  // ---- rename ----
  r = await call(U, "PUT", `/api/folders/${LEAVE}`, { name: "Leave forms" });
  ck(r.status === 200 && (await r.json()).folder?.name === "Leave forms", `a folder is renamed (${r.status})`);
  await call(U, "POST", "/api/folders", { name: "Travel" });
  ck((await call(U, "PUT", `/api/folders/${LEAVE}`, { name: "travel" })).status === 409, "renaming onto an existing name is refused");

  // ---- isolation: the same document, filed differently by two people ----
  r = await call(A, "POST", "/api/folders", { name: "Signed for Finance" });
  const A_FOLDER = (await r.json()).folder?.id;
  await call(A, "PUT", `/api/folders/items/${REQ1}`, { folderId: A_FOLDER });
  await call(U, "PUT", `/api/folders/items/${REQ1}`, { folderId: LEAVE });
  const uView = await folders(U), aView = await folders(A);
  ck(uView.placements[REQ1] === LEAVE && aView.placements[REQ1] === A_FOLDER, "the requestor and the signer file the same document differently");
  ck(!uView.folders.some((f) => f.id === A_FOLDER) && !aView.folders.some((f) => f.id === LEAVE), "and neither sees the other's folders");
  ck((await call(A, "PUT", `/api/folders/${LEAVE}`, { name: "Mine now" })).status === 404, "renaming someone else's folder is refused as not found");
  ck((await call(A, "DELETE", `/api/folders/${LEAVE}`)).status === 404, "deleting someone else's folder is refused as not found");
  ck((await call(A, "PUT", `/api/folders/items/${REQ2}`, { folderId: LEAVE })).status === 404, "filing into someone else's folder is refused as not found");
  ck((await folders(U)).placements[REQ1] === LEAVE, "and nothing of theirs changed");

  // ---- a document you cannot see cannot be filed ----
  ck((await call(U, "PUT", `/api/folders/items/${REQ_HIDDEN}`, { folderId: LEAVE })).status === 404, "filing a document you cannot see is refused");
  ck((await call(U, "PUT", `/api/folders/items/req_does_not_exist`, { folderId: LEAVE })).status === 404, "filing a document that does not exist is refused");

  // ---- signing in is required ----
  ck((await fetch(`${BASE}/api/folders`)).status === 401, "folders need a session");

  // ---- account merge carries folders and filing to the keeper ----
  await call(O, "POST", "/api/folders", { name: "Travel" });        // clashes with U's "Travel"
  r = await call(O, "POST", "/api/folders", { name: "Outsider only" });
  const O_ONLY = (await r.json()).folder?.id;
  await call(O, "PUT", `/api/folders/items/${REQ_HIDDEN}`, { folderId: O_ONLY });
  await mergeUsers(U, O);
  const merged = await folders(U);
  ck(merged.folders.some((f) => f.name === "Outsider only"), "the keeper inherits the duplicate's folders");
  ck(merged.folders.some((f) => f.name === "Travel") && merged.folders.some((f) => f.name === "Travel (2)"), "a clashing name is kept as '(2)' rather than lost");
  ck(merged.placements[REQ_HIDDEN] === O_ONLY, "and the duplicate's filing comes across");
  ck(merged.placements[REQ1] === LEAVE, "while the keeper's own filing is untouched");
} catch (e) {
  fail.push(`the run stopped early: ${e?.message || e}`);
} finally {
  for (const p of pass) console.log("  PASS  " + p);
  for (const f of fail) console.log("  FAIL  " + f);
  await cleanup().catch((e) => console.log("cleanup:", e.message));
  api.kill();
  console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
  if (fail.length) console.log(log.split("\n").filter((l) => /error|folders/i.test(l)).slice(-10).join("\n"));
  process.exit(fail.length ? 1 : 0);
}
```

Note `mergeUsers` is already exported from `server/src/routes/users.js` (line 810).

- [ ] **Step 2: Run it to confirm it fails**

Run (from `server/`): `node test/folders.integration.mjs`
Expected: many FAIL lines beginning with `a new person has no folders (404)` — the route does not exist yet. The merge checks at the end fail too.

- [ ] **Step 3: Export `authoriseAccess`**

In `server/src/routes/requests.js` line 743 change

```js
async function authoriseAccess(user, row) {
```
to
```js
export async function authoriseAccess(user, row) {
```

Nothing else in that file changes. (`routes/assist.js` already imports from `requests.js`, so importing from it elsewhere is established practice; `requests.js` imports nothing from the folders route, so there is no cycle.)

- [ ] **Step 4: Write the route**

Create `server/src/routes/folders.js`:

```js
// ============================================================
//   PERSONAL FOLDERS
//   ------------------------------------------------------------
//   A person files their finished documents into folders they name. Everything
//   here is scoped to the signed-in person: no call can name, read or change
//   anyone else's folder, and a folder that is not theirs answers 404 rather
//   than 403 so its existence is not confirmed.
//
//   Filing is an upsert on (user, request) — the table's primary key — which is
//   what makes "one folder per document" true without any checking here.
//   Deleting a folder deletes only the folder; the cascade drops its placement
//   rows and the documents reappear in the main list.
// ============================================================
import { Router } from "express";
import { query, queryOne, execute } from "../db.js";
import { authRequired } from "../auth.js";
import { deploymentOrg } from "../org.js";
import { authoriseAccess } from "./requests.js";

const router = Router();
const uid = () => `fld_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const MAX_NAME = 60;

// Trimmed and single-spaced, so "  Finance   2026 " and "Finance 2026" are the
// same folder and the unique key sees them that way.
const cleanName = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

const mine = (userId, id) => queryOne("SELECT id, name FROM folders WHERE id = ? AND user_id = ?", [id, userId]);

// A name the person already uses, other than the folder being renamed.
async function clash(userId, name, exceptId = null) {
  return queryOne(
    "SELECT id, name FROM folders WHERE user_id = ? AND name = ? AND id <> ?",
    [userId, name, exceptId || ""]);
}

function validName(name, res) {
  if (!name) { res.status(400).json({ error: "Give the folder a name" }); return false; }
  if (name.length > MAX_NAME) { res.status(400).json({ error: `Keep the name under ${MAX_NAME} characters` }); return false; }
  return true;
}

// GET /api/folders → { folders: [{ id, name, count }], placements: { requestId: folderId } }
// One round trip for everything a list screen needs. Counts are computed here
// each time, joined to requests so a placement whose document has gone is not
// counted; nothing is cached, so nothing can drift.
router.get("/", authRequired, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT f.id, f.name,
              (SELECT COUNT(*) FROM folder_items fi JOIN requests r ON r.id = fi.request_id
                WHERE fi.folder_id = f.id AND fi.user_id = f.user_id) AS count
         FROM folders f WHERE f.user_id = ? ORDER BY f.name`, [req.user.id]);
    const items = await query("SELECT request_id, folder_id FROM folder_items WHERE user_id = ?", [req.user.id]);
    const placements = {};
    for (const it of items) placements[it.request_id] = it.folder_id;
    res.json({ folders: rows.map((f) => ({ id: f.id, name: f.name, count: Number(f.count) })), placements });
  } catch (e) { next(e); }
});

// POST /api/folders { name } → { folder }
router.post("/", authRequired, async (req, res, next) => {
  try {
    const name = cleanName(req.body?.name);
    if (!validName(name, res)) return;
    const existing = await clash(req.user.id, name);
    if (existing) return res.status(409).json({ error: `You already have a folder called "${existing.name}"` });
    const id = uid();
    await execute("INSERT INTO folders (id, user_id, org_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
      [id, req.user.id, req.userRow?.org_id || deploymentOrg() || null, name, Date.now()]);
    res.json({ folder: { id, name, count: 0 } });
  } catch (e) { next(e); }
});

// PUT /api/folders/items/:requestId { folderId | null } — file, move or unfile.
// Declared before /:id so the path is never taken for a folder id.
router.put("/items/:requestId", authRequired, async (req, res, next) => {
  try {
    const row = await queryOne("SELECT * FROM requests WHERE id = ?", [req.params.requestId]);
    if (!row || !(await authoriseAccess(req.user, row))) return res.status(404).json({ error: "Not found" });
    const folderId = req.body?.folderId ? String(req.body.folderId) : null;
    if (folderId) {
      if (!(await mine(req.user.id, folderId))) return res.status(404).json({ error: "Not found" });
      await execute(
        `INSERT INTO folder_items (user_id, request_id, folder_id, added_at) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE folder_id = VALUES(folder_id), added_at = VALUES(added_at)`,
        [req.user.id, row.id, folderId, Date.now()]);
    } else {
      await execute("DELETE FROM folder_items WHERE user_id = ? AND request_id = ?", [req.user.id, row.id]);
    }
    res.json({ ok: true, requestId: row.id, folderId });
  } catch (e) { next(e); }
});

// PUT /api/folders/:id { name } → { folder }
router.put("/:id", authRequired, async (req, res, next) => {
  try {
    const folder = await mine(req.user.id, req.params.id);
    if (!folder) return res.status(404).json({ error: "Not found" });
    const name = cleanName(req.body?.name);
    if (!validName(name, res)) return;
    const existing = await clash(req.user.id, name, folder.id);
    if (existing) return res.status(409).json({ error: `You already have a folder called "${existing.name}"` });
    await execute("UPDATE folders SET name = ? WHERE id = ?", [name, folder.id]);
    res.json({ folder: { id: folder.id, name } });
  } catch (e) { next(e); }
});

// DELETE /api/folders/:id — the folder only; its documents return to the main list.
router.delete("/:id", authRequired, async (req, res, next) => {
  try {
    const folder = await mine(req.user.id, req.params.id);
    if (!folder) return res.status(404).json({ error: "Not found" });
    await execute("DELETE FROM folders WHERE id = ?", [folder.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
```

- [ ] **Step 5: Mount it**

In `server/src/index.js`, after `import issuesRoutes from "./routes/issues.js";` add:

```js
import foldersRoutes from "./routes/folders.js";
```

and after `app.use("/api/issues", issuesRoutes);` add:

```js
  app.use("/api/folders", foldersRoutes);
```

- [ ] **Step 6: Run the test again**

Run (from `server/`): `node test/folders.integration.mjs`
Expected: every check up to "folders need a session" passes; the four **merge** checks at the end still FAIL (Task 3 fixes those). If anything else fails, read the label — each one names what is wrong.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/folders.js server/src/routes/requests.js server/src/index.js server/test/folders.integration.mjs
git commit -m "folders: create, rename, delete, and file a document — one person's, and only theirs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Account merges carry folders to the keeper

**Files:**
- Modify: `server/src/routes/users.js` — inside `mergeUsers`, just before the comment `// 5. Carry the identity onto the keeper` (~line 855)

- [ ] **Step 1: Add the folder step to the merge transaction**

Insert before `// 5. Carry the identity onto the keeper`:

```js
    // 4b. Folders and filing. The keeper inherits the duplicate's folders; a
    //     name both accounts used is kept under "(2)" rather than dropped, so
    //     nothing anyone filed is lost. Where both accounts had filed the same
    //     document, the keeper's placement wins.
    const [loserFolders] = await conn.execute("SELECT id, name FROM folders WHERE user_id = ?", [loserId]);
    for (const f of loserFolders) {
      const [clashRows] = await conn.execute("SELECT id FROM folders WHERE user_id = ? AND name = ?", [survivorId, f.name]);
      if (clashRows.length) {
        await conn.execute("UPDATE folders SET name = ? WHERE id = ?", [`${f.name} (2)`.slice(0, 60), f.id]);
      }
    }
    [r] = await conn.execute("UPDATE folders SET user_id = ? WHERE user_id = ?", [survivorId, loserId]);
    moved.folders = r.affectedRows;
    await conn.execute(
      `DELETE fi FROM folder_items fi
         JOIN folder_items keep ON keep.request_id = fi.request_id AND keep.user_id = ?
        WHERE fi.user_id = ?`, [survivorId, loserId]);
    [r] = await conn.execute("UPDATE folder_items SET user_id = ? WHERE user_id = ?", [survivorId, loserId]);
    moved.folderItems = r.affectedRows;

```

- [ ] **Step 2: Run the folders test**

Run (from `server/`): `node test/folders.integration.mjs`
Expected: `… passed, 0 failed` — including the four merge checks.

- [ ] **Step 3: Run the existing merge test to be sure nothing else moved**

Run (from `server/`): `node --env-file=.env test/oneaccess-upsert.integration.mjs` (if this file starts its own API it passes on its own; if it expects one on :5001, start `npm start` in another terminal first).
Expected: passes as before.

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/users.js
git commit -m "folders: an account merge carries folders and filing to the keeper

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Client API calls and the `useFolders` hook

**Files:**
- Modify: `client/src/api.js` (after `issueReports()`, ~line 286)
- Create: `client/src/lib/useFolders.js`

- [ ] **Step 1: Add the calls**

In `client/src/api.js`, after the `issueReports()` line, add:

```js
  // -------- personal folders --------
  folders() { return this.fetch("/api/folders"); },                                   // { folders, placements }
  createFolder(name) { return this.fetch("/api/folders", { method: "POST", body: JSON.stringify({ name }) }).then(r => r.folder); },
  renameFolder(id, name) { return this.fetch(`/api/folders/${id}`, { method: "PUT", body: JSON.stringify({ name }) }).then(r => r.folder); },
  deleteFolder(id) { return this.fetch(`/api/folders/${id}`, { method: "DELETE" }); },
  // folderId null = back to the main list
  fileRequest(requestId, folderId) {
    return this.fetch(`/api/folders/items/${requestId}`, { method: "PUT", body: JSON.stringify({ folderId }) });
  },
```

- [ ] **Step 2: Write the hook**

Create `client/src/lib/useFolders.js`:

```js
// ============================================================
//   A PERSON'S FOLDERS, IN THE BROWSER
//   ------------------------------------------------------------
//   One load gives both the folders and where each document sits. Every change
//   is OPTIMISTIC: the screen moves first and the server is told after, so
//   dragging feels like moving a thing rather than submitting a form. If the
//   server refuses, the previous state comes back and a toast says why — and
//   a fresh load follows, so the screen never drifts from the truth for long.
// ============================================================
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";

const byName = (a, b) => a.name.localeCompare(b.name);

export function useFolders({ notify } = {}) {
  const [folders, setFolders] = useState([]);
  const [placements, setPlacements] = useState({});
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.folders();
      setFolders((r.folders || []).slice().sort(byName));
      setPlacements(r.placements || {});
    } catch (e) {
      notify?.(e.message || "Could not load your folders", "error");
    } finally {
      setLoaded(true);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  // Undo on screen, say why, and reload so the screen matches the server.
  const refused = (e, fallback) => { notify?.(e?.message || fallback, "error"); load(); };

  const createFolder = async (name) => {
    try {
      const f = await api.createFolder(name);
      setFolders((fs) => [...fs, { ...f, count: 0 }].sort(byName));
      return f;
    } catch (e) {
      refused(e, "Could not create the folder");
      return null;
    }
  };

  const renameFolder = async (id, name) => {
    const before = folders;
    setFolders((fs) => fs.map((f) => (f.id === id ? { ...f, name } : f)).sort(byName));
    try { await api.renameFolder(id, name); }
    catch (e) { setFolders(before); refused(e, "Could not rename the folder"); }
  };

  const deleteFolder = async (id) => {
    const beforeF = folders, beforeP = placements;
    setFolders((fs) => fs.filter((f) => f.id !== id));
    setPlacements((p) => Object.fromEntries(Object.entries(p).filter(([, fid]) => fid !== id)));
    try { await api.deleteFolder(id); }
    catch (e) { setFolders(beforeF); setPlacements(beforeP); refused(e, "Could not delete the folder"); }
  };

  // folderId null = back to the main list. Counts move with the placement.
  const moveTo = async (requestId, folderId) => {
    const beforeF = folders, beforeP = placements;
    const from = placements[requestId] || null;
    if (from === (folderId || null)) return;
    setPlacements((p) => {
      const next = { ...p };
      if (folderId) next[requestId] = folderId; else delete next[requestId];
      return next;
    });
    setFolders((fs) => fs.map((f) => {
      let count = f.count;
      if (from === f.id) count -= 1;
      if (folderId === f.id) count += 1;
      return count === f.count ? f : { ...f, count };
    }));
    try { await api.fileRequest(requestId, folderId); }
    catch (e) { setFolders(beforeF); setPlacements(beforeP); refused(e, "Could not move the document"); }
  };

  return { folders, placements, loaded, createFolder, renameFolder, deleteFolder, moveTo, reload: load };
}
```

- [ ] **Step 3: Lint**

Run (from `client/`): `npx eslint src/api.js src/lib/useFolders.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add client/src/api.js client/src/lib/useFolders.js
git commit -m "folders: the calls, and a hook that moves first and asks the server after

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: A slot in the header, and rows that can be dragged

**Files:**
- Modify: `client/src/components/BackHeader.jsx`
- Modify: `client/src/components/RequestRow.jsx`

- [ ] **Step 1: Give `BackHeader` an `actions` slot**

Replace the whole of `client/src/components/BackHeader.jsx` with:

```jsx
import { ChevronRight } from "lucide-react";

// `actions` sits at the right of the title, beside the count — for a control
// that belongs to the whole list, such as "New folder".
export function BackHeader({ back, title, step, actions }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <button onClick={back} className="text-xs tracking-wider uppercase opacity-60 hover:opacity-100 flex items-center gap-1 mb-2">
          <ChevronRight size={12} style={{ transform: "rotate(180deg)" }} /> Back
        </button>
        <h1 className="font-display text-2xl sm:text-3xl md:text-4xl leading-tight">{title}</h1>
      </div>
      {(step || actions) && (
        <div className="flex items-center gap-3 shrink-0 pt-1">
          {step && <div className="text-[10px] sm:text-xs tracking-wider uppercase opacity-50">{step}</div>}
          {actions}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Make `RequestRow` an optional drag source**

In `client/src/components/RequestRow.jsx`:

Change the import line
```js
import { FileText, FileSpreadsheet, Zap, GitBranch } from "lucide-react";
```
to
```js
import { FileText, FileSpreadsheet, Zap, GitBranch, GripVertical } from "lucide-react";
```

Change the signature
```js
export function RequestRow({ r, teams, users, i, actions, subtitle }) {
```
to
```js
// `draggableId`: when set, the row can be picked up and dropped on a folder;
// it carries the request id as text/x-request-id. A grip appears so the row
// looks like something that can be moved.
export function RequestRow({ r, teams, users, i, actions, subtitle, draggableId = null }) {
```

Replace the root `<div className={`px-3 sm:px-5 …`}` opening tag and the icon box:
```jsx
    <div className={`px-3 sm:px-5 py-3 sm:py-4 flex items-start sm:items-center gap-3 sm:gap-4 ${i > 0 ? "border-t" : ""}`} style={{ borderColor: "var(--c-ink-08)" }}>
      <div className="w-9 h-9 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(15,26,46,.06)" }}>
        {r.fileType === "pdf" ? <FileText size={15} /> : <FileSpreadsheet size={15} />}
      </div>
```
with
```jsx
    <div className={`px-3 sm:px-5 py-3 sm:py-4 flex items-start sm:items-center gap-3 sm:gap-4 ${i > 0 ? "border-t" : ""}`}
      style={{ borderColor: "var(--c-ink-08)", cursor: draggableId ? "grab" : undefined }}
      draggable={!!draggableId}
      onDragStart={draggableId ? (e) => {
        e.dataTransfer.setData("text/x-request-id", draggableId);
        e.dataTransfer.effectAllowed = "move";
      } : undefined}>
      {draggableId && <GripVertical size={14} className="opacity-30 shrink-0 hidden sm:block" aria-hidden="true" />}
      <div className="w-9 h-9 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(15,26,46,.06)" }}>
        {r.fileType === "pdf" ? <FileText size={15} /> : <FileSpreadsheet size={15} />}
      </div>
```

Everything else in the file stays as it is. Rows without `draggableId` render exactly as before.

- [ ] **Step 3: Lint**

Run (from `client/`): `npx eslint src/components/BackHeader.jsx src/components/RequestRow.jsx`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/BackHeader.jsx client/src/components/RequestRow.jsx
git commit -m "folders: a slot beside the list title, and rows that can be picked up

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The folder strip

**Files:**
- Create: `client/src/components/FolderStrip.jsx`

- [ ] **Step 1: Write it**

```jsx
// ============================================================
//   THE FOLDER STRIP
//   ------------------------------------------------------------
//   One tile per folder above the list: its name, how many documents are in
//   it, and — while something is being dragged — a drop target. Click a tile
//   to open the folder; inside, the strip becomes a breadcrumb and a "Main
//   list" target for dragging documents back out.
//
//   Creating and renaming happen INLINE, in the tile itself, so the person
//   never leaves the list they were tidying. Deleting confirms, and says what
//   it will do: the folder name goes, the documents do not.
// ============================================================
import { useEffect, useRef, useState } from "react";
import { Folder, FolderOpen, FolderPlus, Check, X, Ellipsis, Pencil, Trash2, ChevronRight } from "lucide-react";
import { useConfirmation } from "../lib/useConfirm.jsx";

const DRAG_TYPE = "text/x-request-id";

/** The text box used for both a new name and a rename. Enter saves, Escape cancels. */
function NameBox({ initial = "", placeholder, onSave, onCancel }) {
  const [value, setValue] = useState(initial);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const save = () => { const v = value.replace(/\s+/g, " ").trim(); if (v) onSave(v); else onCancel(); };
  return (
    <div className="flex items-center gap-1">
      <input ref={ref} value={value} maxLength={60} placeholder={placeholder}
        className="text-sm px-2 py-1 rounded" style={{ minWidth: 140 }}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") onCancel(); }}
        onBlur={save} />
      <button className="btn-ghost text-xs px-1" title="Save" onMouseDown={(e) => e.preventDefault()} onClick={save}><Check size={12} /></button>
      <button className="btn-ghost text-xs px-1" title="Cancel" onMouseDown={(e) => e.preventDefault()} onClick={onCancel}><X size={12} /></button>
    </div>
  );
}

/** A tile that accepts a dragged row. `onDropRequest(requestId)` is called with what landed. */
function DropTile({ active, onDropRequest, onClick, children, title }) {
  const [over, setOver] = useState(false);
  return (
    <button type="button" title={title} onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
      style={{
        border: `1px solid ${over ? "var(--c-gold)" : "var(--c-ink-10)"}`,
        backgroundColor: over ? "rgba(184,137,74,.16)" : active ? "rgba(184,137,74,.10)" : "var(--c-paper)",
        outline: over ? "2px solid rgba(184,137,74,.35)" : "none",
      }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (!over) setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData(DRAG_TYPE); if (id) onDropRequest(id); }}>
      {children}
    </button>
  );
}

/**
 * @param folders      [{ id, name, count }]
 * @param current      id of the open folder, or null for the main list
 * @param creating     whether the "new folder" box is showing (owned by the parent, which also owns the title button)
 * @param onOpen(id|null), onCreate(name), onRename(id, name), onDelete(id), onMove(requestId, folderId|null)
 */
export function FolderStrip({ folders, current, creating, onCreatingChange, onOpen, onCreate, onRename, onDelete, onMove }) {
  const confirm = useConfirmation();
  const [renaming, setRenaming] = useState(null);   // folder id
  const [menuFor, setMenuFor] = useState(null);     // folder id with the ⋯ menu open
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menuFor) return;
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuFor(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuFor]);

  const open = current ? folders.find((f) => f.id === current) : null;

  // Nothing to show, nothing being made: the screen looks exactly as it always did.
  if (!folders.length && !creating) return null;

  const remove = async (f) => {
    setMenuFor(null);
    const ok = await confirm({
      title: `Delete "${f.name}"?`,
      message: f.count
        ? `Its ${f.count} document${f.count === 1 ? "" : "s"} go back to the main list. Nothing else is deleted.`
        : "The folder is empty. Nothing else is deleted.",
      confirmLabel: "Delete folder",
      destructive: true,
    });
    if (ok) { if (current === f.id) onOpen(null); onDelete(f.id); }
  };

  // Inside a folder: a breadcrumb, and one target for dragging documents out.
  if (open) {
    return (
      <div className="mt-6 flex items-center gap-2 flex-wrap text-sm">
        <DropTile title="Drop here to move a document back to the main list" onClick={() => onOpen(null)} onDropRequest={(id) => onMove(id, null)}>
          <Folder size={14} className="opacity-60" /> Main list
        </DropTile>
        <ChevronRight size={14} className="opacity-40" />
        <span className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: "rgba(184,137,74,.12)", border: "1px solid var(--c-gold)" }}>
          <FolderOpen size={14} style={{ color: "var(--c-gold)" }} />
          {renaming === open.id
            ? <NameBox initial={open.name} placeholder="Folder name" onSave={(v) => { setRenaming(null); if (v !== open.name) onRename(open.id, v); }} onCancel={() => setRenaming(null)} />
            : <><span className="font-medium">{open.name}</span><span className="opacity-50 text-xs">{open.count}</span></>}
        </span>
        <button className="btn-ghost text-xs" onClick={() => setRenaming(open.id)}><Pencil size={12} /> Rename</button>
        <button className="btn-ghost text-xs" onClick={() => remove(open)}><Trash2 size={12} /> Delete</button>
      </div>
    );
  }

  // The main list: every folder as a tile, plus the new-folder box when asked for.
  return (
    <div className="mt-6 flex items-center gap-2 flex-wrap">
      {folders.map((f) => (
        <div key={f.id} className="relative flex items-center" ref={menuFor === f.id ? menuRef : null}>
          {renaming === f.id ? (
            <span className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ border: "1px solid var(--c-gold)" }}>
              <Folder size={14} className="opacity-60" />
              <NameBox initial={f.name} placeholder="Folder name"
                onSave={(v) => { setRenaming(null); if (v !== f.name) onRename(f.id, v); }}
                onCancel={() => setRenaming(null)} />
            </span>
          ) : (
            <DropTile title={`Open ${f.name} — or drop a document here to file it`} onClick={() => onOpen(f.id)} onDropRequest={(id) => onMove(id, f.id)}>
              <Folder size={14} className="opacity-60" />
              <span className="font-medium truncate" style={{ maxWidth: 180 }}>{f.name}</span>
              <span className="opacity-50 text-xs">{f.count}</span>
            </DropTile>
          )}
          {renaming !== f.id && (
            <button className="btn-ghost text-xs px-1 ml-0.5" title="Rename or delete" aria-label={`Options for ${f.name}`}
              onClick={() => setMenuFor(menuFor === f.id ? null : f.id)}>
              <Ellipsis size={13} />
            </button>
          )}
          {menuFor === f.id && (
            <div className="absolute left-0 top-full mt-1 z-20 rounded-lg overflow-hidden text-sm"
              style={{ backgroundColor: "var(--c-paper)", border: "1px solid var(--c-ink-10)", boxShadow: "0 8px 24px rgba(15,26,46,.16)", minWidth: 150 }}>
              <button className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-black/5" onClick={() => { setMenuFor(null); setRenaming(f.id); }}>
                <Pencil size={13} className="opacity-70" /> Rename
              </button>
              <button className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-black/5" style={{ color: "var(--c-rust-deep)" }} onClick={() => remove(f)}>
                <Trash2 size={13} className="opacity-80" /> Delete
              </button>
            </div>
          )}
        </div>
      ))}
      {creating && (
        <span className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ border: "1px solid var(--c-gold)" }}>
          <FolderPlus size={14} style={{ color: "var(--c-gold)" }} />
          <NameBox placeholder="New folder name"
            onSave={(v) => { onCreatingChange(false); onCreate(v); }}
            onCancel={() => onCreatingChange(false)} />
        </span>
      )}
    </div>
  );
}
```

The `confirm` options (`title`, `message`, `confirmLabel`, `destructive`) are the ones `client/src/lib/useConfirm.jsx` documents at lines 40-50.

- [ ] **Step 2: Lint**

Run (from `client/`): `npx eslint src/components/FolderStrip.jsx`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/FolderStrip.jsx
git commit -m "folders: the strip — tiles to open, drop onto, rename and delete

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The "Move to…" menu

**Files:**
- Create: `client/src/components/MoveToMenu.jsx`

- [ ] **Step 1: Write it**

```jsx
// ============================================================
//   MOVE TO…
//   ------------------------------------------------------------
//   Filing without dragging. On a phone there is no drag-and-drop worth the
//   name, and on a desktop some people would rather click; this is the same
//   move, as a small menu on every row: the person's folders, a way to make a
//   new one on the spot, and — when the document is already filed — a way out.
// ============================================================
import { useEffect, useRef, useState } from "react";
import { Folder, FolderInput, FolderPlus, Check } from "lucide-react";

export function MoveToMenu({ folders, currentFolderId, onMove, onCreateAndMove }) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setNaming(false); } };
    const esc = (e) => { if (e.key === "Escape") { setOpen(false); setNaming(false); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const choose = (folderId) => { setOpen(false); setNaming(false); onMove(folderId); };
  const create = () => {
    const v = name.replace(/\s+/g, " ").trim();
    if (!v) return;
    setOpen(false); setNaming(false); setName("");
    onCreateAndMove(v);
  };

  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost text-xs" onClick={() => setOpen((o) => !o)} title="Move to a folder">
        <FolderInput size={12} /> Move to…
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 rounded-lg overflow-hidden text-sm"
          style={{ backgroundColor: "var(--c-paper)", border: "1px solid var(--c-ink-10)", boxShadow: "0 8px 24px rgba(15,26,46,.16)", minWidth: 200 }}>
          {folders.length === 0 && !naming && (
            <div className="px-3 py-2 text-xs opacity-60">No folders yet.</div>
          )}
          {folders.map((f) => (
            <button key={f.id} className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-black/5"
              onClick={() => choose(f.id)}>
              <Folder size={13} className="opacity-60" />
              <span className="truncate flex-1">{f.name}</span>
              {currentFolderId === f.id && <Check size={12} style={{ color: "var(--c-gold)" }} />}
            </button>
          ))}
          <div className="border-t" style={{ borderColor: "var(--c-ink-10)" }} />
          {naming ? (
            <div className="px-3 py-2 flex items-center gap-1">
              <input autoFocus value={name} maxLength={60} placeholder="New folder name" className="text-sm px-2 py-1 rounded flex-1"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
              <button className="btn-ghost text-xs px-1" onClick={create}><Check size={12} /></button>
            </div>
          ) : (
            <button className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-black/5" onClick={() => setNaming(true)}>
              <FolderPlus size={13} className="opacity-70" /> New folder…
            </button>
          )}
          {currentFolderId && (
            <button className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-black/5 border-t" style={{ borderColor: "var(--c-ink-10)" }}
              onClick={() => choose(null)}>
              Remove from folder
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Lint**

Run (from `client/`): `npx eslint src/components/MoveToMenu.jsx`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/MoveToMenu.jsx
git commit -m "folders: Move to…, the same move for people who do not drag

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `FolderedList`, and the two lists that use it

**Files:**
- Create: `client/src/components/FolderedList.jsx`
- Modify: `client/src/App.jsx` — `ApprovedList` (~line 1254) and `ApproverApproved` (~line 2173), plus one import

- [ ] **Step 1: Write `FolderedList`**

```jsx
// ============================================================
//   A LIST OF FINISHED DOCUMENTS, WITH FOLDERS
//   ------------------------------------------------------------
//   Wraps a finished-document list with the folder behaviour, so the two
//   screens that show such lists share one implementation rather than each
//   growing its own. The parent still decides how a row looks; this decides
//   which rows show (main list = unfiled; inside a folder = that folder's),
//   and gives the row its "Move to…" control.
// ============================================================
import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { BackHeader } from "./BackHeader.jsx";
import { Empty } from "./Empty.jsx";
import { FolderStrip } from "./FolderStrip.jsx";
import { MoveToMenu } from "./MoveToMenu.jsx";
import { useFolders } from "../lib/useFolders.js";

/**
 * @param items        the finished documents this screen lists (all of them; filtering happens here)
 * @param renderRow    (r, i, moveMenu) => <RequestRow …/> — the parent supplies the row; `moveMenu` goes among its actions
 * @param countLabel   what the title count says, e.g. "signed"
 */
export function FolderedList({ items, title, back, notify, emptyIcon, emptyText, countLabel = "signed", renderRow }) {
  const { folders, placements, createFolder, renameFolder, deleteFolder, moveTo } = useFolders({ notify });
  const [current, setCurrent] = useState(null);       // open folder id, or null
  const [creating, setCreating] = useState(false);

  const folderIds = new Set(folders.map((f) => f.id));
  const visible = current
    ? items.filter((r) => placements[r.id] === current)
    : items.filter((r) => !placements[r.id] || !folderIds.has(placements[r.id]));
  const openFolder = current ? folders.find((f) => f.id === current) : null;

  const createAndMove = async (name, requestId) => {
    const f = await createFolder(name);
    if (f) moveTo(requestId, f.id);
  };

  const filedCount = items.length - (current ? 0 : visible.length);
  const empty = !items.length
    ? <Empty icon={emptyIcon} text={emptyText} />
    : current
      ? <Empty icon={emptyIcon} text="Nothing in this folder yet — drag documents here, or use Move to… on a document." />
      : <Empty icon={emptyIcon} text={`Everything is filed — open a folder above. (${filedCount} filed)`} />;

  return (
    <div>
      <BackHeader back={back} title={title} step={`${items.length} ${countLabel}`}
        actions={(
          <button className="btn-ghost text-xs" onClick={() => { setCurrent(null); setCreating(true); }} disabled={creating}>
            <FolderPlus size={12} /> New folder
          </button>
        )} />

      <FolderStrip folders={folders} current={current} creating={creating} onCreatingChange={setCreating}
        onOpen={setCurrent} onCreate={createFolder} onRename={renameFolder} onDelete={deleteFolder} onMove={moveTo} />

      {visible.length === 0 ? empty : (
        <div className="card mt-6 overflow-hidden">
          {visible.map((r, i) => renderRow(r, i, (
            <MoveToMenu folders={folders} currentFolderId={placements[r.id] || null}
              onMove={(folderId) => moveTo(r.id, folderId)}
              onCreateAndMove={(name) => createAndMove(name, r.id)} />
          )))}
        </div>
      )}
      {openFolder && visible.length > 0 && (
        <div className="text-xs opacity-50 mt-3">Drag a document onto "Main list" above to take it out of {openFolder.name}.</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Route `ApprovedList` through it**

In `client/src/App.jsx`, add to the component imports (next to `import { RequestRow } …`):

```js
import { FolderedList } from "./components/FolderedList.jsx";
```

Replace the whole `ApprovedList` function (currently lines ~1254-1276) with:

```jsx
function ApprovedList({ items, teams, users, user, back, notify, title = "Approved requests" }) {
  const [open, setOpen] = useState(null);
  return (
    <>
      <FolderedList items={items} title={title} back={back} notify={notify}
        emptyIcon={Archive} emptyText={`No ${title.replace(/^My /i, "").toLowerCase()} yet.`}
        renderRow={(r, i, moveMenu) => (
          <RequestRow key={r.id} r={r} teams={teams} users={users} i={i} draggableId={r.id}
            actions={(
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost text-xs" onClick={() => setOpen(r)}><Eye size={12} /> Preview</button>
                <DownloadBtn req={r} user={user} />
                <PrintBtn req={r} />
                {moveMenu}
              </div>
            )} />
        )} />
      {open && <PreviewDrawer user={user} req={open} onClose={() => setOpen(null)} users={users} teams={teams} />}
    </>
  );
}
```

`notify` already reaches this component through `{...props}` at the two call sites (lines ~1103-1104); nothing changes there.

- [ ] **Step 3: Route `ApproverApproved` through it**

Replace the `return (…)` of `ApproverApproved` (from `return (` down to the closing `);` before `}` — currently lines ~2180-2208) with:

```jsx
  return (
    <>
      <FolderedList items={items} title="Approved requests" back={back} notify={notify}
        emptyIcon={Archive} emptyText="No approved requests yet."
        renderRow={(r, i, moveMenu) => (
          <RequestRow key={r.id} r={r} teams={teams} users={users} i={i} draggableId={r.id}
            actions={(
              <div className="flex flex-wrap gap-2">
                {inMyWindow(r) ? (
                  <button className="btn-danger text-xs" onClick={() => setActId(r.id)}
                    title="Still inside your 1-hour window — reject or withdraw">
                    <XCircle size={12} /> Reject / Withdraw
                  </button>
                ) : (
                  <button className="btn-ghost text-xs" onClick={() => setOpen(r)}><Eye size={12} /> Preview</button>
                )}
                <DownloadBtn req={r} user={user} />
                <PrintBtn req={r} />
                {moveMenu}
              </div>
            )} />
        )} />
      {open && <PreviewDrawer user={user} req={open} onClose={() => setOpen(null)} users={users} teams={teams} />}
      {act && <ApproveDrawer req={act} user={user} users={users} teams={teams}
        approveRequest={approveRequest} rejectRequest={rejectRequest} undoApproval={undoApproval}
        onClose={() => setActId(null)} notify={notify} />}
    </>
  );
```

The `const [open…]`, `const [actId…]`, `const act…` and `const inMyWindow…` lines above the return stay exactly as they are.

- [ ] **Step 4: Lint and build**

Run (from `client/`): `npm run build`
Expected: lint prints nothing and Vite reports `✓ built in …`. If `BackHeader` or `Empty` are now imported by both `App.jsx` and `FolderedList.jsx`, that is fine.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/FolderedList.jsx client/src/App.jsx
git commit -m "folders: both finished-document lists file into folders

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: See it work in a browser

**Files:**
- Scratchpad only: `<scratchpad>/shot-folders.mjs` (not committed)

Pre-conditions: the local API on :5001 and the client dev server on :5173 are running from the `D:\OneSign-master` worktree (launch configs `signflow-master-api` and `signflow-master-client`; the local `.env` there has email off). A signed-in session token for a local user who has approved requests is minted with the existing `mint.mjs` in the scratchpad (`node --env-file=.env <scratchpad>/mint.mjs taha.chunawala@hqhb.in <scratchpad>/token.txt`, from `server/`).

- [ ] **Step 1: Write the run-through**

`<scratchpad>/shot-folders.mjs` (Playwright is installed in the older scratchpad `…/236cbf9f-…/scratchpad/node_modules`; run the script from that directory):

```js
import { chromium } from "file:///C:/Users/TAHACH~1/AppData/Local/Temp/claude/D--OneSign/236cbf9f-b5e2-4580-840e-a882ee42250b/scratchpad/node_modules/playwright/index.mjs";
import fs from "node:fs";
const S = "C:/Users/TAHACH~1/AppData/Local/Temp/claude/D--OneSign/3321b0e3-6d32-46f0-a030-c60b1389984c/scratchpad";
const token = fs.readFileSync(`${S}/token.txt`, "utf8");
const b = await chromium.launch({ channel: "msedge" });
const p = await b.newPage({ viewport: { width: 1220, height: 900 } });
await p.goto("http://localhost:5173/");
await p.evaluate((t) => localStorage.setItem("sf_token", t), token);
await p.goto("http://localhost:5173/");
await p.waitForTimeout(2800);
const nn = p.getByRole("button", { name: "Not now" }); if (await nn.count()) { await nn.click(); await p.waitForTimeout(400); }
await p.getByText("My approved requests").first().click();
await p.waitForTimeout(1500);
const rowsBefore = await p.locator(".card [draggable=true]").count();
console.log("rows before:", rowsBefore);

// 1. create a folder from the title button
await p.getByRole("button", { name: /New folder/ }).click();
await p.locator('input[placeholder="New folder name"]').fill("Finance 2026");
await p.keyboard.press("Enter");
await p.waitForTimeout(800);
await p.screenshot({ path: `${S}/folders-1-created.png` });

// 2. drag the first row onto the tile
const row = p.locator(".card [draggable=true]").first();
const tile = p.getByRole("button", { name: /Open Finance 2026/ });
await row.dragTo(tile);
await p.waitForTimeout(900);
console.log("rows after drag:", await p.locator(".card [draggable=true]").count(), "(expected", rowsBefore - 1 + ")");
await p.screenshot({ path: `${S}/folders-2-dragged.png` });

// 3. open the folder, then drag it back out
await tile.click();
await p.waitForTimeout(800);
console.log("rows inside folder:", await p.locator(".card [draggable=true]").count(), "(expected 1)");
await p.screenshot({ path: `${S}/folders-3-inside.png` });
await p.locator(".card [draggable=true]").first().dragTo(p.getByRole("button", { name: /Main list/ }));
await p.waitForTimeout(900);
console.log("rows inside after moving back:", await p.locator(".card [draggable=true]").count(), "(expected 0)");

// 4. Move to… from the main list, then rename and delete
await p.getByRole("button", { name: /Main list/ }).click();
await p.waitForTimeout(600);
await p.getByRole("button", { name: /Move to/ }).first().click();
await p.getByRole("button", { name: "Finance 2026" }).click();
await p.waitForTimeout(800);
console.log("rows after Move to…:", await p.locator(".card [draggable=true]").count(), "(expected", rowsBefore - 1 + ")");
await p.getByRole("button", { name: /Options for Finance 2026/ }).click();
await p.getByRole("button", { name: "Rename" }).click();
await p.locator('input[placeholder="Folder name"]').fill("Finance");
await p.keyboard.press("Enter");
await p.waitForTimeout(700);
await p.getByRole("button", { name: /Options for Finance/ }).click();
await p.getByRole("button", { name: "Delete" }).click();
await p.waitForTimeout(500);
await p.screenshot({ path: `${S}/folders-4-delete-confirm.png` });
await p.getByRole("button", { name: /Delete folder/ }).click();
await p.waitForTimeout(900);
console.log("rows after deleting the folder:", await p.locator(".card [draggable=true]").count(), "(expected", rowsBefore + ")");

// 5. phone width: no drag, but Move to… is there
await p.setViewportSize({ width: 390, height: 780 });
await p.waitForTimeout(600);
console.log("Move to… visible on a phone:", await p.getByRole("button", { name: /Move to/ }).first().isVisible());
await p.screenshot({ path: `${S}/folders-5-phone.png` });
await b.close();
```

- [ ] **Step 2: Run it and read the screenshots**

Run: `cd <older scratchpad> && node <scratchpad>/shot-folders.mjs`
Expected: each "rows …" line matches its "(expected …)"; `Move to… visible on a phone: true`. Open the five PNGs and check the strip sits between the title and the list, the tile highlights on hover, and the confirm dialog names the folder and says documents go back to the main list.

If a drag does nothing, HTML5 drag needs the `dataTransfer` type to match: `RequestRow` sets `text/x-request-id` and `DropTile` checks `e.dataTransfer.types.includes("text/x-request-id")` — confirm both spellings agree.

- [ ] **Step 3: Server test once more, and the full client build**

Run (from `server/`): `node test/folders.integration.mjs` → `… passed, 0 failed`.
Run (from `client/`): `npm run build` → `✓ built in …`.

No commit for this task; it verifies Tasks 1-8.

---

### Task 10: Pull request

- [ ] **Step 1: Push and open the PR against `master`**

```bash
git push -u origin feature/document-folders
gh pr create --base master --head feature/document-folders --title "folders: file finished documents into personal folders" --body-file <scratchpad>/pr-folders.md
```

`pr-folders.md`:

```markdown
## What

Every person can file their finished documents into folders of their own, on every approved/signed list — "My approved requests", "My signed documents", and approvers'/executives' "Approved requests". Design: `docs/superpowers/specs/2026-09-24-document-folders-design.md`.

- **"+ New folder"** beside the list title; a strip of folder tiles above the list.
- **Drag a row onto a tile** to file it; click a tile to open the folder; drag onto "Main list" to take it out.
- **"Move to…"** on every row does the same without dragging — the only way on a phone.
- Rename and delete from each tile. Deleting a folder returns its documents to the main list; nothing else is ever deleted.

## Decisions worth knowing

- **Filing is per person.** The same document sits in the requestor's list and each signer's; each files it as they like and sees only their own folders. Enforced by `folder_items` keyed on (user, request).
- **One folder per document** — the primary key, not screen logic.
- Names are unique per person, case-insensitively; blank and >60-character names are refused.
- Someone else's folder answers **404**, not 403, so its existence is not confirmed.
- **Account merges** carry folders and filing to the keeper; a clashing name becomes "Name (2)".
- Optimistic updates: the screen moves first, reverts with a toast if the server refuses.

## Tests

`server/test/folders.integration.mjs` — create/rename/delete, name rules, file/move/unfile with one placement row, delete returns documents to the main list, isolation between two people (404s), invisible document refused, session required, merge. Browser run-through: create, drag in, open, drag out, Move to…, rename, delete, phone width. `npm run build` passes.

## Rollout

Additive: two new tables at boot. Deploys to HQHB and WAQF from `master` as usual.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 2: Hand over**

Report the PR link and the screenshots to the owner. Do not merge without their say-so: merging `master` deploys both live sites.
