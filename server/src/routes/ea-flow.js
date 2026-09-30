// ============================================================
//   THE EXECUTIVE ASSISTANT'S DOCUMENT FLOW  (HQHB only)
//   ------------------------------------------------------------
//   An assistant keeps boards. A board is an ordered list of stages the
//   assistant names; documents are uploaded into the first stage and moved
//   from stage to stage. Every move writes one ea_movements row — that trail
//   is the whole basis of the dashboard's "how long did it sit where".
//
//   A stage may call for an executive's signature. Moving a document INTO such
//   a stage raises an ordinary direct request from the assistant to that
//   executive (raiseDirectRequest — the same path as New request → direct), so
//   signing, notifications and the signed copy work exactly as they always
//   have. The document cannot leave that stage until the request is approved,
//   and from then on the signed copy is the document's current file, so a
//   later signature stage signs the already-signed paper.
//
//   Everything is scoped to the owning assistant: another assistant's board,
//   stage or document answers 404, not 403, so nothing is confirmed. The whole
//   router is absent on any deployment other than HQHB.
// ============================================================
import { Router } from "express";
import multer from "multer";
import { query, queryOne, execute } from "../db.js";
import { authRequired, requireRole } from "../auth.js";
import { deploymentOrg } from "../org.js";
import { readStored, writeStored, deleteStored } from "../filestore.js";
import { raiseDirectRequest, DirectRequestError } from "./requests.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const uid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const MAX_NAME = 60, MAX_TITLE = 120;
const tidy = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

// The feature exists on HQHB deployments only. Checked before authentication
// so a WAQF box does not even reveal that the routes are there.
const hqhbOnly = (req, res, next) => (deploymentOrg() === "hqhb" ? next() : res.status(404).end());
router.use(hqhbOnly, authRequired, requireRole("executive_assistant"));

// ---------- lookups, always scoped to the signed-in assistant ----------
const myBoard = (uid_, id) => queryOne("SELECT * FROM ea_boards WHERE id = ? AND owner_id = ?", [id, uid_]);
const myStage = (uid_, id) => queryOne(
  "SELECT s.* FROM ea_stages s JOIN ea_boards b ON b.id = s.board_id WHERE s.id = ? AND b.owner_id = ?", [id, uid_]);
const myDoc = (uid_, id) => queryOne(
  "SELECT d.* FROM ea_documents d JOIN ea_boards b ON b.id = d.board_id WHERE d.id = ? AND b.owner_id = ?", [id, uid_]);
const boardStages = (boardId) => query("SELECT * FROM ea_stages WHERE board_id = ? ORDER BY position ASC", [boardId]);
// Anyone with the Executive role may be named by a signature stage — not only
// the executives this assistant is linked to. (The owner asked for every
// executive signatory to be available; a linked executive is still what the
// assistant needs to approve ON BEHALF of someone, which is a separate right.)
const signableExecutives = () => query("SELECT id, name, email FROM users WHERE role = 'executive' AND active = 1 ORDER BY name");
const signableExecutive = (execId) => queryOne("SELECT id, name FROM users WHERE id = ? AND role = 'executive' AND active = 1", [execId]);

async function stageOut(s) {
  const signer = s.signer_id ? await queryOne("SELECT id, name FROM users WHERE id = ?", [s.signer_id]) : null;
  return { id: s.id, boardId: s.board_id, name: s.name, position: s.position, requiresSignature: !!s.requires_signature, signer: signer ? { id: signer.id, name: signer.name } : null };
}

// The request a card raised at its latest signature stage, if any.
async function requestFor(d) {
  if (!d.request_id) return null;
  const r = await queryOne("SELECT * FROM requests WHERE id = ?", [d.request_id]);
  if (!r) return null;
  const sg = await queryOne(
    `SELECT u.name FROM request_step_signers sg JOIN request_steps st ON st.id = sg.step_id JOIN users u ON u.id = sg.user_id
      WHERE st.request_id = ? ORDER BY sg.signer_order LIMIT 1`, [r.id]);
  return { id: r.id, status: r.status, rejectReason: r.reject_reason || null, signerName: sg?.name || null, signedFilePath: r.signed_file_path || null };
}
const isSigned = (rq) => !!(rq && rq.status === "approved" && rq.signedFilePath);
const isWaiting = (rq) => !!(rq && (rq.status === "pending" || rq.status === "approved_pending"));

