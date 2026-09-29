# EA Document Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the executive assistant (HQHB only) boards of stages to move documents through, with signature stages that raise ordinary SignFlow requests, timestamped movements, and a dashboard of time spent per stage.

**Architecture:** Four new tables owned by the EA; one new router `/api/ea-flow` gated by role + deployment org; `raiseDirectRequest` extracted from `routes/requests.js` so a signature stage reuses the direct-request path unchanged; a new client view folder `client/src/views/ea-flow/` mounted as a tab in `ExecutiveAssistantView`. Spec: `docs/superpowers/specs/2026-09-29-ea-document-flow-design.md`.

**Tech Stack:** Express + mysql2, multer memory storage, existing filestore (`documents`/`signed` areas), React 18, lucide-react, `DocPreview` from `viewer.jsx` for box placement, HTML5 drag-and-drop as in `FolderStrip`, Playwright in the scratchpad.

---

### Task 1: Tables

**Files:** Modify `server/src/db.js` (after the `folder_items` table).

- [ ] Add `ea_boards`, `ea_stages`, `ea_documents`, `ea_movements` via `tryExec` with the columns in the spec; FKs: boards → users(owner_id) cascade; stages → boards cascade; documents → boards cascade, stage_id restrict; movements → documents cascade. Indexes on `(owner_id)`, `(board_id, position)`, `(board_id, stage_id)`, `(document_id, moved_at)`.
- [ ] `node -e "import('./src/db.js').then(m=>m.initDb()).then(()=>process.exit(0))"` from `server/` creates them. Commit: `ea-flow: four tables — boards, stages, documents, movements`.

### Task 2: `raiseDirectRequest`

**Files:** Modify `server/src/routes/requests.js` (`createDirectRequest`).

- [ ] Split: `export async function raiseDirectRequest({ user, file, ext, fileType, note, instantApproval = 0, signers, requestType = "general", confidential = 0, orientation = null, deferNotify = false })` returning `{ row }` or throwing a `DirectRequestError(status, message)`; `createDirectRequest` becomes a thin wrapper that maps the error to `res.status().json()` and answers `hydrateRequest(row)`. Zero behaviour change for `POST /api/requests`.
- [ ] Run `node test/direct.integration.mjs` and `node test/direct-multi.integration.mjs` (server on :5001) — same results as before. Commit: `requests: raiseDirectRequest, so another feature can route a document to a signer`.

### Task 3: Router `/api/ea-flow` (TDD)

**Files:** Create `server/src/routes/ea-flow.js`, `server/test/ea-flow.integration.mjs`; modify `server/src/index.js` (mount).

- [ ] Write the integration test first (self-spawning API with `ORG_SLUG: "hqhb"`; a 1-page PDF made with pdf-lib as the upload; EA `E`, executive `X` linked via `executive_assistants`, another EA `O`): boards CRUD + 409 on duplicate name + delete-only-empty; stages add/rename/reorder/delete-only-empty + signer must be linked; upload lands in stage 1 with a movement row (from null); move writes a movement with `moved_by`; entering a signature stage without boxes → 400, with boxes → request created (`requestor_id = E`, signer `X`, status pending, `ea_documents.request_id` set); move out → 409; set request approved + signed_file_path in DB → move out 200, `completed_at` set on last stage; `/file` serves the signed copy; dashboard: per-document stage ms sums to total, stage counts; `O` gets 404 on E's board/stage/document; unauthenticated 401; requestor role 403; second child with `ORG_SLUG: "waqf"` → 404 on `GET /boards`.
- [ ] Run → fails (404 route). Implement the router per the spec's API; mount `app.use("/api/ea-flow", eaFlowRoutes)`. `hqhbOnly = (req,res,next) => deploymentOrg() === "hqhb" ? next() : res.status(404).end()`.
- [ ] Run → all pass. Commit: `ea-flow: boards, stages, documents and movements — the assistant's own, HQHB only`.

### Task 4: Client API

**Files:** Modify `client/src/api.js` (after the folders block).

- [ ] `eaBoards()`, `eaCreateBoard(name)`, `eaRenameBoard(id,name)`, `eaDeleteBoard(id)`, `eaAddStage(boardId, body)`, `eaUpdateStage(id, body)`, `eaDeleteStage(id)`, `eaOrderStages(boardId, stageIds)`, `eaDocuments(boardId)`, `eaAddDocument(boardId, { file, title, note })` (FormData), `eaDocumentFileUrl(id)` (raw → blob URL), `eaUpdateDocument(id, body)`, `eaDeleteDocument(id)`, `eaMove(id, { toStageId, boxes })`, `eaDashboard(boardId)`. Commit: `ea-flow: client calls`.

### Task 5: Client views

**Files:** Create `client/src/views/ea-flow/FlowTab.jsx`, `Board.jsx`, `StageEditor.jsx`, `AddDocument.jsx`, `PlaceSignature.jsx`, `Dashboard.jsx`, `time.js`; modify `client/src/views/ExecutiveAssistantView.jsx` (tab), `client/src/App.jsx` line ~702 (`orgId={orgId}` on the EA view only).

- [ ] `time.js`: `fmtDuration(ms)` → "3d 4h", "2h 15m", "40m", "<1m".
- [ ] `FlowTab`: board switcher (pills) + "New board"; Board | Dashboard toggle; empty state explaining stages.
- [ ] `Board`: columns per stage (header: name, count, ✎ menu rename/signature/delete, drag handle for reorder via ↑/↓ buttons); cards draggable (`text/x-ea-document`), drop on column; **Move to…** menu per card; "Add document" button opens `AddDocument` (file, title, note); card chips: time in stage, request state on signature stages (Awaiting / Signed / Rejected with reason), Preview (existing DocPreview in a modal) and Download (current file).
- [ ] `PlaceSignature`: modal with `DocPreview` (`editable`, `markers`, `onAddMarker/onUpdateMarker/onDeleteMarker`), signer name, Confirm → `eaMove(id, { toStageId, boxes })`. Triggered by any move into a signature stage (drag or menu).
- [ ] `Dashboard`: stage summary cards; timeline table with proportional segments (stage colours from a fixed palette), current stage highlighted, total; filters; CSV export (client-side).
- [ ] `ExecutiveAssistantView`: when `orgId === "hqhb"`, add a `Document flow` switch tab (icon `KanbanSquare`) rendering `FlowTab`. Nothing else changes.
- [ ] `npm run build` passes. Commits per component group.

### Task 6: Browser run-through

- [ ] Local: ensure an EA user exists linked to an executive (create locally if needed). Playwright `shot-eaflow.mjs`: create board, three stages (middle one signature → executive), add PDF, drag to stage 2 → placement modal → place box → confirm → card shows "Awaiting"; mark approved in DB; drag to stage 3; dashboard shows durations; phone width shows Move to…. Screenshots `eaflow-1..5.png`. Re-run server tests + build.

### Task 7: Hand over

- [ ] Show the owner locally (login as the EA); push branch and open PR against `master` only when they say so; merge only on explicit go-ahead.
