# Request attachments — design

**Date:** 2026-10-13
**Status:** approved (design). Not implemented.

## Problem

A requestor uploads two documents. Only one of them needs a signature; the other
is supporting material the approver should read — a quotation, a covering letter,
a policy extract. There is no way to send them together.

Today the requestor has two bad options: place a signature box on a document that
nobody should be signing, or leave it out of SignFlow and email it separately,
which puts the context outside the audit trail the product exists to keep.

## What exists today

Several files uploaded at once switch `NewRequest.jsx` into `MultiDocFlow`, which
creates **one independent request per document** — it loops the documents calling
`addRequest` on the direct path, collects the ids, and sends a single summary
notification at the end via `api.notifyBatch(createdIds)`.

Every document must carry at least one signature box, enforced twice:

| Where | Rule |
|---|---|
| `client/src/forms/NewRequest.jsx` | `docReady(d) = d.markers.length > 0 && approverFor(d)?.userId` |
| `server/src/routes/requests.js` (`createDirectRequest`) | `Recipient N: signature box not placed` |

`requests` stores exactly one file — `file_name`, `file_path`, `file_type` are
columns on the row. A request cannot currently hold a second document at all.

## Decisions taken

1. **The unsigned document rides along as an attachment on the signed request.**
   One request, one approval decision, both files. Not a second request the
   approver has to dispose of separately.
2. **The requestor chooses which signed document each attachment belongs to**, so
   a batch may hold several signed documents and still attach correctly.
3. **HQHB only**, gated the way `ea-flow.js` is gated — the routes return 404
   elsewhere, so a WAQF box does not reveal them.
4. **Attachments are uploaded after the request is created**, through their own
   endpoint, rather than extending the create path. `createDirectRequest` already
   serves the workflow, direct and legacy shapes; fanning multipart input into it
   is the kind of change that breaks something unrelated.
5. **Attachments inherit the parent request's `confidential` flag and its
   encryption.** Otherwise marking a request confidential would protect the
   document and leak its attachment.
6. **Attachments are never merged into the signed PDF.** The signed artefact stays
   exactly what the approver agreed to sign.
7. **Attachments may be added only while the request is `pending`.** A document
   cannot appear underneath a signature that was already given.
8. **The client gates on the deployment organisation, not `users.org_id`** — see
   below; this one is easy to get wrong.
9. **At most five attachments per request.** A round number rather than a studied
   one: it is large enough for the covering-letter case and small enough that an
   approver is not handed a reading list. One constant, trivially changed.

## Why the batch ordering already works

The batch defers notification: each `addRequest` passes `deferNotify: true`, and
one summary email per signer goes out only after the loop, from
`api.notifyBatch(createdIds)`.

Attachments upload inside that window — after a request is created, before
anything is sent. So an approver is never told about a request whose attachment
has not yet landed, and decision 4 costs nothing in correctness.

If an attachment upload fails the request still exists and is visible to its
requestor, who can retry or remove the document. A failed attach never strands an
approver mid-decision.

## Data model

One new table. Nothing on `requests` changes, so a request without attachments
behaves exactly as it does today.