async function docOut(d, stageById) {
  const rq = await requestFor(d);
  const stage = stageById?.[d.stage_id] || await queryOne("SELECT * FROM ea_stages WHERE id = ?", [d.stage_id]);
  const by = await queryOne("SELECT name FROM users WHERE id = ?", [d.created_by]);
  return {
    id: d.id, boardId: d.board_id, stageId: d.stage_id, title: d.title, note: d.note || "",
    fileName: d.file_name, fileType: d.file_type, createdAt: Number(d.created_at), createdBy: by?.name || null,
    enteredStageAt: Number(d.entered_stage_at), completedAt: d.completed_at ? Number(d.completed_at) : null,
    // Shown on the card only while the card sits on a signature stage; the
    // signed copy stays the current file wherever the card goes afterwards.
    request: stage?.requires_signature && rq ? { id: rq.id, status: rq.status, rejectReason: rq.rejectReason, signerName: rq.signerName } : null,
    currentFile: isSigned(rq) ? "signed" : "original",
    waitingForSignature: !!stage?.requires_signature && isWaiting(rq),
  };
}

// GET /executives — everyone a signature stage may name.
router.get("/executives", async (req, res, next) => {
  try { res.json({ executives: await signableExecutives() }); } catch (e) { next(e); }
});

// ============================================================
//   boards
// ============================================================
router.get("/boards", async (req, res, next) => {
  try {
    const boards = await query("SELECT * FROM ea_boards WHERE owner_id = ? ORDER BY created_at", [req.user.id]);
    const out = [];
    for (const b of boards) {
      const stages = await boardStages(b.id);
      const counts = await query("SELECT stage_id, COUNT(*) AS n FROM ea_documents WHERE board_id = ? GROUP BY stage_id", [b.id]);
      const countBy = Object.fromEntries(counts.map((c) => [c.stage_id, Number(c.n)]));
      out.push({ id: b.id, name: b.name, createdAt: Number(b.created_at),
        stages: await Promise.all(stages.map(async (s) => ({ ...(await stageOut(s)), count: countBy[s.id] || 0 }))),
        documentCount: Object.values(countBy).reduce((a, n) => a + n, 0) });
    }
    res.json({ boards: out });
  } catch (e) { next(e); }
});

function validName(name, res, what = "board") {
  if (!name) { res.status(400).json({ error: `Give the ${what} a name` }); return false; }
  if (name.length > MAX_NAME) { res.status(400).json({ error: `Keep the ${what} name under ${MAX_NAME} characters` }); return false; }
  return true;
}

router.post("/boards", async (req, res, next) => {
  try {
    const name = tidy(req.body?.name);
    if (!validName(name, res)) return;
    if (await queryOne("SELECT id FROM ea_boards WHERE owner_id = ? AND name = ?", [req.user.id, name]))
      return res.status(409).json({ error: `You already have a board called "${name}"` });
    const id = uid("eab");
    await execute("INSERT INTO ea_boards (id, owner_id, org_id, name, created_at) VALUES (?, ?, ?, ?, ?)", [id, req.user.id, deploymentOrg(), name, Date.now()]);
    res.json({ board: { id, name, stages: [], documentCount: 0 } });
  } catch (e) { next(e); }
});

router.put("/boards/:id", async (req, res, next) => {
  try {
    const b = await myBoard(req.user.id, req.params.id);
    if (!b) return res.status(404).json({ error: "Not found" });
    const name = tidy(req.body?.name);
    if (!validName(name, res)) return;
    const clash = await queryOne("SELECT id FROM ea_boards WHERE owner_id = ? AND name = ? AND id <> ?", [req.user.id, name, b.id]);
    if (clash) return res.status(409).json({ error: `You already have a board called "${name}"` });
    await execute("UPDATE ea_boards SET name = ? WHERE id = ?", [name, b.id]);
    res.json({ board: { id: b.id, name } });
  } catch (e) { next(e); }
});

