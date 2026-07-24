# Executive Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Executive Assistant who can view, and (when granted) approve/sign, documents on behalf of one or more Executives.

**Architecture:** Two new roles (`executive`, `executive_assistant`). `executive` reuses all Approver signing/routing logic via an `isSigner(role)` helper. A new `executive_assistants` mapping table carries per-link delegation settings (`can_approve`, `signature_source`). Everything is additive to the schema so a code revert is safe.

**Tech Stack:** Node/Express + MySQL (`mysql2`), React 18 + Vite. Deploy: push to `UAT` → GitHub Actions → EC2.

**Reversibility:** Rollback tag `uat-known-good-pre-exec-assistant` (`d66e10f`). Each phase is its own commit(s) and independently deployable; schema changes are additive (enum widening + new table), so reverting code never breaks the DB.

---

## Phase 1 — Backend foundation: roles + schema + `isSigner` (deployable, invisible to users)

### Task 1: Widen the role enum + add the mapping table

**Files:**
- Modify: `server/src/db.js` (in `runSchema()` migration list, after existing `tryExec` ALTERs)

- [ ] **Step 1: Add additive migrations** (append to the `tryExec` block in `runSchema()`):

```js
// Executive Assistant feature — additive, backward-compatible.
await tryExec(`ALTER TABLE users MODIFY COLUMN role ENUM('admin','requestor','approver','executive','executive_assistant') NOT NULL`);
await tryExec(`CREATE TABLE IF NOT EXISTS executive_assistants (
  id               VARCHAR(64) PRIMARY KEY,
  executive_id     VARCHAR(64) NOT NULL,
  assistant_id     VARCHAR(64) NOT NULL,
  can_approve      TINYINT(1) NOT NULL DEFAULT 0,
  signature_source ENUM('executive','assistant') NOT NULL DEFAULT 'executive',
  created_at       BIGINT NOT NULL,
  created_by       VARCHAR(64) NULL,
  UNIQUE KEY uq_exec_assistant (executive_id, assistant_id),
  KEY idx_ea_assistant (assistant_id),
  KEY idx_ea_executive (executive_id),
  CONSTRAINT fk_ea_exec FOREIGN KEY (executive_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ea_asst FOREIGN KEY (assistant_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
```

- [ ] **Step 2: Boot the server locally, confirm no migration errors**

Run: `npm --prefix server run start` (needs local MySQL) OR verify on next UAT deploy log.
Expected: startup banner, no `[db migrate]` error for the two statements.

- [ ] **Step 3: Commit**

```bash
git add server/src/db.js
git commit -m "feat(exec-assistant): add roles + executive_assistants table (additive schema)"
```

### Task 2: Add `isSigner` helper + shared role sets

**Files:**
- Modify: `server/src/auth.js`

- [ ] **Step 1: Add the helper** (below `requireRole`):

```js
// A "signer" is anyone in the approve/sign flow. Executive is a senior Approver,
// so it shares every code path that today checks for 'approver'.
export const SIGNER_ROLES = ["approver", "executive"];
export const isSigner = (role) => SIGNER_ROLES.includes(role);
```

- [ ] **Step 2: Commit**

```bash
git add server/src/auth.js
git commit -m "feat(exec-assistant): isSigner helper (approver + executive)"
```

### Task 3: Treat `executive` as a signer in request routing/creation

**Files:**
- Modify: `server/src/routes/requests.js` (the `requireRole("requestor","approver")` on POST `/`, the team-approver query `WHERE u.role = 'approver'`, and the pending-list role checks)

- [ ] **Step 1: Update guards/queries** — replace `requireRole("requestor","approver")` with `requireRole("requestor","approver","executive")`; change `WHERE u.role = 'approver'` to `WHERE u.role IN ('approver','executive')` in the team-approver lookup.

- [ ] **Step 2: Boot + smoke test** an executive can be assigned/sign like an approver (manual, or on UAT).

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/requests.js
git commit -m "feat(exec-assistant): executive participates in signing like approver"
```

---

## Phase 2 — Mapping API (admin + executive manage links)

### Task 4: `executive-assistants` routes

**Files:**
- Create: `server/src/routes/executive-assistants.js`
- Modify: `server/src/index.js` (register `app.use("/api/executive-assistants", ...)` and `/api/assist`)

- [ ] **Step 1:** Implement CRUD with auth:
  - `GET /api/executive-assistants` (admin) → all links (joined to user names).
  - `POST /api/executive-assistants` (admin, or executive for self) → create link `{executiveId, assistantId}`; executive callers may only set `executiveId = self`.
  - `PUT /api/executive-assistants/:id` (admin or owning executive) → set `can_approve` / `signature_source`.
  - `DELETE /api/executive-assistants/:id` (admin or owning executive).
  - Validate: `assistantId` role is `executive_assistant`; `executiveId` role is `executive`.
- [ ] **Step 2:** Register routes in `index.js`.
- [ ] **Step 3:** Commit `feat(exec-assistant): mapping CRUD API`.

### Task 5: EA act-on-behalf routes (`/api/assist`)

**Files:**
- Create: `server/src/routes/assist.js`
- Modify: `server/src/routes/requests.js` (extract the approve/stamp core into a reusable function taking an explicit signer + signature path, so both the normal approve and the on-behalf approve share it — DRY)

- [ ] **Step 1:** `GET /api/assist/executives` → EA's mapped executives + `can_approve`.
- [ ] **Step 2:** `GET /api/assist/:executiveId/requests` → that executive's queue (verify mapping exists).
- [ ] **Step 3:** `POST /api/assist/:executiveId/requests/:id/approve` → verify mapping AND `can_approve=1`; call shared approve core with signer=executive, signaturePath chosen by `signature_source` (executive's or the EA's own); record audit `acted_by=EA, on_behalf_of=executive`.
- [ ] **Step 4:** `PUT /api/assist/:executiveId/signature` → verify mapping AND `can_approve=1`; upload/replace the executive's signature.
- [ ] **Step 5:** Commit `feat(exec-assistant): assist API (view + approve-on-behalf + signature)`.

---

## Phase 3 — Client: roles, routing, and the EA experience

### Task 6: Role constants + labels

**Files:**
- Modify: `client/src/lib/constants.js` (add `EXECUTIVE`, `EXECUTIVE_ASSISTANT` to `ROLES` + `ROLE_LABELS`)
- Modify: `server` any role label maps if present.

- [ ] Commit `feat(exec-assistant): role constants + labels`.

### Task 7: api.js methods

**Files:**
- Modify: `client/src/api.js` (add methods for the Phase 2 endpoints).

- [ ] Commit `feat(exec-assistant): api client methods`.

### Task 8: Executive routing = Approver view + delegation settings

**Files:**
- Modify: `client/src/App.jsx` (role router: render `ApproverView` for `executive` too; add delegation settings entry)
- Create: `client/src/components/DelegationSettings.jsx` (assign assistant, `can_approve` toggle, `signature_source` selector) — **own file to avoid growing App.jsx**

- [ ] Commit `feat(exec-assistant): executive uses approver view + delegation settings`.

### Task 9: EA dashboard

**Files:**
- Create: `client/src/views/ExecutiveAssistantView.jsx` — mapped executives grouped, each labelled "Can approve"/"View only"; open/view docs; approve/sign when permitted (reuses existing request/preview components).
- Modify: `client/src/App.jsx` (route `executive_assistant` → `ExecutiveAssistantView`)

- [ ] Commit `feat(exec-assistant): EA dashboard`.

### Task 10: Admin mapping UI

**Files:**
- Modify: admin users area (find the Users management component) — add "Assistants" management: assign EA↔executives, toggle + signature-source.

- [ ] Commit `feat(exec-assistant): admin mapping UI`.

---

## Phase 4 — Verify + deploy

- [ ] Build client (`npm --prefix client run build`) — no errors.
- [ ] Manual smoke on UAT: create an executive + an EA, map them, toggle can_approve, EA approves on behalf, confirm correct signature stamped + audit line.
- [ ] Confirm rollback: `git revert` of the feature range redeploys cleanly against the (additive) schema.

## Self-review notes
- Every `role === 'approver'` check in server + client must be audited against `isSigner`/executive (Task 3, Task 8). Grep `'approver'` before finishing Phase 1/3.
- Signature stamping is shared between normal approve and on-behalf approve (Task 5 Step-0 extraction) — DRY.
- Reject intentionally excluded (spec, out of scope).
