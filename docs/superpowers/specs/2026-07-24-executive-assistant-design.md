# Executive Assistant — Design Spec

**Date:** 2026-07-24
**Status:** Approved (design), pending implementation
**Rollback point:** git tag `uat-known-good-pre-exec-assistant` → `d66e10f`

## Goal

Let a user act as an **Executive Assistant (EA)** on behalf of one or more
**Executives** — viewing the executive's documents and, when the executive
permits, approving/signing them. One EA can support many executives.

## Roles

Two new `users.role` values, added alongside `admin | requestor | approver`:

- **`executive`** — a senior signer. Behaves **exactly like an Approver** in the
  document flow: same team routing, same direct-signer assignment, same
  signing/stamping. The only additions are that an Executive can have assistants
  and owns delegation settings. Everywhere signing logic checks `role = 'approver'`,
  it must also accept `'executive'` (introduce a single `isSigner(role)` helper).
- **`executive_assistant`** — supports one or more executives. Has its own login
  and its own dashboard; is not itself in the signing/routing flow.

## Data model

New table `executive_assistants` (the mapping *is* the settings — one row per
executive↔assistant link, so each executive controls their own delegation
independently):

| column           | type                        | notes |
|------------------|-----------------------------|-------|
| `id`             | varchar PK                  | `ea_...` |
| `executive_id`   | FK users(id)                | the executive being assisted |
| `assistant_id`   | FK users(id)                | the EA |
| `can_approve`    | tinyint(1) default 0        | the executive's standing on/off switch |
| `signature_source` | enum('executive','assistant') default 'executive' | whose signature gets stamped |
| `created_at`     | bigint                      | |
| `created_by`     | FK users(id) nullable       | admin or the executive |

- Unique index on (`executive_id`, `assistant_id`).
- Index on `assistant_id` (EA dashboard lookups) and `executive_id`.
- **All changes are additive** (new table + two new enum role values). No existing
  column is altered destructively → reverting the app code leaves the DB in a state
  the previous version tolerates.

## Permissions & behaviour

**EA — always (for each mapped executive):**
- View that executive's incoming/pending documents (read + open).

**EA — only when that link's `can_approve = 1`:**
- Approve/sign the executive's pending documents.
- On sign, stamp the signature named by `signature_source`:
  - `executive` → the executive's own `signature_path`.
  - `assistant` → the EA's own `signature_path` (EA registers their own signature).
- Manage the executive's signature (upload/update) — only relevant when
  `signature_source = 'executive'`. **Security refinement:** gated by `can_approve`
  rather than always-on, because replacing someone's signature image is a
  high-trust action a view-only assistant must not have.
- **Reject is NOT delegated** — rejections stay with the executive. (Revisit later
  if needed.)

**Executive — retains full control:**
- Sees and acts on their own queue as before.
- Owns the `can_approve` toggle and `signature_source` per assistant.
- Can add/remove their own assistant (self-service).

**Admin:**
- Can create/remove any executive↔assistant mapping and set both settings
  (in the Users/admin area).

## Audit & safety

- Every EA action is recorded as **"approved by `<assistant>` on behalf of
  `<executive>`"** — the executive's identity lands on the document; the audit
  trail always shows who actually clicked.
- Server enforces `can_approve` on every act-on-behalf endpoint (never trust the
  client). View/manage-signature is gated by the existence of the mapping.

## Surfaces (UI)

- **EA dashboard** (new view/component file — do NOT grow `App.jsx`): all mapped
  executives' documents grouped by executive, each labelled "Can approve" or
  "View only."
- **Executive settings:** assign/remove assistant, approve toggle, signature-source.
- **Admin (Users area):** manage any mapping + both settings.
- Role labels + role routing updated (`constants.js`, `App.jsx` router).

## Backend endpoints (sketch)

- `GET  /api/executive-assistants` — admin: list all mappings.
- `GET  /api/me/assistants` / `POST` / `DELETE` — executive self-service mapping.
- `PUT  /api/executive-assistants/:id` — set `can_approve` / `signature_source`
  (admin or the owning executive).
- `GET  /api/assist/executives` — EA: my mapped executives + their `can_approve`.
- `GET  /api/assist/:executiveId/requests` — EA: that executive's queue (gated).
- `POST /api/assist/:executiveId/requests/:id/approve` — EA approve-on-behalf
  (gated by `can_approve`; stamps per `signature_source`; audited).
- `PUT  /api/assist/:executiveId/signature` — EA upload the executive's signature.

## Reversibility guarantees

1. Rollback tag `uat-known-good-pre-exec-assistant` marks the pre-feature live state.
2. Schema changes are additive and backward-compatible.
3. Feature ships in isolated commits; `git revert` of those commits (then push)
   redeploys the prior state with no data loss.

## Out of scope (YAGNI, for now)

- Delegated reject.
- Time-limited / per-document grants (we chose a standing switch).
- Notifications routing changes (executive's existing notifications unchanged).
