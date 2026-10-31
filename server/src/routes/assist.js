// Executive Assistant "act on behalf" API. Every capability is granted per-link
// by the executive (or admin) and enforced HERE, server-side:
//   can_view             — see the executive's pending queue
//   can_dashboard        — the executive's ENTIRE data (full queue + history)
//   can_approve          — approve/sign on the executive's behalf
//   can_update_signature — upload/replace the executive's signature image
//   can_notify           — copies of the executive's emails (handled in email.js)
// Approval reuses the exact same signing logic as a normal approval
// (approveRequestHandler) called with an executive-shaped request; the stamped
// image follows the link's signature_source. The executive is always emailed
// when their assistant acts, naming the assistant and the action.
import { Router } from "express";
import { query, queryOne, execute, hydrateUser, hydrateRequest } from "../db.js";
import { authRequired, requireRole } from "../auth.js";
import { sendEmail } from "../email.js";
import { approveRequestHandler, rejectRequestHandler, voiceUpload } from "./requests.js";
import { recommendHandler } from "./recommendations.js";
import { deploymentOrg } from "../org.js";
import { readImageSize, sendSignature } from "./users.js";
import { writeStored } from "../filestore.js";

const router = Router();

// Fetch the mapping between the calling assistant and the given executive.
async function linkFor(assistantId, executiveId) {
  return queryOne(
    "SELECT * FROM executive_assistants WHERE executive_id = ? AND assistant_id = ?",
    [executiveId, assistantId]
  );
}
const canView = (link) => link.can_view == null || !!link.can_view;

// ---------- the executives this assistant supports (with granted rights) ----------
router.get("/executives", authRequired, requireRole("executive_assistant"), async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT ea.*, e.id AS eid, e.name, e.email, e.signature_path
      FROM executive_assistants ea
      JOIN users e ON e.id = ea.executive_id
      WHERE ea.assistant_id = ? AND e.active = 1
      ORDER BY e.name`, [req.user.id]);
    res.json({
      executives: rows.map(r => ({
        linkId: r.id,
        id: r.eid, name: r.name, email: r.email,
        canView: r.can_view == null ? true : !!r.can_view,
        canApprove: !!r.can_approve,
        canUpdateSignature: !!r.can_update_signature,
        canNotify: !!r.can_notify,
        canDashboard: !!r.can_dashboard,
        signatureSource: r.signature_source,
        executiveHasSignature: !!r.signature_path,
      })),
    });
  } catch (e) { next(e); }
});

// ---------- the executive's documents ----------
// can_dashboard → the executive's ENTIRE data (everything they'd see: their queue
// plus full history). can_view only → the pending queue. Neither → 403.
router.get("/:executiveId/requests", authRequired, requireRole("executive_assistant"), async (req, res, next) => {
  try {
    const link = await linkFor(req.user.id, req.params.executiveId);
    if (!link) return res.status(403).json({ error: "You don't assist this executive" });
    if (!canView(link) && !link.can_dashboard) return res.status(403).json({ error: "This executive hasn't granted you document access" });
    const eid = req.params.executiveId;
    const statusFilter = link.can_dashboard ? "" : "AND r.status = 'pending'";
    const rows = await query(`
      SELECT DISTINCT r.* FROM requests r
      LEFT JOIN request_steps st ON st.request_id = r.id
      LEFT JOIN request_step_signers sg ON sg.step_id = st.id
      WHERE (r.approver_id = ?
         OR sg.user_id = ?
         OR (r.status = 'pending' AND r.target_team_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM signing_authority sa WHERE sa.user_id = ? AND sa.team_id = r.target_team_id)))
        ${statusFilter}
      ORDER BY r.created_at DESC`, [eid, eid, eid]);
    const requests = await Promise.all(rows.map(hydrateRequest));
    res.json({ requests, scope: link.can_dashboard ? "all" : "pending" });
  } catch (e) { next(e); }
});

// ---------- act on behalf: approve, reject, recommend changes ----------
// All three run the SAME handler an approver's own click runs, with an
// executive-shaped request — so every rule (whose turn it is, confidential
// unlock, workflow order) applies unchanged. Each needs can_approve: deciding
// a document is the right the executive granted, whichever way it goes.
// Confidential documents are refused outright: they stay with the people named
// on them (the same rule the file routes apply to assistants).
async function asExecutive(req, res, { needSignature = false } = {}) {
  const link = await linkFor(req.user.id, req.params.executiveId);
  if (!link) { res.status(403).json({ error: "You don't assist this executive" }); return null; }
  if (!link.can_approve) { res.status(403).json({ error: "This executive hasn't allowed you to act on their behalf yet" }); return null; }
  const execRow = await queryOne("SELECT * FROM users WHERE id = ? AND role = 'executive'", [req.params.executiveId]);
  if (!execRow) { res.status(400).json({ error: "Executive not found" }); return null; }
  const doc = await queryOne("SELECT confidential FROM requests WHERE id = ?", [req.params.id]);
  if (doc?.confidential) { res.status(403).json({ error: "Confidential documents can only be decided by the executive themselves" }); return null; }

  // Which signature image gets stamped. The executive's NAME is always on the
  // document (they are the approver of record); only the image differs.
  const sigPath = link.signature_source === "assistant" ? req.userRow.signature_path : execRow.signature_path;
  if (needSignature && !sigPath) {
    const who = link.signature_source === "assistant" ? "Your" : "The executive's";
    res.status(400).json({ error: `${who} signature isn't on file yet — add it before signing.` });
    return null;
  }
  const execHydrated = await hydrateUser(execRow);
  return { link, execRow, execHydrated, sigPath };
}