// A board goes only when nothing is on it — its documents are someone's papers.
router.delete("/boards/:id", async (req, res, next) => {
  try {
    const b = await myBoard(req.user.id, req.params.id);
    if (!b) return res.status(404).json({ error: "Not found" });
    const n = await queryOne("SELECT COUNT(*) AS n FROM ea_documents WHERE board_id = ?", [b.id]);
    if (Number(n.n) > 0) return res.status(409).json({ error: "Remove or finish its documents first" });
    await execute("DELETE FROM ea_boards WHERE id = ?", [b.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ============================================================
//   stages
// ============================================================
// Reads the signature settings off a body and checks the executive is one of
// this assistant's. Returns { requiresSignature, signerId } or an error string.
async function signatureSettings(req, body, current = null) {
  const requiresSignature = body.requiresSignature === undefined ? !!current?.requires_signature : !!body.requiresSignature;
  if (!requiresSignature) return { requiresSignature: 0, signerId: null };
  const signerId = body.signerId === undefined ? current?.signer_id : (body.signerId || null);
  if (!signerId) return "Choose whose signature this stage needs";
  if (!(await signableExecutive(signerId))) return "Choose one of the executives";
  return { requiresSignature: 1, signerId };
}

router.post("/boards/:id/stages", async (req, res, next) => {
  try {
    const b = await myBoard(req.user.id, req.params.id);
    if (!b) return res.status(404).json({ error: "Not found" });
    const name = tidy(req.body?.name);
    if (!validName(name, res, "stage")) return;
    if (await queryOne("SELECT id FROM ea_stages WHERE board_id = ? AND name = ?", [b.id, name]))
      return res.status(409).json({ error: `This board already has a stage called "${name}"` });
    const sig = await signatureSettings(req, req.body || {});
    if (typeof sig === "string") return res.status(400).json({ error: sig });
    const last = await queryOne("SELECT COALESCE(MAX(position), 0) AS p FROM ea_stages WHERE board_id = ?", [b.id]);
    const id = uid("eas");
    await execute("INSERT INTO ea_stages (id, board_id, name, position, requires_signature, signer_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, b.id, name, Number(last.p) + 1, sig.requiresSignature, sig.signerId, Date.now()]);
    res.json({ stage: { ...(await stageOut(await queryOne("SELECT * FROM ea_stages WHERE id = ?", [id]))), count: 0 } });
  } catch (e) { next(e); }
});

router.put("/stages/:id", async (req, res, next) => {
  try {
    const s = await myStage(req.user.id, req.params.id);
    if (!s) return res.status(404).json({ error: "Not found" });
    const name = req.body?.name === undefined ? s.name : tidy(req.body.name);
    if (!validName(name, res, "stage")) return;
    const clash = await queryOne("SELECT id FROM ea_stages WHERE board_id = ? AND name = ? AND id <> ?", [s.board_id, name, s.id]);
    if (clash) return res.status(409).json({ error: `This board already has a stage called "${name}"` });
    const sig = await signatureSettings(req, req.body || {}, s);
    if (typeof sig === "string") return res.status(400).json({ error: sig });
    await execute("UPDATE ea_stages SET name = ?, requires_signature = ?, signer_id = ? WHERE id = ?", [name, sig.requiresSignature, sig.signerId, s.id]);
    const n = await queryOne("SELECT COUNT(*) AS n FROM ea_documents WHERE stage_id = ?", [s.id]);
    res.json({ stage: { ...(await stageOut(await queryOne("SELECT * FROM ea_stages WHERE id = ?", [s.id]))), count: Number(n.n) } });
  } catch (e) { next(e); }
});

router.delete("/stages/:id", async (req, res, next) => {
  try {
    const s = await myStage(req.user.id, req.params.id);
    if (!s) return res.status(404).json({ error: "Not found" });
    const n = await queryOne("SELECT COUNT(*) AS n FROM ea_documents WHERE stage_id = ?", [s.id]);
    if (Number(n.n) > 0) return res.status(409).json({ error: "Move its documents to another stage first" });
    await execute("DELETE FROM ea_stages WHERE id = ?", [s.id]);
    // Close the gap so positions stay 1..n.
    const rest = await boardStages(s.board_id);
    for (let i = 0; i < rest.length; i++) await execute("UPDATE ea_stages SET position = ? WHERE id = ?", [i + 1, rest[i].id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// PUT /boards/:id/stages/order { stageIds } — the full list, in the new order.
router.put("/boards/:id/stages/order", async (req, res, next) => {
  try {
    const b = await myBoard(req.user.id, req.params.id);
    if (!b) return res.status(404).json({ error: "Not found" });
    const ids = Array.isArray(req.body?.stageIds) ? req.body.stageIds.map(String) : null;
    const current = (await boardStages(b.id)).map((s) => s.id);
    if (!ids || ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.includes(id)))
      return res.status(400).json({ error: "Send every stage of the board, once, in the new order" });
    for (let i = 0; i < ids.length; i++) await execute("UPDATE ea_stages SET position = ? WHERE id = ?", [i + 1, ids[i]]);
    res.json({ stages: await Promise.all((await boardStages(b.id)).map(stageOut)) });
  } catch (e) { next(e); }
});

// ============================================================
//   documents
// ============================================================
router.get("/boards/:id/documents", async (req, res, next) => {
  try {
    const b = await myBoard(req.user.id, req.params.id);
    if (!b) return res.status(404).json({ error: "Not found" });
    const stages = await boardStages(b.id);
    const stageById = Object.fromEntries(stages.map((s) => [s.id, s]));
    const docs = await query("SELECT * FROM ea_documents WHERE board_id = ? ORDER BY entered_stage_at ASC", [b.id]);
    res.json({ documents: await Promise.all(docs.map((d) => docOut(d, stageById))) });
  } catch (e) { next(e); }
});

// POST /boards/:id/documents  multipart: file, title, note — into the first stage.
router.post("/boards/:id/documents", upload.single("file"), async (req, res, next) => {
  try {
    const b = await myBoard(req.user.id, req.params.id);
    if (!b) return res.status(404).json({ error: "Not found" });
    const first = (await boardStages(b.id))[0];
    if (!first) return res.status(400).json({ error: "Add a stage to the board first" });
    const file = req.file;
    if (!file) return res.status(400).json({ error: "file is required" });
    const ext = (file.originalname.split(".").pop() || "").toLowerCase();
    if (!["pdf", "xlsx", "xls"].includes(ext)) return res.status(400).json({ error: "Only PDF or Excel accepted" });
    const fileType = ext === "pdf" ? "pdf" : "xlsx";
    const title = tidy(req.body?.title) || tidy(file.originalname.replace(/\.[^.]+$/, ""));
    if (title.length > MAX_TITLE) return res.status(400).json({ error: `Keep the title under ${MAX_TITLE} characters` });
    const note = String(req.body?.note || "").trim().slice(0, 2000);
    const id = uid("ead");
    const storedName = await writeStored("documents", `${id}.${ext}`, file.buffer,
      { contentType: ext === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const now = Date.now();
    await execute(
      `INSERT INTO ea_documents (id, board_id, stage_id, title, note, file_name, file_path, file_type, request_id, created_by, created_at, entered_stage_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)`,
      [id, b.id, first.id, title, note, file.originalname, storedName, fileType, req.user.id, now, now]);
    await execute("INSERT INTO ea_movements (id, document_id, from_stage_id, to_stage_id, moved_at, moved_by, request_id) VALUES (?, ?, NULL, ?, ?, ?, NULL)",
      [uid("eam"), id, first.id, now, req.user.id]);
    res.json({ document: await docOut(await queryOne("SELECT * FROM ea_documents WHERE id = ?", [id])) });
  } catch (e) { next(e); }
});

// The card's current bytes: the signed copy once its latest request is
// approved, the upload otherwise.
async function currentBytes(d) {
  const rq = await requestFor(d);
  if (isSigned(rq)) return { bytes: await readStored("signed", rq.signedFilePath), signed: true };
  return { bytes: await readStored("documents", d.file_path), signed: false };
}

router.get("/documents/:id/file", async (req, res, next) => {
  try {
    const d = await myDoc(req.user.id, req.params.id);
    if (!d) return res.status(404).json({ error: "Not found" });
    const { bytes } = await currentBytes(d);
    res.setHeader("Content-Type", d.file_type === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(d.file_name)}`);
    res.send(bytes);
  } catch (e) { next(e); }
});

router.put("/documents/:id", async (req, res, next) => {
  try {
    const d = await myDoc(req.user.id, req.params.id);
    if (!d) return res.status(404).json({ error: "Not found" });
    const title = req.body?.title === undefined ? d.title : tidy(req.body.title);
    if (!title || title.length > MAX_TITLE) return res.status(400).json({ error: `Give the document a title under ${MAX_TITLE} characters` });
    const note = req.body?.note === undefined ? d.note : String(req.body.note || "").trim().slice(0, 2000);
    await execute("UPDATE ea_documents SET title = ?, note = ? WHERE id = ?", [title, note, d.id]);
    res.json({ document: await docOut(await queryOne("SELECT * FROM ea_documents WHERE id = ?", [d.id])) });
  } catch (e) { next(e); }
});

// Removing a card removes the upload and its trail; a request it raised is a
// real request and stays. Not while an executive is being asked to sign it.
router.delete("/documents/:id", async (req, res, next) => {
  try {
    const d = await myDoc(req.user.id, req.params.id);
    if (!d) return res.status(404).json({ error: "Not found" });
    const rq = await requestFor(d);
    if (isWaiting(rq)) return res.status(409).json({ error: `Waiting for ${rq.signerName || "the executive"} to sign — withdraw that request first` });
    await execute("DELETE FROM ea_documents WHERE id = ?", [d.id]);
    deleteStored("documents", d.file_path).catch(() => {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /documents/:id/move { toStageId, boxes? }
// Entering a signature stage needs the signature box(es) and raises the request;
// leaving one needs the request to be settled.
router.post("/documents/:id/move", async (req, res, next) => {
  try {
    const d = await myDoc(req.user.id, req.params.id);
    if (!d) return res.status(404).json({ error: "Not found" });
    const to = await myStage(req.user.id, String(req.body?.toStageId || ""));
    if (!to || to.board_id !== d.board_id) return res.status(400).json({ error: "Choose a stage on this board" });
    if (to.id === d.stage_id) return res.status(400).json({ error: "The document is already there" });
    const from = await queryOne("SELECT * FROM ea_stages WHERE id = ?", [d.stage_id]);
    const rq = await requestFor(d);

    if (from?.requires_signature && isWaiting(rq)) {
      return res.status(409).json({ error: `Waiting for ${rq.signerName || "the executive"} to sign` });
    }

    let raised = null;
    if (to.requires_signature) {
      const boxes = Array.isArray(req.body?.boxes) ? req.body.boxes : [];
      if (!boxes.length || boxes.some((b) => ["x", "y", "w", "h"].some((k) => typeof b?.[k] !== "number")))
        return res.status(400).json({ error: "Place the signature box on the document first" });
      const signer = to.signer_id && await signableExecutive(to.signer_id);
      if (!signer) return res.status(400).json({ error: "This stage's executive is no longer available — edit the stage" });
      const { bytes } = await currentBytes(d);
      const ext = d.file_type === "pdf" ? "pdf" : "xlsx";
      try {
        raised = await raiseDirectRequest({
          user: req.user,
          file: { buffer: bytes, originalname: d.file_name },
          ext, fileType: d.file_type, note: d.note || "",
          signers: [{ userId: signer.id, boxes: boxes.map((b) => ({ page: Number(b.page) || 1, x: b.x, y: b.y, w: b.w, h: b.h })), dateFields: [] }],
          requestType: "document",
        });
      } catch (e) {
        if (e instanceof DirectRequestError) return res.status(e.status).json({ error: e.message });
        throw e;
      }
    }

    const last = (await boardStages(d.board_id)).at(-1);
    const now = Date.now();
    await execute(
      "UPDATE ea_documents SET stage_id = ?, entered_stage_at = ?, request_id = COALESCE(?, request_id), completed_at = ? WHERE id = ?",
      [to.id, now, raised?.id || null, last && last.id === to.id ? now : null, d.id]);
    await execute("INSERT INTO ea_movements (id, document_id, from_stage_id, to_stage_id, moved_at, moved_by, request_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [uid("eam"), d.id, d.stage_id, to.id, now, req.user.id, raised?.id || null]);
    res.json({ document: await docOut(await queryOne("SELECT * FROM ea_documents WHERE id = ?", [d.id])) });
  } catch (e) { next(e); }
});

// ============================================================
//   dashboard — where each document sat, and for how long
// ============================================================
// Everything here is derived from ea_movements: a card's time in a stage runs
// from the move that brought it there to the next move (or now). A completed
// card's clock stops at completed_at, so its final stage shows no dwell time.
router.get("/boards/:id/dashboard", async (req, res, next) => {
  try {
    const b = await myBoard(req.user.id, req.params.id);
    if (!b) return res.status(404).json({ error: "Not found" });
    const stages = await boardStages(b.id);
    const docs = await query("SELECT * FROM ea_documents WHERE board_id = ? ORDER BY created_at ASC", [b.id]);
    const now = Date.now();
    const perStage = Object.fromEntries(stages.map((s) => [s.id, { id: s.id, name: s.name, requiresSignature: !!s.requires_signature, count: 0, sumMs: 0, spells: 0, maxMs: 0, oldestMs: 0 }]));
    const out = [];
    for (const d of docs) {
      const moves = await query("SELECT * FROM ea_movements WHERE document_id = ? ORDER BY moved_at ASC, id ASC", [d.id]);
      const end = d.completed_at ? Number(d.completed_at) : now;
      const dwell = Object.fromEntries(stages.map((s) => [s.id, 0]));
      for (let i = 0; i < moves.length; i++) {
        const start = Number(moves[i].moved_at);
        const stop = i + 1 < moves.length ? Number(moves[i + 1].moved_at) : end;
        const ms = Math.max(0, stop - start);
        if (dwell[moves[i].to_stage_id] !== undefined) dwell[moves[i].to_stage_id] += ms;
        const agg = perStage[moves[i].to_stage_id];
        if (agg) { agg.sumMs += ms; agg.spells += 1; agg.maxMs = Math.max(agg.maxMs, ms); }
      }
      const cur = perStage[d.stage_id];
      if (cur) { cur.count += 1; if (!d.completed_at) cur.oldestMs = Math.max(cur.oldestMs, now - Number(d.entered_stage_at)); }
      const rq = await requestFor(d);
      out.push({
        id: d.id, title: d.title, fileName: d.file_name, createdAt: Number(d.created_at), completedAt: d.completed_at ? Number(d.completed_at) : null,
        currentStageId: d.stage_id, enteredStageAt: Number(d.entered_stage_at), totalMs: Math.max(0, end - Number(d.created_at)),
        stages: stages.map((s) => ({ stageId: s.id, ms: dwell[s.id] })),
        signerName: rq?.signerName || null, requestStatus: rq?.status || null,
      });
    }
    res.json({
      board: { id: b.id, name: b.name },
      stages: stages.map((s) => { const a = perStage[s.id]; return { id: s.id, name: s.name, requiresSignature: a.requiresSignature, count: a.count, avgMs: a.spells ? Math.round(a.sumMs / a.spells) : 0, maxMs: a.maxMs, oldestMs: a.oldestMs }; }),
      documents: out,
    });
  } catch (e) { next(e); }
});

export default router;
