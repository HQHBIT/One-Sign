# oneAccess ↔ SignFlow Identity Reconciliation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee that one person has exactly **one** SignFlow account whether they sign in via oneAccess SSO or local email — eliminating the "same user, two roles, two interfaces" duplicates.

**Architecture:** The **ITS id** becomes the canonical identity key. Admins set each existing local user's ITS id on the Users page, so oneAccess logins match by ITS instead of by (mismatching) email. A one-time admin **merge tool** cleans up the duplicates that already exist by reassigning all of a duplicate's data to the surviving account. Matching also broadens to secondary emails as a safety net, and `its_id` gets a UNIQUE constraint so a single ITS can never split into two accounts again.

**Tech Stack:** Node/Express + mysql2 (ESM), React 18 + Vite. Deploy: push `UAT` → EC2 (migrations auto-run on boot via idempotent `tryExec` in `db.js`).

---

## Why (grounded in current behaviour)

`upsertOneAccessUser` (`server/src/routes/auth.js`) matches an incoming oneAccess login: **(1) by `its_id`, (2) by primary email, else (3) create a new `requestor`.** Every local account (admin-created / self-registered) has **no `its_id`**, and oneAccess frequently sends a *different* email (e.g. a personal Gmail), so both matches miss and step 3 silently creates a second account. Confirmed live: `taha.chunawala@hqhb.in` (local, requestor) and `tahachunawala789@gmail.com` (oneaccess, ITS `30443308`) are the same person.

**Key decision (owner):** ITS ids are entered by an **admin per user** on the Users page.

## Files touched

- **Modify** `server/src/db.js` — `its_id` UNIQUE; `user_merges` audit table.
- **Modify** `server/src/oneaccess.js` — surface `secondary_email` / `email_default` from the profile.
- **Modify** `server/src/routes/auth.js` — broaden `upsertOneAccessUser` matching; flag unlinked new accounts.
- **Modify** `server/src/routes/users.js` — `PUT /:id/its-id`; `GET /duplicates`; `POST /:id/merge`.
- **Modify** `client/src/api.js` — `setItsId`, `listDuplicates`, `mergeUsers`.
- **Modify** `client/src/App.jsx` — Users page: ITS-id field + a "Duplicate accounts" screen.

## User-id foreign keys the merge must reassign
`signing_authority.user_id` (PK part, ON DELETE CASCADE) · `requests.requestor_id` · `requests.approver_id` · `request_step_signers.user_id` · `password_resets.user_id`.

---

## Phase 0 — Data-model guardrails

### Task 1: Make `its_id` UNIQUE (after de-duping)

**Files:** Modify `server/src/db.js` (migration block near the existing `idx_users_its_id`).

- [ ] **Step 1 — Guard: null out any duplicate its_ids before adding the constraint** (idempotent). Real data shouldn't have dupes, but a UNIQUE add fails hard if it does.

```js
// Before adding the UNIQUE index: if two rows somehow share an its_id, keep it on
// the oldest row and null the others (they'll be re-linked/merged by an admin).
await tryExec(`
  UPDATE users u
  JOIN (
    SELECT its_id, MIN(created_at) AS keep_at FROM users
    WHERE its_id IS NOT NULL GROUP BY its_id HAVING COUNT(*) > 1
  ) d ON d.its_id = u.its_id AND u.created_at <> d.keep_at
  SET u.its_id = NULL
`);
```

- [ ] **Step 2 — Add the UNIQUE index** (idempotent via `tryExec`; drop the old non-unique index first if present).

```js
await tryExec(`ALTER TABLE users DROP INDEX idx_users_its_id`);
await tryExec(`ALTER TABLE users ADD UNIQUE INDEX uq_users_its_id (its_id)`); // NULLs are allowed + non-unique in MySQL
```

- [ ] **Step 3 — Boot the server, confirm no migration error** in the log (`[db] MySQL connected`). Commit.

### Task 2: `user_merges` audit table

**Files:** Modify `server/src/db.js`.

- [ ] **Step 1 — Create the table** (records every merge for traceability).

```js
await tryExec(`
  CREATE TABLE IF NOT EXISTS user_merges (
    id           VARCHAR(64) NOT NULL PRIMARY KEY,
    survivor_id  VARCHAR(64) NOT NULL,
    merged_email VARCHAR(191) NOT NULL,
    merged_name  VARCHAR(191) NOT NULL,
    merged_its   VARCHAR(120) DEFAULT NULL,
    performed_by VARCHAR(64) NOT NULL,
    detail_json  TEXT,
    created_at   BIGINT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);
