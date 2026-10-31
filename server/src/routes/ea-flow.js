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
import { authRequired, requireRole, SIGNER_ROLES } from "../auth.js";
import { deploymentOrg } from "../org.js";
import { readStored, writeStored, deleteStored } from "../filestore.js";
import { raiseDirectRequest, DirectRequestError } from "./requests.js";
import { UPLOAD_CEILING_BYTES, uploadSizeError } from "../uploadLimits.js";
import { sendEmail } from "../email.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_CEILING_BYTES } });
const uid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const MAX_NAME = 60, MAX_TITLE = 120;
const tidy = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
// Signature boxes arrive as JSON on a multipart upload and as a real array on a
// JSON move. Accept either, and never throw on malformed input — enterStage
// already refuses an empty list with a message the assistant can act on.
function parseBoxes(v) {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string" || !v.trim()) return [];
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
}

// Boxes laid out ahead of time, as { stageId: [box, …] }. Always an object, so
// callers can index it without checking — a document with no plan simply has
// nothing under any stage.
function plannedBoxesFor(doc) {
  if (!doc?.planned_boxes_json) return {};
  try {
    const p = JSON.parse(doc.planned_boxes_json);
    return p && typeof p === "object" && !Array.isArray(p) ? p : {};
  } catch { return {}; }
}

// One box is only a box if it carries four numbers. Checked on the way IN, so a
// plan can never be stored in a shape that would fail days later, at the moment
// the card finally reaches the stage.
const validBox = (b) => ["x", "y", "w", "h"].every((k) => typeof b?.[k] === "number");

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
// Who the Document flow may name — to sign, to be copied, or to review: the
// Executive Management, i.e. users with the Executive role. Not every Approver
// (owner, 2026-10-31: "only the executive management names and not all the
// staff"), and not only the executives this assistant is linked to (being
// linked is the separate right to act ON BEHALF of someone).
//
// A stage set up before this rule may still name an Approver. It keeps working
// — `stillSignable` below admits any signer role for a person ALREADY on the
// stage — but nobody new outside Executive Management can be chosen.
// No email on the wire: the pickers show names only (privacy.js).
// (The wire name stays `executives` — historical, and the client reads it.)
const signableExecutives = () => query(
  "SELECT id, name, role FROM users WHERE role = 'executive' AND active = 1 ORDER BY name");
const signableExecutive = (execId) => queryOne(
  "SELECT id, name, role FROM users WHERE id = ? AND role = 'executive' AND active = 1", [execId]);
const ROLE_PLACEHOLDERS = SIGNER_ROLES.map(() => "?").join(",");
const stillSignable = (id) => queryOne(
  `SELECT id, name, role FROM users WHERE id = ? AND role IN (${ROLE_PLACEHOLDERS}) AND active = 1`,
  [id, ...SIGNER_ROLES]);

// What a stage asks of its person. stage_kind is authoritative; the fallback to
// requires_signature covers a row written by the previous build during a deploy,
// before the backfill has run.
const kindOf = (s) => s?.stage_kind || (s?.requires_signature ? "signature" : "plain");
const needsSignature = (s) => kindOf(s) === "signature";
const isCc = (s) => kindOf(s) === "cc";

// Everyone a CC stage copies, in a stable order. Empty for any other kind.
// Inactive people drop out here rather than being told about documents.
const ccRecipients = (stageId) => query(
  `SELECT u.id, u.name, u.role FROM ea_stage_cc c JOIN users u ON u.id = c.user_id
    WHERE c.stage_id = ? AND u.active = 1 ORDER BY u.name`, [stageId]);

