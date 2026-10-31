// ============================================================
//   "Send for Shz Saab Approval" — WAQF HOD tracking board
//   ------------------------------------------------------------
//   A requestor forwards one of their OWN fully-signed documents to the HOD
//   (Shz Saab) for visibility, with an optional comment. The HOD — anyone on
//   the team named "HOD" in this organisation — sees WHAT was sent and WHEN on
//   a dashboard. View-only: no approval happens here. WAQF organisation only.
//
//   When Shz Saab's approval (the Manzuri) comes back, the requestor marks it
//   received on the same document — the time is recorded — and may upload the
//   Manzuri itself (a PDF, or a photo/scan), now or later. The HOD sees both.
// ============================================================
import express from "express";
import { authRequired } from "../auth.js";
import { deploymentOrg } from "../org.js";
import multer from "multer";
import { query, queryOne, execute } from "../db.js";
import { writeStored, readStored } from "../filestore.js";
import { UPLOAD_CEILING_BYTES, PDF_MAX_MB } from "../uploadLimits.js";
import { pingUser } from "../events.js";

const router = express.Router();

// One box serves one organisation. These routes exist only on the WAQF box, so
// an HQHB box does not even reveal them (404, like the EA flow on WAQF).
const waqfOnly = (req, res, next) => (deploymentOrg() === "waqf" ? next() : res.status(404).end());
router.use(waqfOnly, authRequired);

const newId = () => "shz_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// A Manzuri may be a PDF or a photo/scan of the signed approval.
const MANZURI_TYPES = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
const IMAGE_MAX_MB = 15;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_CEILING_BYTES } });

// Everyone on the HOD team, so their open dashboards refresh.
async function hodUserIds() {
  const t = await hodTeam();
  if (!t) return [];
  const rows = await query(
    `SELECT id FROM users WHERE team_id = ? AND active = 1
     UNION SELECT user_id AS id FROM signing_authority WHERE team_id = ?`, [t.id, t.id]);
  return rows.map(r => r.id);
}

const manzuriOut = (f) => f.manzuri_received_at ? {
  receivedAt: Number(f.manzuri_received_at),
  note: f.manzuri_note || null,
  fileName: f.manzuri_file_name || null,
  uploadedAt: f.manzuri_uploaded_at ? Number(f.manzuri_uploaded_at) : null,
} : null;

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
             f.manzuri_received_at, f.manzuri_note, f.manzuri_file_name, f.manzuri_uploaded_at,
             r.file_name, r.status,
             u.name AS requestor_name
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
        manzuri: manzuriOut(x),
      })),
    });
  } catch (e) { next(e); }
});

// ---------- which of my documents have already been sent ----------
// Lets the approved-list render the button as "Sent on <IST>" in one call.
router.get("/sent", async (req, res, next) => {
  try {
    const rows = await query(
      "SELECT request_id, forwarded_at, manzuri_received_at, manzuri_note, manzuri_file_name, manzuri_uploaded_at FROM shz_forwards WHERE requestor_id = ?",
      [req.user.id]);
    const sent = {}, manzuri = {};
    for (const r of rows) {
      sent[r.request_id] = Number(r.forwarded_at);
      const m = manzuriOut(r);
      if (m) manzuri[r.request_id] = m;
    }
    res.json({ sent, manzuri });
  } catch (e) { next(e); }
});

// ---------- the requestor records the Manzuri as received ----------
// multipart: file? (PDF/JPG/PNG), note?. The first call sets the received time;
// a later call can add or replace the uploaded copy without moving that time.
router.post("/manzuri/:requestId", upload.single("file"), async (req, res, next) => {
  try {
    const f = await queryOne("SELECT * FROM shz_forwards WHERE request_id = ?", [req.params.requestId]);
    if (!f) return res.status(404).json({ error: "This document has not been sent for Shz Saab approval" });
    if (f.requestor_id !== req.user.id) return res.status(403).json({ error: "Only the requestor can record the Manzuri" });

    const now = Date.now();
    let stored = null, ext = null;
    if (req.file) {
      ext = String(req.file.originalname.split(".").pop() || "").toLowerCase();
      if (!MANZURI_TYPES[ext]) return res.status(400).json({ error: "The Manzuri must be a PDF, JPG or PNG" });
      const maxMb = ext === "pdf" ? PDF_MAX_MB : IMAGE_MAX_MB;
      if (req.file.size > maxMb * 1024 * 1024) {
        return res.status(413).json({ error: `${ext === "pdf" ? "PDFs" : "Images"} can be up to ${maxMb} MB — this one is ${(req.file.size / 1048576).toFixed(1)} MB.` });
      }
      stored = await writeStored("documents", `${f.id}.manzuri.${now}.${ext}`, req.file.buffer, { contentType: MANZURI_TYPES[ext] });
    }
    const note = req.body?.note != null ? String(req.body.note).trim().slice(0, 2000) : null;
    if (!f.manzuri_received_at && !stored && !note && req.body?.received !== "true") {
      return res.status(400).json({ error: "Nothing to record" });
    }
    await execute(
      `UPDATE shz_forwards SET
         manzuri_received_at = COALESCE(manzuri_received_at, ?),
         manzuri_note = COALESCE(?, manzuri_note),
         manzuri_file_path = COALESCE(?, manzuri_file_path),
         manzuri_file_name = COALESCE(?, manzuri_file_name),
         manzuri_file_type = COALESCE(?, manzuri_file_type),
         manzuri_uploaded_at = COALESCE(?, manzuri_uploaded_at)
       WHERE id = ?`,
      [now, note || null, stored, stored ? req.file.originalname : null, stored ? ext : null, stored ? now : null, f.id]);
    for (const id of await hodUserIds()) { try { pingUser(id); } catch { /* best effort */ } }
    const fresh = await queryOne("SELECT * FROM shz_forwards WHERE id = ?", [f.id]);
    res.json({ manzuri: manzuriOut(fresh) });
  } catch (e) { next(e); }
});

// ---------- open the uploaded Manzuri: the requestor, or the HOD ----------
router.get("/manzuri/:requestId/file", async (req, res, next) => {
  try {
    const f = await queryOne("SELECT * FROM shz_forwards WHERE request_id = ?", [req.params.requestId]);
    if (!f || !f.manzuri_file_path) return res.status(404).json({ error: "No Manzuri has been uploaded" });
    if (f.requestor_id !== req.user.id && !req.user.isHod) return res.status(403).end();
    res.type(MANZURI_TYPES[f.manzuri_file_type] || "application/octet-stream");
    res.send(await readStored("documents", f.manzuri_file_path));
  } catch (e) { next(e); }
});

export default router;
