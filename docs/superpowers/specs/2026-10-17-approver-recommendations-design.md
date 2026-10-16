# Approve / Reject / Recommend changes — design (HQHB)

Date: 2026-10-17 · Owner-approved in conversation · Scope: **HQHB only**

## Problem
An approver can only Reject, give Instant Approval, or approve with a 1-hour
rejection window. When a document needs changes, the only route is a rejection,
after which the requestor must raise a brand-new request.

## Decisions (owner)
| Question | Decision |
|---|---|
| Organisation | HQHB only — WAQF keeps today's buttons |
| 1-hour window | Dropped from the UI — **Approve** signs and finalises immediately |
| After resubmission | Back to **the approver who asked**; earlier signatures kept |
| Supporting doc that needs a signature | Signed by **the same approval** that approves the main document |

## Behaviour
**Approver** sees three actions: **Approve**, **Reject**, **Recommend changes**.
Recommend changes requires a written note. The request moves to the new status
`changes_requested`, leaves the approver's queue, and returns to the requestor.

**Requestor** gets a **Returned for changes** bin (badge + email + in-app notice).
The **Revise & resubmit** screen offers:
- a reply to the approver (optional);
- **replace the main document** — only while **nobody has signed it yet**
  (single-approver, direct, or first-step recommendations). Signed copies are
  rebuilt from the main document on every signature, so replacing it after
  someone signed would put that person's signature on a version they never saw;
- **supporting documents**, each *needs signature* (PDF; the requestor places
  box(es)) or *no signature*;
- **Resubmit** → status back to `pending`, route unchanged, so it lands with the
  approver who asked; that approver is emailed.

Rounds are unlimited. Each round is recorded: who asked, what, when, the reply,
and whether the document was replaced. A requestor may withdraw instead.

## Data
- `requests.status` gains `changes_requested`.
- New `request_recommendations` (one row per round).
- `request_attachments` gains `needs_signature`, `boxes_json`,
  `signed_file_path`, `signed_at`, `signed_by`.

## Server
- `POST /api/requests/:id/recommend` — whoever may reject may recommend.
- `POST /api/requests/:id/resubmit` — requestor only; multipart (optional
  revised file, reply, boxes for the current approver).
- Attachments may be added/removed while `pending` **or** `changes_requested`;
  `needsSignature` + `boxes` accepted for PDFs.
- On any approval (single, workflow step, batch), unsigned *needs-signature*
  attachments are stamped with the approver's signature in the same step;
  a stamping failure fails the approval exactly as a main-document failure does.
- All new routes gated HQHB per route (never `router.use` — the router shares
  `/api/requests` with requests.js).
- Email + in-app templates: `changes_requested`, `resubmitted`.

## Client
- `lib/deployment.js` holds the deployment org from `/auth/config`.
- Approve drawer (HQHB): Reject · Recommend changes · Approve (instant).
- Recommendation history shown above the document in both drawers.
- Requestor home: **Returned for changes** tile → list → Revise & resubmit.
- Status pill: **Changes requested**.

## Tests
`server/test/recommendations.integration.mjs`: recommend → status + history +
leaves the queue; only the current approver may recommend; approve refused
while returned; resubmit by requestor only; replace allowed before any
signature, refused after; resubmit returns to the same approver; a
needs-signature attachment is stamped by the approval; WAQF → 404.