// Runs `handler` as the executive; on success records the real actor and tells
// the executive who did what.
async function runAsExecutive(req, res, next, ctx, handler, { action, body }) {
  const pseudoReq = {
    user: { ...ctx.execHydrated, hasSignature: !!ctx.sigPath },
    userRow: { ...ctx.execRow, signature_path: ctx.sigPath || ctx.execRow.signature_path },
    params: { id: req.params.id },
    body,
    file: req.file,
    headers: req.headers,
  };
  let afterOk = Promise.resolve();
  const sendJson = res.json.bind(res);
  res.json = (payload) => {
    if (payload && payload.request) {
      // Who acted is written BEFORE the reply goes out: the screen reloads the
      // moment it hears success, and must not read the row a beat too early.
      const recorded = execute("UPDATE requests SET acted_by_assistant_id = ? WHERE id = ?", [req.user.id, req.params.id]).catch(() => {});
      afterOk = Promise.allSettled([
        recorded.then(() => sendJson(payload)),
        sendEmail({
          to: ctx.execRow.email,
          template: "ea_action",
          ctx: {
            executiveName: ctx.execRow.name,
            assistantName: req.user.name,
            action,
            fileName: payload.request.fileName || payload.request.file_name || "document",
            requestId: req.params.id,
          },
        }),
      ]);
      return res;
    }
    return sendJson(payload);
  };
  await handler(pseudoReq, res, next);
  await afterOk;
}

const onBehalf = [authRequired, requireRole("executive_assistant")];

router.post("/:executiveId/requests/:id/approve", ...onBehalf, async (req, res, next) => {
  try {
    const ctx = await asExecutive(req, res, { needSignature: true });
    if (!ctx) return;
    // The approver's own choices travel through (finalise now, add today's
    // date). Never signatureId: which image is stamped is the link's setting.
    const body = { instant: req.body?.instant, addDate: req.body?.addDate };
    await runAsExecutive(req, res, next, ctx, approveRequestHandler, { action: "approved", body });
  } catch (e) { next(e); }
});

router.post("/:executiveId/requests/:id/reject", ...onBehalf, voiceUpload, async (req, res, next) => {
  try {
    const ctx = await asExecutive(req, res);
    if (!ctx) return;
    await runAsExecutive(req, res, next, ctx, rejectRequestHandler, { action: "rejected", body: { reason: req.body?.reason || "" } });
  } catch (e) { next(e); }
});

router.post("/:executiveId/requests/:id/recommend", ...onBehalf, async (req, res, next) => {
  try {
    if (deploymentOrg() !== "hqhb") return res.status(404).end();
    const ctx = await asExecutive(req, res);
    if (!ctx) return;
    await runAsExecutive(req, res, next, ctx, recommendHandler,
      { action: "sent back for changes", body: { recommendation: req.body?.recommendation } });
  } catch (e) { next(e); }
});

// ---------- the signature that would be stamped (for the preview) ----------
router.get("/:executiveId/signature-image", ...onBehalf, async (req, res, next) => {
  try {
    const link = await linkFor(req.user.id, req.params.executiveId);
    if (!link || !link.can_approve) return res.status(403).end();
    const execRow = await queryOne("SELECT signature_path FROM users WHERE id = ?", [req.params.executiveId]);
    const sigPath = link.signature_source === "assistant" ? req.userRow.signature_path : execRow?.signature_path;
    if (!sigPath) return res.status(404).json({ error: "No signature on file yet" });
    await sendSignature(res, sigPath);
  } catch (e) { next(e); }
});

// ---------- upload / replace the executive's signature ----------
router.put("/:executiveId/signature", authRequired, requireRole("executive_assistant"), async (req, res, next) => {
  try {
    const link = await linkFor(req.user.id, req.params.executiveId);
    if (!link) return res.status(403).json({ error: "You don't assist this executive" });
    if (!link.can_update_signature) return res.status(403).json({ error: "This executive hasn't allowed you to manage their signature" });

    const dataUrl = req.body?.dataUrl;
    const match = typeof dataUrl === "string" && /^data:image\/(png|jpeg|jpg);base64,(.+)$/.exec(dataUrl);
    if (!match) return res.status(400).json({ error: "A PNG or JPEG dataUrl is required" });
    const ext = match[1] === "jpeg" ? "jpg" : match[1];
    const buffer = Buffer.from(match[2], "base64");

    const execRow = await queryOne("SELECT * FROM users WHERE id = ? AND role = 'executive'", [req.params.executiveId]);
    if (!execRow) return res.status(400).json({ error: "Executive not found" });

    // Through the filestore, like every other signature write: the bucket key
    // once its copy is verified, else the bare filename on disk.
    const fileName = await writeStored("signatures", `${execRow.id}.${ext}`, buffer,
      { contentType: ext === "jpg" ? "image/jpeg" : "image/png" });
    const dims = readImageSize(buffer);
    const aspect = dims && dims.height > 0 ? dims.width / dims.height : null;
    await execute("UPDATE users SET signature_path = ?, signature_aspect = ? WHERE id = ?", [fileName, aspect, execRow.id]);

    sendEmail({
      to: execRow.email,
      template: "ea_action",
      ctx: {
        executiveName: execRow.name,
        assistantName: req.user.name,
        action: "updated the signature for",
        fileName: "your signature on file",
        requestId: "",
      },
    }).catch(() => {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