async function stageOut(s) {
  const signer = s.signer_id ? await queryOne("SELECT id, name FROM users WHERE id = ?", [s.signer_id]) : null;
  const cc = isCc(s) ? await ccRecipients(s.id) : [];
  return {
    id: s.id, boardId: s.board_id, name: s.name, position: s.position,
    kind: kindOf(s),
    // Kept so an older client still understands a signature stage.
    requiresSignature: needsSignature(s),
    // `signer` is the ONE person who signs; `ccPeople` is the many who are
    // merely shown it. A CC stage reports its first recipient as `signer` too,
    // so a client from before this change names somebody rather than nobody.
    signer: signer ? { id: signer.id, name: signer.name } : (cc[0] ? { id: cc[0].id, name: cc[0].name } : null),
    ccPeople: cc.map((u) => ({ id: u.id, name: u.name, role: u.role })),
  };
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
  // Has THIS visit to a signature stage asked anybody yet? The card's request
  // may belong to an earlier stage — or the stage may only have been set to
  // "Signs" after the card arrived — and then nobody here has been asked.
  const askedHere = needsSignature(stage) ? !!(await arrivalIn(d))?.request_id : false;
  return {
    id: d.id, boardId: d.board_id, stageId: d.stage_id, title: d.title, note: d.note || "",
    fileName: d.file_name, fileType: d.file_type, createdAt: Number(d.created_at), createdBy: by?.name || null,
    enteredStageAt: Number(d.entered_stage_at), completedAt: d.completed_at ? Number(d.completed_at) : null,
    // Shown on the card only while the card sits on a signature stage; the
    // signed copy stays the current file wherever the card goes afterwards.
    request: askedHere && rq ? { id: rq.id, status: rq.status, rejectReason: rq.rejectReason, signerName: rq.signerName } : null,
    currentFile: isSigned(rq) ? "signed" : "original",
    waitingForSignature: askedHere && isWaiting(rq),
    // On a signature stage that has not asked anyone: the board offers "Send".
    notSent: needsSignature(stage) && !askedHere,
    // On a CC stage the card is never held; what the assistant wants to see is
    // whether the person has actually opened it yet.
    cc: isCc(stage) ? await ccStateFor(d.id, stage.id) : null,
    // Sent for review by hand, independent of any stage — it stays with the
    // card as it moves, because the ask was about the paper, not the step.
    review: await reviewStateFor(d.id),
    // Boxes laid out ahead of time, so the board can show how much of the
    // paper is already prepared and the editor can reopen the same layout.
    plannedBoxes: plannedBoxesFor(d),
  };
}

// Tell someone a document is waiting for their eyes at a CC stage.
//
// The notice row is what makes this reportable and what grants them access to
// read the file; the email is a courtesy on top. A re-entry into the same stage
// refreshes the notice and clears viewed_at, because it is a fresh ask about a
// document that may since have been signed by someone else.
//
// The email is deliberately not awaited: a card must still move when SendGrid
// is slow or unconfigured, exactly as the rest of the app treats notification.
async function noticeCc({ doc, stage, person, at, source = "stage" }) {
  if (source === "adhoc") {
    // Belongs to the document rather than a stage, so the unique key cannot
    // catch a repeat — refresh by hand, which is also what makes sending the
    // same person a second time an "ask again" instead of a duplicate row.
    const existing = await queryOne(
      "SELECT id FROM ea_cc_notices WHERE document_id = ? AND user_id = ? AND stage_id IS NULL", [doc.id, person.id]);
    if (existing) {
      await execute("UPDATE ea_cc_notices SET notified_at = ?, viewed_at = NULL WHERE id = ?", [at, existing.id]);
    } else {
      await execute(
        `INSERT INTO ea_cc_notices (id, document_id, stage_id, user_id, notified_at, viewed_at, source)
         VALUES (?, ?, NULL, ?, ?, NULL, 'adhoc')`,
        [uid("eacc"), doc.id, person.id, at]);
    }
  } else {
    await execute(
      `INSERT INTO ea_cc_notices (id, document_id, stage_id, user_id, notified_at, viewed_at, source)
       VALUES (?, ?, ?, ?, ?, NULL, 'stage')
       ON DUPLICATE KEY UPDATE notified_at = VALUES(notified_at), viewed_at = NULL`,
      [uid("eacc"), doc.id, stage.id, person.id, at]);
  }
  const to = await queryOne("SELECT email, name FROM users WHERE id = ?", [person.id]);
  if (!to?.email) return;
  sendEmail({
    to: to.email,
    template: "ea_cc_notice",
    // A one-off review has no stage to name; the email simply says it was
    // shared to read, which is all the reader needs to know either way.
    ctx: { name: to.name, title: doc.title, stageName: source === "adhoc" ? "" : stage?.name, documentId: doc.id },
  }).catch(() => {});
}

