// ============================================================
//   "Send for Shz Saab Approval" — WAQF HOD tracking board
//   ------------------------------------------------------------
//   A requestor forwards one of their OWN fully-signed documents to the HOD
//   (Shz Saab) for visibility, with an optional comment. The HOD — anyone on
//   the team named "HOD" in this organisation — sees WHAT was sent and WHEN on
//   a dashboard. View-only: no approval happens here. WAQF organisation only.
// ============================================================
import express from "express";
import { authRequired } from "../auth.js";
import { deploymentOrg } from "../org.js";
import { query, queryOne, execute } from "../db.js";

const router = express.Router();

// One box serves one organisation. These routes exist only on the WAQF box, so
// an HQHB box does not even reveal them (404, like the EA flow on WAQF).
const waqfOnly = (req, res, next) => (deploymentOrg() === "waqf" ? next() : res.status(404).end());
router.use(waqfOnly, authRequired);

const newId = () => "shz_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// The HOD team for this deployment's organisation: the team named "HOD".
async function hodTeam() {
  return await queryOne(
    "SELECT id, name FROM teams WHERE org_id = ? AND LOWER(name) = 'hod' LIMIT 1",
    [deploymentOrg()]
  );
}

// ---------- requestor forwards their own signed document ----------
router.post("/forward", async (req, res, next) => {
  try {
    const requestId = String(req.body?.requestId || "").trim();
    const comment = req.body?.comment != null ? String(req.body.comment).trim().slice(0, 2000) : null;
    if (!requestId) return res.status(400).json({ error: "requestId is required" });

    const row = await queryOne("SELECT id, requestor_id, status FROM requests WHERE id = ?", [requestId]);
    if (!row) return res.status(404).json({ error: "Request not found" });
    if (row.requestor_id !== req.user.id) return res.status(403).json({ error: "You can only forward your own documents" });
    if (row.status !== "approved") return res.status(400).json({ error: "Only a fully signed document can be sent for Shz Saab approval" });

    // There must be an HOD team to receive it.
    const t = await hodTeam();
    if (!t) return res.status(400).json({ error: "No HOD team is set up for this organisation" });

    // One forward per document. Sending again just reports when it first went.
    const existing = await queryOne("SELECT id, forwarded_at, comment FROM shz_forwards WHERE request_id = ?", [requestId]);
    if (existing) {
      return res.json({ forward: { id: existing.id, requestId, forwardedAt: Number(existing.forwarded_at), comment: existing.comment, alreadySent: true } });
    }
    const id = newId(), now = Date.now();
    await execute(
      "INSERT INTO shz_forwards (id, request_id, requestor_id, comment, forwarded_at, org_id) VALUES (?, ?, ?, ?, ?, ?)",
      [id, requestId, req.user.id, comment || null, now, deploymentOrg()]
    );
    res.json({ forward: { id, requestId, forwardedAt: now, comment: comment || null, alreadySent: false } });
  } catch (e) { next(e); }
});

// ---------- HOD dashboard: everything sent for Shz Saab approval ----------
router.get("/forwards", async (req, res, next) => {
  try {
    if (!req.user.isHod) return res.status(403).json({ error: "Only the HOD can view this" });
    const rows = await query(`
      SELECT f.id, f.request_id, f.comment, f.forwarded_at,
             r.file_name, r.status,
             u.name AS requestor_name, u.email AS requestor_email
      FROM shz_forwards f
      JOIN requests r ON r.id = f.request_id
      JOIN users u ON u.id = f.requestor_id
      WHERE f.org_id = ?
      ORDER BY f.forwarded_at DESC
    `, [deploymentOrg()]);
    res.json({
      forwards: rows.map(x => ({
        id: x.id,
        requestId: x.request_id,
        fileName: x.file_name,
        status: x.status,
        comment: x.comment,
        forwardedAt: Number(x.forwarded_at),
        requestorName: x.requestor_name,
        requestorEmail: x.requestor_email,
      })),
    });
  } catch (e) { next(e); }
});

// ---------- which of my documents have already been sent ----------
// Lets the approved-list render the button as "Sent on <IST>" in one call.
router.get("/sent", async (req, res, next) => {
  try {
    const rows = await query("SELECT request_id, forwarded_at FROM shz_forwards WHERE requestor_id = ?", [req.user.id]);
    const sent = {};
    for (const r of rows) sent[r.request_id] = Number(r.forwarded_at);
    res.json({ sent });
  } catch (e) { next(e); }
});

export default router;