```

- [ ] **Step 2 — Commit.**

---

## Phase 1 — Admin sets a user's ITS id (the canonical link)

### Task 3: Backend — set/clear a user's ITS id

**Files:** Modify `server/src/routes/users.js`; Test: `server/test/its-id.integration.mjs`.

- [ ] **Step 1 — Write the failing integration test.**

```js
// server/test/its-id.integration.mjs — run: node server/test/its-id.integration.mjs
import { config } from "dotenv"; config({ path: "server/.env" });
const { initDb, execute, queryOne } = await import("../src/db.js");
await initDb();
let fail = 0; const check = (n,c)=>{console.log(`${c?"PASS":"FAIL"}  ${n}`); if(!c) fail++;};

const a = "u_its_a_"+Date.now(), b = "u_its_b_"+Date.now();
await execute("INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES (?,?,'x','A','requestor',?)",[a, a+"@t.co", Date.now()]);
await execute("INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES (?,?,'x','B','requestor',?)",[b, b+"@t.co", Date.now()]);

const { setUserItsId } = await import("../src/routes/users.js");   // exported helper (see Step 3)
await setUserItsId(a, "30111222");
check("its_id is set", (await queryOne("SELECT its_id FROM users WHERE id=?",[a])).its_id === "30111222");
let threw = false; try { await setUserItsId(b, "30111222"); } catch { threw = true; }
check("duplicate its_id is rejected", threw);
await setUserItsId(a, "");   // clearing is allowed
check("its_id cleared", (await queryOne("SELECT its_id FROM users WHERE id=?",[a])).its_id === null);

await execute("DELETE FROM users WHERE id IN (?,?)",[a,b]);
console.log(fail?`\n${fail} FAILED`:"\nAll its-id checks passed"); process.exit(fail?1:0);
```

- [ ] **Step 2 — Run it, confirm it fails** (`setUserItsId` not exported yet).

- [ ] **Step 3 — Implement the helper + route** in `server/src/routes/users.js`.

```js
// Exported so it's unit-testable. Normalises, enforces uniqueness, allows clearing.
export async function setUserItsId(userId, rawIts) {
  const its = String(rawIts || "").trim();
  if (its) {
    const clash = await queryOne("SELECT id FROM users WHERE its_id = ? AND id <> ?", [its, userId]);
    if (clash) throw new Error("Another user already has that ITS id");
  }
  await execute("UPDATE users SET its_id = NULLIF(?, '') WHERE id = ?", [its, userId]);
  return await queryOne("SELECT * FROM users WHERE id = ?", [userId]);
}