// The same 24 hours a request reminder waits. One number and one habit: an
// assistant should not have to learn that nudging a reader works differently
// from nudging a signer.
const CC_REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Everyone told to look at this document at this stage, and whether they have.
// A list because a CC stage copies several people, and "two of five have read
// it" is the thing the assistant actually needs to know.
function summariseNotices(rows) {
  if (!rows.length) return null;
  const people = rows.map((n) => ({
    name: n.name, notifiedAt: Number(n.notified_at), viewedAt: n.viewed_at ? Number(n.viewed_at) : null,
    remindedAt: n.reminded_at ? Number(n.reminded_at) : null, reminders: Number(n.reminder_count || 0),
  }));
  const unread = people.filter((p) => !p.viewedAt);
  // When the next nudge is allowed, worked out here so the button can SAY so
  // rather than the assistant discovering it from a refusal.
  const lastReminder = unread.reduce((m, p) => Math.max(m, p.remindedAt || 0), 0);
  return {
    people, notified: people.length, viewed: people.length - unread.length,
    canRemind: unread.length > 0,
    remindableAt: lastReminder ? lastReminder + CC_REMINDER_COOLDOWN_MS : 0,
  };
}

const NOTICE_COLUMNS = `n.notified_at, n.viewed_at, n.reminded_at, n.reminder_count, u.name`;

async function ccStateFor(documentId, stageId) {
  // source = 'stage' only: a one-off review must not be counted as the CC
  // stage having done its job.
  return summariseNotices(await query(
    `SELECT ${NOTICE_COLUMNS} FROM ea_cc_notices n JOIN users u ON u.id = n.user_id
      WHERE n.document_id = ? AND n.stage_id = ? AND n.source = 'stage' ORDER BY u.name`,
    [documentId, stageId]));
}

