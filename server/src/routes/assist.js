// Executive Assistant "act on behalf" API. An assistant can view a mapped
// executive's signing queue, and — only when that link's can_approve is on —
// approve/sign on the executive's behalf. Approval reuses the exact same signing
// logic as a normal approval (approveRequestHandler), called with an
// executive-shaped request so the executive's name lands on the document; the
// stamped signature image is chosen per the link's signature_source.
import { Router } from "express";
import { query, queryOne, execute, hydrateUser, hydrateRequest } from "../db.js";
import { authRequired, requireRole } from "../auth.js";
import { approveRequestHandler } from "./requests.js";

const router = Router();

// Fetch the mapping between the calling assistant and the given executive.
async function linkFor(assistantId, executiveId) {
  return queryOne(
    "SELECT * FROM executive_assistants WHERE executive_id = ? AND assistant_id = ?",
    [executiveId, assistantId]
  );
}

// ---------- the executives this assistant supports ----------
router.get("/executives", authRequired, requireRole("executive_assistant"), async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT ea.id AS link_id, ea.can_approve, ea.signature_source,
             e.id, e.name, e.email, e.signature_path
      FROM executive_assistants ea
      JOIN users e ON e.id = ea.executive_id
      WHERE ea.assistant_id = ? AND e.active = 1
      ORDER BY e.name`, [req.user.id]);
    res.json({
      executives: rows.map(r => ({
        linkId: r.link_id,
        id: r.id, name: r.name, email: r.email,
        canApprove: !!r.can_approve,
        signatureSource: r.signature_source,
        executiveHasSignature: !!r.signature_path,
      })),
    });
  } catch (e) { next(e); }
});

// ---------- one executive's signing queue ----------
router.get("/:executiveId/requests", authRequired, requireRole("executive_assistant"), async (req, res, next) => {
  try {
    const link = await linkFor(req.user.id, req.params.executiveId);
    if (!link) return res.status(403).json({ error: "You don't assist this executive" });
    const eid = req.params.executiveId;
    // The executive's signing queue: requests assigned to them as a signer, the
    // legacy claim (approver_id), or a pending team they sign for.
    const rows = await query(`
      SELECT DISTINCT r.* FROM requests r
      LEFT JOIN request_steps st ON st.request_id = r.id
      LEFT JOIN request_step_signers sg ON sg.step_id = st.id
      WHERE r.approver_id = ?
         OR sg.user_id = ?
         OR (r.status = 'pending' AND r.target_team_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM signing_authority sa WHERE sa.user_id = ? AND sa.team_id = r.target_team_id))
      ORDER BY r.created_at DESC`, [eid, eid, eid]);
    const requests = await Promise.all(rows.map(hydrateRequest));
    res.json({ requests });
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

    // Record the real actor for the audit trail once the approval succeeds.
    let auditDone = Promise.resolve();
    const sendJson = res.json.bind(res);
    res.json = (payload) => {
      if (payload && payload.request) {
        auditDone = execute(
          "UPDATE requests SET acted_by_assistant_id = ? WHERE id = ?",
          [req.user.id, req.params.id]
        ).catch(() => {});
      }
      return sendJson(payload);
    };

    await approveRequestHandler(pseudoReq, res, next);
    await auditDone;
  } catch (e) { next(e); }
});

export default router;