```sql
CREATE TABLE IF NOT EXISTS request_attachments (
  id           VARCHAR(64)  NOT NULL PRIMARY KEY,
  request_id   VARCHAR(64)  NOT NULL,
  file_name    VARCHAR(255) NOT NULL,
  file_path    VARCHAR(255) NOT NULL,
  file_type    ENUM('pdf','xlsx') NOT NULL,
  confidential TINYINT(1)   NOT NULL DEFAULT 0,
  uploaded_by  VARCHAR(64)  NOT NULL,
  uploaded_at  BIGINT       NOT NULL,
  INDEX idx_ra_request (request_id),
  CONSTRAINT fk_ra_request FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_ra_user    FOREIGN KEY (uploaded_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

Added through `runSchema()` in `server/src/db.js`, which is idempotent and runs on
boot, so the table appears on the next deploy with no migration step.

`ON DELETE CASCADE` means removing a request takes its attachment rows with it.
The stored files are cleaned up by the same path that already removes a request's
own file.

## Server — `server/src/routes/attachments.js`

A new router, mounted in `index.js`, gated exactly as `ea-flow.js` is:

```js
const hqhbOnly = (req, res, next) => (deploymentOrg() === "hqhb" ? next() : res.status(404).end());
router.use(hqhbOnly, authRequired);
```

| Route | Who | Rules |
|---|---|---|
| `POST /api/requests/:id/attachments` | requestor of that request | status must be `pending`; `.pdf/.xlsx/.xls`; existing size limit; max 5 per request |
| `GET /api/requests/:id/attachments` | anyone `authoriseAccess` already allows to see the request | returns id, name, type, size, uploadedAt |
| `GET /api/requests/:id/attachments/:attId/file` | same as above | streams the file, decrypting when confidential |
| `DELETE /api/requests/:id/attachments/:attId` | requestor, while `pending` | so a wrong file is not permanent |

Reads reuse `authoriseAccess`, already exported from `requests.js:813`, rather
than reimplementing who may see a document. That function already accounts for
requestor, approvers in the workflow, executive assistants and (on WAQF) the HOD;
a second copy of that logic would drift from it.

Storage goes through `server/src/filestore.js`, so attachments follow the same
local-or-S3 path as request files and need no separate migration. Its
`deleteStored()` removes the file when an attachment is deleted or its request
is.

## Client — the batch screen

Each document in `MultiDocFlow` gains a mode: **Needs signature** (the default, so
nothing changes for existing use) or **Attachment**. Choosing Attachment hides the
signature-box editor for that document and shows an "Attach to…" picker listing
the batch's signed documents by name.

```js
docReady(d) = d.mode === "attachment"
  ? !!d.attachTo
  : d.markers.length > 0 && !!approverFor(d)?.userId

allReady = routing
  && docs.some(d => d.mode !== "attachment")   // at least one document is actually signed
  && docs.every(docReady)
```

A batch of attachments alone is refused: there must be something to sign.

The submit loop is unchanged for signed documents. After each one's request is
created, its attachments upload against that request id; `notifyBatch` still runs
last.

### The gating subtlety

The attachment controls are shown based on **the deployment's organisation, taken
from `/auth/config`**, not on `user.orgId`.

`ShzForwardButton` gates on `user.orgId === "waqf"`, which is safe there because
it is only reachable on the WAQF box. The inverse is not safe: users created on
the WAQF box *before* `org_id` was set on insert still carry `org_id = 'hqhb'`,
so `user.orgId === "hqhb"` is true for some WAQF users and would show them this
UI. This is the same trap `manzooriEnabled()` documents when it deliberately keys
on `ORG_SLUG` instead of the stored column.

The server gate is the real boundary; the client gate only decides whether to
draw the control.

## Approver experience

Attachments are listed under the document in the request view, read-only, each
opening in the existing viewer. There is no sign action on an attachment and no
way to reach one.

The notification email gains a line naming the attachments, so an approver knows
to look before deciding rather than discovering them afterwards.

## What this deliberately does not do

- **No attachment-only requests.** Every request still has exactly one document
  that is signed.
- **No attaching after approval.** Decision 7.
- **No merging into the signed output.** Decision 6.
- **Not available on WAQF.** Decision 3.
- **No new file types.** The same `.pdf/.xlsx/.xls` the uploader already accepts.

Each of these is cheap to add later and expensive to undo, so none is built now.

## Testing

`server/test/attachments.integration.mjs`, following the shape of
`shz-forward.integration.mjs`:

1. Routes return 404 when `ORG_SLUG` is not `hqhb`.
2. Requestor attaches to their own `pending` request — succeeds, row created.
3. Another user attaching to it — 403.
4. Attaching to an `approved` request — 400.
5. A confidential request's attachment is stored confidential, and its bytes are
   not readable from disk.
6. The approver of the request can list and download the attachment.
7. An unrelated user cannot — 403.
8. Delete while pending succeeds; delete after approval is refused.
9. The signed PDF produced on approval is byte-identical whether or not the
   request has attachments.

Check 9 is the one that matters most: it is the executable form of decision 6.

## Rollout

Branch `feature/request-attachments` off master, PR to master, **merge before
deploying**.

Not a branch deploy. The Shz Saab feature was deployed from its branch on
2026-10-03 while its PR stayed open, and a master-triggered WAQF deploy on
2026-10-09 silently reverted it — the workflow still reported success. Merging
first is the only way a feature survives the next unrelated deploy.

## Open items

- **Wording of the attachment line in the approver's email** needs sign-off from
  the owner before it goes to real approvers. Everything else here is decided.