// One-off reviews follow the DOCUMENT, so they are read without a stage and
// stay on the card wherever it goes.
async function reviewStateFor(documentId) {
  return summariseNotices(await query(
    `SELECT ${NOTICE_COLUMNS} FROM ea_cc_notices n JOIN users u ON u.id = n.user_id
      WHERE n.document_id = ? AND n.source = 'adhoc' ORDER BY u.name`, [documentId]));
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
// Reads a stage's kind and its person off a body, checking the person is one we
// are allowed to name. Returns { kind, requiresSignature, signerId } or an error
// string. THE ONLY writer of requires_signature — see the note on the column in
// db.js: stage_kind is the truth, that column is a compatibility shadow for a
// server still running the previous build mid-deploy.
const STAGE_KINDS = ["plain", "signature", "cc"];
// Replaces a stage's CC list wholesale. Rewriting rather than diffing keeps
// "who is copied" a single statement of fact; the notices already sent are
// untouched, because being told about a document is a thing that happened.
async function setStageCc(stageId, userIds) {
  await execute("DELETE FROM ea_stage_cc WHERE stage_id = ?", [stageId]);
  for (const uid_ of userIds) {
    await execute("INSERT IGNORE INTO ea_stage_cc (stage_id, user_id) VALUES (?, ?)", [stageId, uid_]);
  }
}
async function signatureSettings(req, body, current = null) {
  // An older client sends requiresSignature and knows nothing of kinds; a newer
  // one sends kind. Accept both, and let kind win when it is given.
  let kind = body.kind === undefined
    ? (body.requiresSignature === undefined ? kindOf(current) : (body.requiresSignature ? "signature" : "plain"))
    : String(body.kind);
  if (!STAGE_KINDS.includes(kind)) return "Choose what this stage asks for";
  if (kind === "plain") return { kind, requiresSignature: 0, signerId: null, ccUserIds: [] };

  // A CC stage copies MANY people; a signature stage has exactly one signer,
  // because the request it raises has exactly one signer. Different shapes on
  // purpose rather than one field pretending to serve both.
  if (kind === "cc") {
    let ids = body.ccUserIds;
    // Accept the single-person shapes too: an older client sends signerId, and
    // a stage made before CC stages could hold a list still has one.
    if (ids === undefined) {
      ids = body.signerId !== undefined
        ? (body.signerId ? [body.signerId] : [])
        : (current ? (await ccRecipients(current.id)).map((u) => u.id) : []);
    }
    const unique = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))];
    if (!unique.length) return "Choose who should see the document at this stage";
    // Someone already copied here may stay; anyone added must be an executive.
    const already = new Set(current ? (await ccRecipients(current.id)).map((u) => u.id) : []);
    for (const id of unique) {
      const ok = already.has(id) ? await stillSignable(id) : await signableExecutive(id);
      if (!ok) return "Choose from the Executive Management";
    }
    return { kind, requiresSignature: 0, signerId: null, ccUserIds: unique };
  }

  const signerId = body.signerId === undefined ? current?.signer_id : (body.signerId || null);
  if (!signerId) return "Choose whose signature this stage needs";
  // The stage's existing signer may stay; a new one must be an executive.
  const ok = signerId === current?.signer_id ? await stillSignable(signerId) : await signableExecutive(signerId);
  if (!ok) return "Choose from the Executive Management";
  return { kind, requiresSignature: 1, signerId, ccUserIds: [] };
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
    await execute("INSERT INTO ea_stages (id, board_id, name, position, stage_kind, requires_signature, signer_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, b.id, name, Number(last.p) + 1, sig.kind, sig.requiresSignature, sig.signerId, Date.now()]);
    await setStageCc(id, sig.ccUserIds);
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
    await execute("UPDATE ea_stages SET name = ?, stage_kind = ?, requires_signature = ?, signer_id = ? WHERE id = ?", [name, sig.kind, sig.requiresSignature, sig.signerId, s.id]);
    await setStageCc(s.id, sig.ccUserIds);
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
    const stages = await boardStages(b.id);
    const first = stages[0];
    if (!first) return res.status(400).json({ error: "Add a stage to the board first" });
    // A document may be filed straight into the stage it is actually at —
    // papers do not always arrive at the beginning. No stageId still means the
    // first stage, so every existing caller behaves exactly as before.
    const wanted = String(req.body?.stageId || "").trim();
    const landing = wanted ? stages.find((s) => s.id === wanted) : first;
    if (!landing) return res.status(400).json({ error: "Choose a stage on this board" });
    const file = req.file;
    if (!file) return res.status(400).json({ error: "file is required" });
    const tooBig = uploadSizeError(file);
    if (tooBig) return res.status(413).json({ error: tooBig });
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
    // Created in the FIRST stage and then entered into the landing stage, even
    // when they are the same. enterStage is what raises a signature request and
    // sends a CC notice, so routing the creation through it is what stops an
    // upload into a signature stage from sitting there with nobody asked.
    await execute(
      `INSERT INTO ea_documents (id, board_id, stage_id, title, note, file_name, file_path, file_type, request_id, created_by, created_at, entered_stage_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)`,
      [id, b.id, first.id, title, note, file.originalname, storedName, fileType, req.user.id, now, now]);
    const doc = await queryOne("SELECT * FROM ea_documents WHERE id = ?", [id]);
    // `from: null` — a card being created has skipped nothing, however far
    // along the board it is filed.
    const boxes = parseBoxes(req.body?.boxes);
    const bad = await enterStage({ doc, from: null, to: landing, boxes, actor: req.user, at: now });
    if (bad) {
      // Nothing was asked of anyone, so leave no half-made card behind.
      await execute("DELETE FROM ea_documents WHERE id = ?", [id]);
      await deleteStored("documents", storedName).catch(() => {});
      return res.status(bad.status).json({ error: bad.error });
    }
    res.json({ document: await docOut(await queryOne("SELECT * FROM ea_documents WHERE id = ?", [id])) });
  } catch (e) { next(e); }
});