router.put("/:id/its-id", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const target = await queryOne("SELECT id FROM users WHERE id = ?", [req.params.id]);
    if (!target) return res.status(404).json({ error: "User not found" });
    const updated = await setUserItsId(req.params.id, req.body?.itsId);
    res.json({ user: await hydrateUser(updated) });
  } catch (e) {
    if (/already has that ITS/.test(e.message)) return res.status(409).json({ error: e.message });
    next(e);
  }
});
```

- [ ] **Step 4 — Run the test, confirm PASS.** Commit.

### Task 4: Client — ITS-id field on the Users admin page

**Files:** Modify `client/src/api.js`, `client/src/App.jsx` (the Users admin view / `hydrateUser` already returns nothing for ITS — add it).

- [ ] **Step 1 — Expose `its_id` to the client.** In `server/src/db.js` `hydrateUser`, add `itsId: row.its_id || null` to the returned object.

- [ ] **Step 2 — Add the API method** in `client/src/api.js`:

```js
setUserItsId(id, itsId) { return this.fetch(`/api/users/${id}/its-id`, { method: "PUT", body: JSON.stringify({ itsId }) }); },
```

- [ ] **Step 3 — Add an ITS column + inline editor** to the Users table in `App.jsx`. Show `user.itsId || "— not linked —"`; an "Set ITS" action opens a small prompt/inline input, calls `api.setUserItsId`, refreshes, and toasts. Surface the 409 ("Another user already has that ITS id") inline.

- [ ] **Step 4 — Build the client** (`npm run build`), verify compile. Commit.

---

## Phase 2 — Broaden matching (safety net against new duplicates)

### Task 5: Surface secondary emails from the oneAccess profile

**Files:** Modify `server/src/oneaccess.js` (`toLocalIdentity`); Test: extend `server/test/oneaccess.test.mjs`.

- [ ] **Step 1 — Add a failing unit test** asserting `toLocalIdentity` returns an `emails` array containing the primary + `secondary_email` + `email_default` (lower-cased, de-duped).

- [ ] **Step 2 — Implement.** In `toLocalIdentity`, add:

```js
const emails = [...new Set(
  [profile?.email, profile?.secondary_email, profile?.email_default, claims?.email]
    .map(e => String(e || "").trim().toLowerCase()).filter(Boolean)
)];
return { its, email, emails, name, department, isAdmin, jamaat, jamiaat };
```

- [ ] **Step 3 — Run tests, confirm PASS.** Commit.

### Task 6: Match ITS → any known email; flag unlinked new accounts

**Files:** Modify `server/src/routes/auth.js` (`upsertOneAccessUser` + the callback that calls it); Test: extend `server/test/oneaccess-upsert.integration.mjs`.

- [ ] **Step 1 — Add failing integration checks:** (a) a login whose ITS matches an existing local account adopts it (keeps role); (b) a login whose primary email misses but `secondary_email` matches an existing account adopts it; (c) a login that matches nothing creates a new account flagged `link_status = 'unlinked'`.

- [ ] **Step 2 — Add a `link_status` column** in `db.js`: `await tryExec("ALTER TABLE users ADD COLUMN link_status VARCHAR(16) NOT NULL DEFAULT 'linked'")`. New unmatched oneAccess accounts get `'unlinked'`; matched/merged accounts are `'linked'`.

- [ ] **Step 3 — Update `upsertOneAccessUser({ its, email, emails, ... })`:** match by `its_id`, then by **any** email in `emails` (`WHERE LOWER(email) IN (...)`), else INSERT with `link_status='unlinked'`. On any match, set `link_status='linked'` and backfill `its_id`. Keep the existing role rule (promote to admin, never demote).

```js
if (its) row = await queryOne("SELECT * FROM users WHERE its_id = ?", [its]);
if (!row && emails?.length) {
  const ph = emails.map(() => "?").join(",");
  row = await queryOne(`SELECT * FROM users WHERE LOWER(email) IN (${ph}) ORDER BY created_at ASC LIMIT 1`, emails);
}
```

- [ ] **Step 4 — Run tests, confirm PASS.** Commit.

---

## Phase 3 — Admin merge tool (clean up existing duplicates)

### Task 7: Detect duplicate candidates

**Files:** Modify `server/src/routes/users.js`; Test: `server/test/duplicates.integration.mjs`.

- [ ] **Step 1 — Failing test:** seed a local `Taha` + a oneaccess `Taha bhai …` and assert `findDuplicateCandidates()` pairs them.

- [ ] **Step 2 — Implement `findDuplicateCandidates()`** (exported): candidates are pairs where a normalised-name overlap OR a shared email exists across two different user rows, prioritising `(local account) × (oneaccess account)` and any `link_status='unlinked'` row. Normalise names by lowercasing and stripping honorifics (`bhai`, `bsb`, extra spaces). Return `[{ a: hydrateUser, b: hydrateUser, reason }]`.

- [ ] **Step 3 — Route** `GET /api/users/duplicates` (admin) returns the candidate list. Test PASS. Commit.

### Task 8: Merge two accounts (reassign all data)

**Files:** Modify `server/src/routes/users.js`; Test: `server/test/merge.integration.mjs`.

- [ ] **Step 1 — Failing test:** create survivor `A` (approver, has a request + signing authority) and duplicate `B` (requestor, raised a request + is a signer). Call `mergeUsers(A, B, adminId)`. Assert: `B`'s request now has `requestor_id = A`; `B`'s signer rows now `user_id = A`; `B`'s signing authority is on `A` (no PK clash); `A` keeps role `approver`; `A.its_id` = `B.its_id` (if `A` had none); `B` is deleted; a `user_merges` row exists.

- [ ] **Step 2 — Implement `mergeUsers(survivorId, mergedId, performedBy, { role })`** in a transaction:

```js
export async function mergeUsers(survivorId, mergedId, performedBy, opts = {}) {
  if (survivorId === mergedId) throw new Error("Cannot merge an account into itself");
  const pool = getPool(); const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[survivor]] = await conn.execute("SELECT * FROM users WHERE id=? FOR UPDATE", [survivorId]);
    const [[merged]]   = await conn.execute("SELECT * FROM users WHERE id=? FOR UPDATE", [mergedId]);
    if (!survivor || !merged) throw new Error("Both accounts must exist");

    // Reassign every user-id foreign key from merged -> survivor.
    await conn.execute("UPDATE requests SET requestor_id=? WHERE requestor_id=?", [survivorId, mergedId]);
    await conn.execute("UPDATE requests SET approver_id=? WHERE approver_id=?", [survivorId, mergedId]);
    await conn.execute("UPDATE request_step_signers SET user_id=? WHERE user_id=?", [survivorId, mergedId]);
    // signing_authority PK is (user_id, team_id) — INSERT IGNORE the survivor rows, then drop merged's.
    await conn.execute("INSERT IGNORE INTO signing_authority (user_id, team_id) SELECT ?, team_id FROM signing_authority WHERE user_id=?", [survivorId, mergedId]);
    await conn.execute("DELETE FROM signing_authority WHERE user_id=?", [mergedId]);
    await conn.execute("DELETE FROM password_resets WHERE user_id=?", [mergedId]);

    // Carry the canonical identity + preferred fields onto the survivor.
    const role = opts.role || (survivor.role !== "requestor" ? survivor.role : merged.role);
    await conn.execute(
      `UPDATE users SET its_id = COALESCE(its_id, ?), role = ?, link_status = 'linked',
         signature_path = COALESCE(signature_path, ?), department = COALESCE(department, ?),
         team_id = COALESCE(team_id, ?), jamaat = COALESCE(jamaat, ?), jamiaat = COALESCE(jamiaat, ?)
       WHERE id = ?`,
      [merged.its_id, role, merged.signature_path, merged.department, merged.team_id, merged.jamaat, merged.jamiaat, survivorId]
    );
    await conn.execute("DELETE FROM users WHERE id=?", [mergedId]);
    await conn.execute(
      "INSERT INTO user_merges (id, survivor_id, merged_email, merged_name, merged_its, performed_by, detail_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
      ["mrg_"+Date.now().toString(36), survivorId, merged.email, merged.name, merged.its_id, performedBy, JSON.stringify({ mergedId }), Date.now()]
    );
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
```

- [ ] **Step 3 — Route** `POST /api/users/:survivorId/merge` (admin, body `{ mergedId, role? }`). Guard against merging two accounts that would leave the survivor without a signature if both had one, etc. (log; don't block). Test PASS. Commit.

### Task 9: Client — "Duplicate accounts" admin screen

**Files:** Modify `client/src/api.js`, `client/src/App.jsx` (Admin dashboard: a new "Duplicate accounts" tile → list).

- [ ] **Step 1 — API methods:** `listDuplicates()`, `mergeUsers(survivorId, mergedId, role)`.
- [ ] **Step 2 — Screen:** each candidate pair shows both accounts side by side (name, email, role, ITS, provider, signature? request counts if cheap). Admin picks the **surviving** account + the role to keep, confirms via the existing `ConfirmContext`, calls merge, refreshes. Empty state: "No duplicate accounts found."
- [ ] **Step 3 — Build client, verify compile.** Commit.

---

## Phase 4 — Role source-of-truth (confirm + document)

### Task 10: Lock the role rule

- [ ] **Step 1** — Confirm in code + a comment in `upsertOneAccessUser`: on a match the **SignFlow-assigned role is preserved**; oneAccess only *promotes* to `admin` (via `is_admin`/`super_admin`), never demotes. On a merge the admin explicitly chooses the surviving role. No code change if already true — just the comment + a line in `memory/oneaccess-sso.md`.
- [ ] **Step 2 — Commit.**

---

## Phase 5 — Rollout (owner-run, after deploy)

- [ ] Deploy Phases 0–4 (push `UAT`; migrations auto-run).
- [ ] Admin opens **Users** and sets the **ITS id** on each existing local account (the canonical link). From then on, those people's oneAccess logins match by ITS — no new duplicates.
- [ ] Admin opens **Duplicate accounts** and merges the ones that already split (e.g. Taha's two rows), choosing the surviving account + role each time.
- [ ] Optional later: once every active user is linked, set `AUTH_LOCAL_LOGIN_ENABLED=false` to make SignFlow oneAccess-only (see `memory/oneaccess-sso.md`).

---

## Self-review notes
- **Spec coverage:** admin-entered ITS (Phase 1), broadened matching + unlinked-flag (Phase 2), merge of existing dupes (Phase 3), role rule (Phase 4), rollout (Phase 5), `its_id` UNIQUE + audit (Phase 0). ✅
- **FK completeness:** merge reassigns `requests.requestor_id`, `requests.approver_id`, `request_step_signers.user_id`, `signing_authority` (with PK-clash handling), and clears `password_resets`. Re-verify the FK list against `db.js` at implementation time in case new tables were added.
- **Naming consistency:** `setUserItsId`, `findDuplicateCandidates`, `mergeUsers` used consistently across tasks + tests.
- **Risk:** the merge is the highest-risk step (touches signed documents' ownership). It runs in one transaction with `FOR UPDATE` locks; every merge is written to `user_merges`. Test with an account that has a signed request before shipping.
