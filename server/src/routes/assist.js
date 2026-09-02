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
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { query, queryOne, execute, hydrateUser, hydrateRequest } from "../db.js";
import { authRequired, requireRole } from "../auth.js";
import { sendEmail } from "../email.js";
import { approveRequestHandler } from "./requests.js";
import { readImageSize } from "./users.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIG_DIR = path.join(__dirname, "..", "..", "uploads", "signatures");

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
             AND (EXISTS (SELECT 1 FROM signing_authority sa WHERE sa.user_id = ? AND sa.team_id = r.target_team_id)
                  -- Membership confers signing rights, so an assistant must see
                  -- the same board their executive does.
                  OR EXISTS (SELECT 1 FROM users mu WHERE mu.id = ? AND mu.team_id = r.target_team_id))))
        ${statusFilter}
      ORDER BY r.created_at DESC`, [eid, eid, eid, eid]);
    const requests = await Promise.all(rows.map(hydrateRequest));
    res.json({ requests, scope: link.can_dashboard ? "all" : "pending" });
  } catch (e) { next(e); }
});

// ---------- approve / sign on behalf ----------
router.post("/:executiveId/requests/:id/approve", authRequired, requireRole("executive_assistant"), async (req, res, next) => {
  try {
    const link = await linkFor(req.user.id, req.params.executiveId);
    if (!link) return res.status(403).json({ error: "You don't assist this executive" });
    if (!link.can_approve) return res.status(403).json({ error: "This executive hasn't allowed you to approve on their behalf yet" });

    const execRow = await queryOne("SELECT * FROM users WHERE id = ? AND role = 'executive'", [req.params.executiveId]);
    if (!execRow) return res.status(400).json({ error: "Executive not found" });

    // Which signature image gets stamped. The executive's NAME is always on the
    // document (they are the approver of record); only the image differs.
    const sigPath = link.signature_source === "assistant" ? req.userRow.signature_path : execRow.signature_path;
    if (!sigPath) {
      const who = link.signature_source === "assistant" ? "Your" : "The executive's";
      return res.status(400).json({ error: `${who} signature isn't on file yet — add it before signing.` });
    }

    // Build an executive-shaped request and reuse the one signing code path.
    const execHydrated = await hydrateUser(execRow);
    const pseudoReq = {
      user: { ...execHydrated, hasSignature: true },
      userRow: { ...execRow, signature_path: sigPath },
      params: { id: req.params.id },
      body: {},
      headers: req.headers,
    };

    // On success: record the real actor, and tell the executive who did what.
    let afterOk = Promise.resolve();
    const sendJson = res.json.bind(res);
    res.json = (payload) => {
      if (payload && payload.request) {
        afterOk = Promise.allSettled([
          execute("UPDATE requests SET acted_by_assistant_id = ? WHERE id = ?", [req.user.id, req.params.id]),
          sendEmail({
            to: execRow.email,
            template: "ea_action",
            ctx: {
              executiveName: execRow.name,
              assistantName: req.user.name,
              action: "approved",
              fileName: payload.request.fileName || payload.request.file_name || "document",
              requestId: req.params.id,
            },
          }),
        ]);
      }
      return sendJson(payload);
    };

    await approveRequestHandler(pseudoReq, res, next);
    await afterOk;
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

    await fs.mkdir(SIG_DIR, { recursive: true });
    const fileName = `${execRow.id}.${ext}`;
    await fs.writeFile(path.join(SIG_DIR, fileName), buffer);
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