// The card's current bytes: the signed copy once its latest request is
// approved, the upload otherwise.
export async function currentBytes(d) {
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
    if (isWaiting(rq)) return res.status(409).json({ error: `Waiting for ${rq.signerName || "the signatory"} to sign — withdraw that request first` });
    await execute("DELETE FROM ea_documents WHERE id = ?", [d.id]);
    deleteStored("documents", d.file_path).catch(() => {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /documents/:id/move { toStageId, boxes? }
// Entering a signature stage needs the signature box(es) and raises the request;
// leaving one needs the request to be settled.
// Entering a stage has to mean the same thing however the card got there — by
// being dragged, by "Move to…", or by being uploaded straight into it. One
// helper, used by the move route and the upload route both, so a signature can
// never be raised on one path and quietly skipped on the other.
//
// Returns an { status, error } object to refuse, or null when it has done the
// work. `from` is null for a card that is only now being created.
// `at` matters more than it looks: the dashboard measures a card's total life
// from created_at but its per-stage dwell from movement timestamps, so if a
// card is created at one instant and its first movement written at the next,
// the two disagree by however long the insert took. The upload route passes
// the timestamp it already used, which keeps them identical.
// Asks a signature stage's signatory to sign this card: raises the ordinary
// direct request (which is what puts it in their queue and emails them).
// Returns { raised } or { status, error }. Shared by entering a stage and by
// "Send" for a card that is already sitting in one.
async function raiseSignature({ doc, to, boxes, actor }) {
  // Boxes supplied now win; otherwise fall back to ones planned in advance
  // for this stage. That fallback IS the point of planning them: the card
  // reaches the stage and simply goes, without stopping to ask again.
  const planned = plannedBoxesFor(doc)[to.id];
  const list = Array.isArray(boxes) && boxes.length ? boxes
    : (Array.isArray(planned) ? planned : []);
  if (!list.length || list.some((b) => ["x", "y", "w", "h"].some((k) => typeof b?.[k] !== "number")))
    return { status: 400, error: "Place the signature box on the document first" };
  // A stage already set up keeps its signer, even one chosen before the
  // signatory list was narrowed to Executive Management.
  const signer = to.signer_id && await stillSignable(to.signer_id);
  if (!signer) return { status: 400, error: "This stage's signatory is no longer available — edit the stage" };
  const { bytes } = await currentBytes(doc);
  const ext = doc.file_type === "pdf" ? "pdf" : "xlsx";
  try {
    const raised = await raiseDirectRequest({
      user: actor,
      file: { buffer: bytes, originalname: doc.file_name },
      ext, fileType: doc.file_type, note: doc.note || "",
      signers: [{ userId: signer.id, boxes: list.map((b) => ({ page: Number(b.page) || 1, x: b.x, y: b.y, w: b.w, h: b.h })), dateFields: [] }],
      requestType: "document",
      retain: false, // the card keeps reading this request's signed copy
    });
    return { raised };
  } catch (e) {
    if (e instanceof DirectRequestError) return { status: e.status, error: e.message };
    throw e;
  }
}

// The move that brought the card into the stage it is in now — whose
// request_id says whether this visit has asked anybody to sign yet.
const arrivalIn = (doc) => queryOne(
  "SELECT id, request_id FROM ea_movements WHERE document_id = ? AND to_stage_id = ? ORDER BY moved_at DESC LIMIT 1",
  [doc.id, doc.stage_id]);

async function enterStage({ doc, from, to, boxes, actor, at }) {
  let raised = null;

  if (needsSignature(to)) {
    const r = await raiseSignature({ doc, to, boxes, actor });
    if (!r.raised) return r;
    raised = r.raised;
  }

  const stages = await boardStages(doc.board_id);
  const now = at || Date.now();

  if (isCc(to)) {
    // Everyone on the stage, not the first of them. A stage whose people have
    // all been deactivated would silently copy nobody, so that is refused —
    // the assistant should know the stage no longer does anything.
    const people = await ccRecipients(to.id);
    if (!people.length) return { status: 400, error: "Nobody on this stage can be shown the document any more — edit the stage" };
    for (const person of people) await noticeCc({ doc, stage: to, person, at: now });
  }

  // Which stages did the card jump straight over? Only a FORWARD move skips
  // anything — going back is revisiting, not skipping — and only the stages
  // strictly between the two. Without this a skipped stage is indistinguishable
  // from one the card simply has not reached yet.
  const fromPos = from ? Number(from.position) : null;
  const toPos = Number(to.position);
  const skipped = fromPos !== null && toPos > fromPos
    ? stages.filter((s) => Number(s.position) > fromPos && Number(s.position) < toPos).map((s) => s.id)
    : [];

  const last = stages.at(-1);
  await execute(
    "UPDATE ea_documents SET stage_id = ?, entered_stage_at = ?, request_id = COALESCE(?, request_id), completed_at = ? WHERE id = ?",
    [to.id, now, raised?.id || null, last && last.id === to.id ? now : null, doc.id]);
  await execute(
    `INSERT INTO ea_movements (id, document_id, from_stage_id, to_stage_id, moved_at, moved_by, request_id, skipped_stage_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid("eam"), doc.id, from?.id || null, to.id, now, actor.id, raised?.id || null,
      skipped.length ? JSON.stringify(skipped) : null]);
  return null;
}

// ---------- lay out every signature box up front ----------
// A paper that three people must sign has three boxes to place. Asked for one
// at a time, days apart, the assistant never sees them together and cannot tell
// whether the third will land on top of the second. This places them all on one
// view of the page, and each stage uses its own when the card arrives.
//
// The whole plan is replaced on every save: it is a layout, and a layout is
// stated as a whole rather than accumulated.
router.put("/documents/:id/planned-boxes", async (req, res, next) => {
  try {
    const d = await myDoc(req.user.id, req.params.id);
    if (!d) return res.status(404).json({ error: "Not found" });
    const body = req.body?.boxesByStage;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({ error: "Send the boxes for each stage" });
    }

    const stages = await boardStages(d.board_id);
    const out = {};
    for (const [stageId, boxes] of Object.entries(body)) {
      const stage = stages.find((s) => s.id === stageId);
      // Only a signature stage has anything to do with a box. Refusing rather
      // than ignoring, so a plan can never silently lose part of itself.
      if (!stage) return res.status(400).json({ error: "Choose a stage on this board" });
      if (!needsSignature(stage)) return res.status(400).json({ error: `"${stage.name}" does not ask for a signature` });
      const list = Array.isArray(boxes) ? boxes : [];
      if (list.some((b) => !validBox(b))) return res.status(400).json({ error: "A signature box is missing its position" });
      // An empty list means "no plan for this stage" — the card will ask when
      // it gets there, exactly as before.
      if (list.length) {
        out[stageId] = list.map((b) => ({
          page: Number(b.page) || 1, x: b.x, y: b.y, w: b.w, h: b.h,
        }));
      }
    }

    await execute("UPDATE ea_documents SET planned_boxes_json = ? WHERE id = ?",
      [Object.keys(out).length ? JSON.stringify(out) : null, d.id]);
    res.json({ document: await docOut(await queryOne("SELECT * FROM ea_documents WHERE id = ?", [d.id])) });
  } catch (e) { next(e); }
});

// ---------- send this one paper to someone to READ ----------
// A CC stage copies everyone who passes through it, which is right for a step
// that always needs an extra pair of eyes and wrong for "this particular paper
// should be seen by Taha". Making a stage for a one-off distorts the board.
//
// Deliberately NOT tied to the stage the card happens to be on: the ask is
// about the document, so it stays with it as it moves.
router.post("/documents/:id/review", async (req, res, next) => {
  try {
    const d = await myDoc(req.user.id, req.params.id);
    if (!d) return res.status(404).json({ error: "Not found" });
    const ids = [...new Set((Array.isArray(req.body?.userIds) ? req.body.userIds : []).map(String).filter(Boolean))];
    if (!ids.length) return res.status(400).json({ error: "Choose who should review it" });

    const people = [];
    for (const id of ids) {
      const person = await signableExecutive(id);
      if (!person) return res.status(400).json({ error: "Choose from the Executive Management" });
      people.push(person);
    }

    const now = Date.now();
    for (const person of people) await noticeCc({ doc: d, stage: null, person, at: now, source: "adhoc" });
    res.json({ sent: people.length, document: await docOut(await queryOne("SELECT * FROM ea_documents WHERE id = ?", [d.id])) });
  } catch (e) { next(e); }
});

// ---------- nudge whoever has not opened it ----------
// A CC stage never holds the card, which is the point of it — and also why a
// document can sit read by nobody while the board looks perfectly healthy. The
// assistant can ask again.
//
// Only the people who have NOT opened it are written to. Reminding someone who
// already read the paper is how a reminder becomes noise that gets filtered.
router.post("/documents/:id/cc-remind", async (req, res, next) => {
  try {
    const d = await myDoc(req.user.id, req.params.id);
    if (!d) return res.status(404).json({ error: "Not found" });
    const stage = await queryOne("SELECT * FROM ea_stages WHERE id = ?", [d.stage_id]);

    // Everyone still owing a read on THIS card: the people its current CC
    // stage copied, and anyone it was sent to for review by hand. One button,
    // because an assistant chasing a document does not care which of the two
    // routes asked them.
    //
    // Notices from a CC stage the card has since LEFT are not chased: that ask
    // belonged to a step the paper has moved past.
    const unread = await query(
      `SELECT n.*, u.email, u.name FROM ea_cc_notices n JOIN users u ON u.id = n.user_id
        WHERE n.document_id = ? AND n.viewed_at IS NULL AND u.active = 1
          AND (n.source = 'adhoc' OR (n.source = 'stage' AND n.stage_id = ?))`,
      [d.id, isCc(stage) ? stage.id : ""]);
    if (!unread.length) return res.status(400).json({ error: "Nobody is waiting to read this one" });

    // Cooldown measured per NOTICE, so adding a sixth person to a stage does
    // not have to wait out a reminder the other five were sent.
    const now = Date.now();
    const due = unread.filter((n) => !n.reminded_at || now - Number(n.reminded_at) >= CC_REMINDER_COOLDOWN_MS);
    if (!due.length) {
      const soonest = Math.min(...unread.map((n) => Number(n.reminded_at)));
      const hrs = Math.ceil((CC_REMINDER_COOLDOWN_MS - (now - soonest)) / 3600000);
      return res.status(429).json({ error: `Next reminder allowed in ${hrs} hour(s)` });
    }

    for (const n of due) {
      await execute("UPDATE ea_cc_notices SET reminded_at = ?, reminder_count = reminder_count + 1 WHERE id = ?", [now, n.id]);
      if (!n.email) continue;
      sendEmail({
        to: n.email,
        template: "ea_cc_notice",
        // The same template, told it is a second ask: one place holds the
        // wording for "please read this", whether it is the first time or not.
        // A one-off review has no stage to name, so it is not given one.
        ctx: {
          name: n.name, title: d.title, documentId: d.id, reminder: true,
          stageName: n.source === "adhoc" ? "" : (stage?.name || ""),
        },
      }).catch(() => {});
    }
    res.json({ reminded: due.length, document: await docOut(await queryOne("SELECT * FROM ea_documents WHERE id = ?", [d.id])) });
  } catch (e) { next(e); }
});

router.post("/documents/:id/move", async (req, res, next) => {
  try {
    const d = await myDoc(req.user.id, req.params.id);
    if (!d) return res.status(404).json({ error: "Not found" });
    const to = await myStage(req.user.id, String(req.body?.toStageId || ""));
    if (!to || to.board_id !== d.board_id) return res.status(400).json({ error: "Choose a stage on this board" });
    if (to.id === d.stage_id) return res.status(400).json({ error: "The document is already there" });
    const from = await queryOne("SELECT * FROM ea_stages WHERE id = ?", [d.stage_id]);
    const rq = await requestFor(d);

    // A signature stage still holds the card until it is signed. A CC stage
    // never does — being asked to read something is not a gate.
    if (needsSignature(from) && isWaiting(rq)) {
      return res.status(409).json({ error: `Waiting for ${rq.signerName || "the signatory"} to sign` });
    }

    const bad = await enterStage({ doc: d, from, to, boxes: parseBoxes(req.body?.boxes), actor: req.user });
    if (bad) return res.status(bad.status).json({ error: bad.error });
    res.json({ document: await docOut(await queryOne("SELECT * FROM ea_documents WHERE id = ?", [d.id])) });
  } catch (e) { next(e); }
});

// POST /documents/:id/send { boxes? } — ask the signatory of the stage the card
// is ALREADY in. Entering a stage is what used to be the only trigger, so a card
// that was there before the stage was set to "Signs" (or whose boxes were placed
// afterwards) sat in it and nobody was ever asked (owner, 2026-10-31).
router.post("/documents/:id/send", async (req, res, next) => {
  try {
    const d = await myDoc(req.user.id, req.params.id);
    if (!d) return res.status(404).json({ error: "Not found" });
    const stage = await queryOne("SELECT * FROM ea_stages WHERE id = ?", [d.stage_id]);
    if (!needsSignature(stage)) return res.status(400).json({ error: `"${stage?.name}" does not ask for a signature — move the card to a stage that does` });
    const arrival = await arrivalIn(d);
    if (arrival?.request_id) {
      const rq = await requestFor({ request_id: arrival.request_id });
      // Rejected or withdrawn may be asked again; anything else already went.
      if (rq && !["rejected", "withdrawn"].includes(rq.status)) {
        return res.status(409).json({ error: isWaiting(rq) ? `Already sent — waiting for ${rq.signerName || "the signatory"} to sign` : "Already signed at this stage" });
      }
    }
    const r = await raiseSignature({ doc: d, to: stage, boxes: parseBoxes(req.body?.boxes), actor: req.user });
    if (!r.raised) return res.status(r.status).json({ error: r.error });
    await execute("UPDATE ea_documents SET request_id = ? WHERE id = ?", [r.raised.id, d.id]);
    // Recorded on the arrival, so this visit now counts as asked.
    if (arrival) await execute("UPDATE ea_movements SET request_id = ? WHERE id = ?", [r.raised.id, arrival.id]);
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
    const perStage = Object.fromEntries(stages.map((s) => [s.id, {
      id: s.id, name: s.name, kind: kindOf(s), requiresSignature: needsSignature(s),
      count: 0, sumMs: 0, spells: 0, maxMs: 0, oldestMs: 0,
      // A stage can be reported on for being passed over as much as for being
      // sat in — "nobody ever stops here" is a finding about the flow.
      skippedCount: 0, ccNotified: 0, ccViewed: 0,
    }]));
    // Every CC notice on this board, read once rather than per card.
    const notices = await query(
      // Stage notices only. A one-off review is a decision about one paper, not
      // evidence that a stage is doing its job — counting it under a stage
      // would overstate how well the flow itself works.
      `SELECT n.*, u.name AS user_name FROM ea_cc_notices n
         JOIN ea_documents d ON d.id = n.document_id
         JOIN users u ON u.id = n.user_id
        WHERE d.board_id = ? AND n.source = 'stage' ORDER BY u.name`, [b.id]);
    const noticesByDoc = {};
    for (const n of notices) {
      (noticesByDoc[n.document_id] ||= []).push(n);
      const agg = perStage[n.stage_id];
      if (agg) { agg.ccNotified += 1; if (n.viewed_at) agg.ccViewed += 1; }
    }
    const out = [];
    for (const d of docs) {
      const moves = await query("SELECT * FROM ea_movements WHERE document_id = ? ORDER BY moved_at ASC, id ASC", [d.id]);
      const end = d.completed_at ? Number(d.completed_at) : now;
      const dwell = Object.fromEntries(stages.map((s) => [s.id, 0]));
      const skipped = new Set();
      for (let i = 0; i < moves.length; i++) {
        const start = Number(moves[i].moved_at);
        const stop = i + 1 < moves.length ? Number(moves[i + 1].moved_at) : end;
        const ms = Math.max(0, stop - start);
        if (dwell[moves[i].to_stage_id] !== undefined) dwell[moves[i].to_stage_id] += ms;
        const agg = perStage[moves[i].to_stage_id];
        if (agg) { agg.sumMs += ms; agg.spells += 1; agg.maxMs = Math.max(agg.maxMs, ms); }
        for (const id of parseBoxes(moves[i].skipped_stage_ids)) {
          if (typeof id === "string") skipped.add(id);
        }
      }
      // Counted per DOCUMENT, not per move: a card that skipped a stage twice
      // is still one paper that went around it.
      for (const id of skipped) { const agg = perStage[id]; if (agg) agg.skippedCount += 1; }
      const cur = perStage[d.stage_id];
      if (cur) { cur.count += 1; if (!d.completed_at) cur.oldestMs = Math.max(cur.oldestMs, now - Number(d.entered_stage_at)); }
      const rq = await requestFor(d);
      out.push({
        id: d.id, title: d.title, fileName: d.file_name, createdAt: Number(d.created_at), completedAt: d.completed_at ? Number(d.completed_at) : null,
        currentStageId: d.stage_id, enteredStageAt: Number(d.entered_stage_at), totalMs: Math.max(0, end - Number(d.created_at)),
        stages: stages.map((s) => ({ stageId: s.id, ms: dwell[s.id], skipped: skipped.has(s.id) })),
        skippedStageIds: [...skipped],
        cc: (noticesByDoc[d.id] || []).map((n) => ({
          stageId: n.stage_id, name: n.user_name, notifiedAt: Number(n.notified_at), viewedAt: n.viewed_at ? Number(n.viewed_at) : null,
        })),
        signerName: rq?.signerName || null, requestStatus: rq?.status || null,
      });
    }
    res.json({
      board: { id: b.id, name: b.name },
      stages: stages.map((s) => {
        const a = perStage[s.id];
        return {
          id: s.id, name: s.name, kind: a.kind, requiresSignature: a.requiresSignature,
          count: a.count, avgMs: a.spells ? Math.round(a.sumMs / a.spells) : 0, maxMs: a.maxMs, oldestMs: a.oldestMs,
          skippedCount: a.skippedCount, ccNotified: a.ccNotified, ccViewed: a.ccViewed,
        };
      }),
      documents: out,
    });
  } catch (e) { next(e); }
});

export default router;
