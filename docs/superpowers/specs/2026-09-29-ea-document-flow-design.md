# Executive-assistant document flow — design

Date: 2026-09-29. HQHB only. Builds on `2026-07-24-executive-assistant-design.md` (delegation) and reuses the folders drag-and-drop pattern (`2026-09-24-document-folders-design.md`).

## Why

An executive assistant (EA) shepherds papers through stages — received, with the CEO, signed, with the CHRO, filed — and today does it outside SignFlow. They need one place to define those stages, move documents through them, collect the signatures the stages call for, and report how long each paper sat where. The CEO and CHRO are the people served; the EA is the only user of the screen.

## Decisions (from the owner)

- The **EA defines their own stages** (no admin template).
- A stage that needs a signature **raises an ordinary SignFlow request** to the executive; nothing about signing changes.
- The **dashboard is EA-only**, for that EA's own boards.
- Documents **enter by upload** into the first stage; no pulling of existing requests.
- **HQHB only**, and **no change for any other role**.

## What the EA sees

A **Document flow** tab in the EA workspace (next to "My account" and the executive switchers), shown only when the deployment organisation is `hqhb` and the signed-in role is `executive_assistant`.

**Boards.** An EA may keep several boards (e.g. "CEO papers", "CHRO letters"). A board has an ordered list of **stages**. The EA creates, renames, reorders and deletes stages; a stage can be deleted only while empty. A stage may be marked **needs signature from …** naming one of the executives that EA is linked to (from `executive_assistants`).

**Cards.** The EA adds a PDF or XLSX with a title and optional note; it lands in the first stage. A card shows the title, file name, who added it, how long it has been in its current stage, and on a signature stage the live request state: *Awaiting <name>*, *Signed*, or *Rejected*.

**Moving.** Drag a card onto another stage (desktop; same HTML5 pattern as folders) or **Move to…** (phones and keyboards). Every move writes one movement row: from stage, to stage, when, by whom. Moving into the last stage marks the document complete.

## Signature stages

- Moving a card **into** a signature stage opens the existing document viewer in placement mode; the EA drags one or more signature boxes, confirms, and the server raises a **direct request** from the EA to the stage's executive using the same code path as *New request → direct*. The executive is notified and signs as today; the EA may approve on their behalf only where the existing delegation already allows it. The request also appears in the EA's normal lists.
- A card **cannot leave** a signature stage until its request is `approved`; the server refuses with 409 ("Waiting for <name> to sign"). If the request is `rejected`, the card may be moved (typically back) and the rejection reason is shown.
- Once signed, the request's **signed PDF becomes the card's current file** for every later stage, so a second signature stage (CHRO after CEO) signs the already-signed copy. Preview and download from the board always serve the current file.

## Dashboard (EA only)

Per board:
- **Timeline table** — one row per document: a proportional strip across the stages showing time spent in each (hover for exact), the current stage, time in it, total elapsed since intake, completed date if done.
- **Stage summary** — documents in each stage now, average and longest dwell time, the oldest card waiting.
- Filters: board, executive (for signature stages), date range (intake). **Export CSV** of the table for reporting upward.

All timings derive from `ea_movements`; nothing is cached.

## Data

```
ea_boards     id, owner_id (EA user), org_id, name (≤60), created_at
ea_stages     id, board_id, name (≤60), position, requires_signature, signer_id (nullable, an executive linked to the owner), created_at
ea_documents  id, board_id, stage_id, title (≤120), note, file_name, file_path, file_type, request_id (nullable; the request raised at the current/last signature stage), created_by, created_at, entered_stage_at, completed_at
ea_movements  id, document_id, from_stage_id (nullable), to_stage_id, moved_at, moved_by, request_id (nullable)
```
Board and stage names are unique per owner/board. Deleting a board requires it to be empty. Cascade on user deletion follows the folders precedent.

## API (`/api/ea-flow`, every route: `authRequired`, `requireRole("executive_assistant")`, `hqhbOnly`)

```
GET    /boards                         → { boards: [{ id, name, stages: [{ id, name, position, requiresSignature, signer }], counts }] }
POST   /boards { name }                 PUT /boards/:id { name }          DELETE /boards/:id (empty only)
POST   /boards/:id/stages { name, requiresSignature, signerId }
PUT    /stages/:id { name, requiresSignature, signerId }   DELETE /stages/:id (empty only)
PUT    /boards/:id/stages/order { stageIds }
GET    /boards/:id/documents            → cards with stage, enteredStageAt, request { id, status, rejectReason, signerName }, currentFile { kind: "original"|"signed" }
POST   /boards/:id/documents (multipart file, title, note) → card in the first stage
GET    /documents/:id/file              → bytes of the current file (signed copy once signed)
PUT    /documents/:id { title, note }   DELETE /documents/:id (only while not in a signature stage with a pending request)
POST   /documents/:id/move { toStageId, boxes? }  → moves; raises the request when entering a signature stage; 409 when leaving one unsigned
GET    /boards/:id/dashboard            → { documents: [{ id, title, stages: [{ stageId, ms }], currentStageId, totalMs, completedAt }], stages: [{ id, name, count, avgMs, maxMs, oldest }] }
```
Every board/stage/document is looked up **with `owner_id = req.user.id`**; anything else answers 404 so nothing is confirmed. `hqhbOnly` answers 404 on any other deployment. `signerId` must be an executive linked to this EA.

## Server-side reuse

`createDirectRequest` in `routes/requests.js` is split into a route wrapper and an exported `raiseDirectRequest({ user, file, signers, note, requestType })` that returns the created row; the EA flow calls it with the card's current bytes. No behaviour change for `POST /api/requests`.

## Tests

- `server/test/ea-flow.integration.mjs` (self-spawning API with `ORG_SLUG=hqhb`): boards/stages CRUD and rules; upload into first stage; move + movement rows + timestamps; signature stage raises a pending direct request to the executive with the EA as requestor; move out refused (409) until `approved`; signed copy becomes the current file; dashboard durations; another EA's board → 404; a second child with `ORG_SLUG=waqf` answers 404.
- Playwright run-through: create board and stages, add a document, drag it, place a signature box, dashboard, phone width.

## Out of scope

Admin or executive views of boards; pulling existing requests onto a board; confidential documents on boards; sub-stages; SLA alerts.
