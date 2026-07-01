# Self-Registration & Direct Signature Requests — Design Spec

- **Date:** 2026-06-29
- **Status:** Approved (design)
- **Scope:** Two related features for HQHB SignFlow.
  - **A — Self-registration with admin approval.**
  - **B — Direct, person-to-person signature requests across any team.**

**Decisions (from brainstorming):**
1. Self-registering users **set their own password**; once approved they sign in immediately with it.
2. **Team name** and **reporting manager** are **free text** on the form; IT maps them on approval.
3. Approval **activates the user as a Requestor**; IT adjusts role/team later in Users.
4. Direct requests can be sent to **anyone**; the request itself lets that person sign that one document, even a Requestor with no team authority.

**Build order:** Phase 1 = Feature A, Phase 2 = Feature B. One spec, two phases.

---

## Feature A — Self-registration + admin approval

### User flow
1. Login page → **"Create an account"** → form: **Name, Email, Password (≥ 6), Team name, Reporting manager**.
2. Submit → a pending `registrations` row → "Your registration is pending IT approval." No auto-login.
3. Admin console → **"Registrations"** tile (pending-count badge) → list with details → **Approve** or **Reject** (with reason).
4. Approve → a `users` row is created (role `requestor`, the chosen password hash, `team_id` NULL, the typed reporting-manager + requested-team carried over). The person can now sign in with the password they chose. IT assigns the real team/role/authority later in Users.
5. Reject → registration marked rejected + reason (optional email to the applicant).

### Data model
New table **`registrations`**:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | VARCHAR(64) PK | |
| `name` | VARCHAR(191) NOT NULL | |
| `email` | VARCHAR(191) NOT NULL | checked vs `users` + pending registrations |
| `password_hash` | VARCHAR(255) NOT NULL | bcrypt of their chosen password |
| `team_name` | VARCHAR(191) | free text |
| `reporting_manager` | VARCHAR(191) | free text |
| `status` | ENUM('pending','approved','rejected') DEFAULT 'pending' | |
| `reject_reason` | TEXT | |
| `created_at` | BIGINT NOT NULL | |
| `decided_at` | BIGINT | |
| `decided_by` | VARCHAR(64) | admin user id |

Plus index on `status`.

`users` additions (idempotent ALTERs): `reporting_manager VARCHAR(191) DEFAULT NULL`, `requested_team VARCHAR(191) DEFAULT NULL`.

**Login gate is automatic:** pending sign-ups live only in `registrations`, never in `users`, and login checks `users` — so they can't sign in until approval creates the user row. No status column on `users` needed.

### Backend
- `POST /api/auth/register` (public) — `{ name, email, password, teamName, reportingManager }`. Validate: required fields; valid email; password ≥ 6; email not already in `users` and not a pending registration (case-insensitive). Insert registration (status pending, password hashed). Return `{ ok: true }`.
- `GET /api/registrations` (admin) — list, pending first, newest first.
- `POST /api/registrations/:id/approve` (admin) — if pending → create `users` row from the registration; mark approved (`decided_at`, `decided_by`). Duplicate-email guard.
- `POST /api/registrations/:id/reject` (admin) — `{ reason }` → mark rejected. (Optional: email the applicant.)
- New `server/src/routes/registrations.js` (admin routes) mounted in `index.js`; the public `register` endpoint added to `routes/auth.js`.

### Frontend
- `LoginScreen.jsx` — a **registration panel** (reusing the existing forgot-password panel-state machine) with the five fields → `api.register` → success state.
- `api.js` — `register(...)`, `listRegistrations()`, `approveRegistration(id)`, `rejectRegistration(id, reason)`.
- `App.jsx` `AdminView` — a **Registrations** tile (badge = pending count) + an `AdminRegistrations` component (list + Approve / Reject-with-reason).

### Edge cases
- Duplicate email (user or pending) → 409, surfaced on the form.
- Approve race (email already a user) → guarded.
- Approved/rejected registrations retained for audit.

---

## Feature B — Direct (person-to-person) signature requests

### User flow
1. New request → a third mode **"Send to a specific person."**
2. **Search the directory by name or email** → matches show (name + email) → add one or more as signers (in order).
3. Place each signer's signature box on the document → submit.
4. Each signer is notified; they see it under **"Awaiting your signature"** and can **Approve & sign** or **Reject** — even a Requestor with no team authority.

### Data model
Reuses `requests` + `request_steps` + `request_step_signers` — **no new tables**.
- `requests.target_team_id` — already nullable → NULL for direct requests.
- `request_steps.team_id` — make nullable (idempotent ALTER) → NULL for direct steps.
- `request_step_signers.user_id` — already any user.

### Backend
- `GET /api/users/search?q=` (authRequired, any role) — up to **10** users matching name/email (case-insensitive contains; requires `q` length ≥ 2); minimal fields `{ id, name, email, hasSignature }`; excludes the caller. Distinct from the admin-only `listUsers`.
- Request creation (`routes/requests.js`) — accept a direct shape (team-less steps + arbitrary signer `user_id`s). Validate each signer exists; do **not** require signing authority; `target_team_id` NULL.
- Signing/approve route — authorize by **"you are the request's current active signer"** rather than by approver role. Verify the existing approve/sign logic and adjust.
- **"Awaiting your signature"** — surface requests where the caller is the current active signer (extend the requests listing or a dedicated endpoint).

### Frontend
- `NewRequest.jsx` — **"Send to a specific person"** mode → debounced user-search field → ordered signer chips → place signature boxes (reuse marker placement) → submit.
- `api.js` — `searchUsers(q)`; extend the create-request payload for direct mode.
- `App.jsx` — an **"Awaiting your signature"** section/tile for **all roles** (Requestors included), reusing the Approver review-and-sign view.

### Edge cases
- Search excludes self; "No user found for that email" when empty.
- A direct signer with no signature yet → existing first-signature modal before signing.
- Multiple signers sign in order (reuse the workflow step/signer machinery).

---

## Files touched

**Feature A:** `server/src/db.js`, `server/src/routes/auth.js`, `server/src/routes/registrations.js` (new), `server/src/index.js`, `client/src/api.js`, `client/src/components/LoginScreen.jsx`, `client/src/App.jsx`.

**Feature B:** `server/src/db.js`, `server/src/routes/users.js`, `server/src/routes/requests.js`, `client/src/api.js`, `client/src/forms/NewRequest.jsx`, `client/src/App.jsx`.

## Testing
- **A — Backend:** register (valid → pending; duplicate → 409; bad email / short password → 400); approve → user created + login works with the chosen password; reject → stays out of `users`. **Frontend:** browser-verify the register form + admin approve → sign in.
- **B — Backend:** `searchUsers` returns matches; create a direct request to an arbitrary user; that user (a Requestor) can fetch + sign; a non-signer cannot. **Frontend:** browser-verify direct-request creation + a Requestor signing it.

## Security notes
- Self-registration is a public write endpoint (spam risk) — the approval gate contains it; future: rate-limit / shared invite code.
- Directory search exposes name/email to any authenticated user — acceptable for an internal tool.
- Direct requests bypass team signing-authority **by design** (the request grants per-document signing).
