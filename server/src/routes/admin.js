import { Router } from "express";
import { healthCheck as storageHealthCheck } from "../storage.js";
import { query, queryOne } from "../db.js";
import { authRequired, requireRole } from "../auth.js";
import { signNumbersOn } from "../signRegister.js";

const router = Router();

// ---------- Sign Number register (HQHB) — signRegister.js ----------
// Every signature's number, who signed, for whom an assistant acted, when, from
// where, and the fingerprint of the file it produced. A confidential document's
// name is withheld here as everywhere else the IT Admin looks.
const REG_COLS = `g.sign_no, g.request_id, g.signer_id, g.signer_name, g.acted_by_name, g.step_order, g.signed_at,
  g.ip, g.user_agent, g.doc_sha256, g.original_sha256, g.source,
  COALESCE(r.file_name, g.document_name) AS file_name, COALESCE(r.confidential, g.confidential) AS confidential,
  COALESCE(r.status, 'deleted') AS status, COALESCE(u.name, g.requested_by_name) AS requestor_name`;
const regOut = (g) => ({
  signNo: g.sign_no, requestId: g.request_id, signerId: g.signer_id, signerName: g.signer_name,
  actedBy: g.acted_by_name || null, step: g.step_order, signedAt: Number(g.signed_at),
  ip: g.ip, userAgent: g.user_agent, docSha256: g.doc_sha256, originalSha256: g.original_sha256, source: g.source,
  documentName: Number(g.confidential) ? "Confidential document" : g.file_name,
  confidential: !!Number(g.confidential), documentStatus: g.status, requestedBy: g.requestor_name,
});

router.get("/admin/sign-register", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    if (!signNumbersOn()) return res.json({ enabled: false, total: 0, signatures: [] });
    const q = String(req.query.q || "").trim();
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const like = `%${q}%`;
    // A confidential document's name is never matched either — searching for
    // it must not reveal that it exists.
    const where = q
      ? `WHERE g.sign_no LIKE ? OR g.signer_name LIKE ? OR g.request_id LIKE ? OR (COALESCE(r.confidential, g.confidential, 0) = 0 AND COALESCE(r.file_name, g.document_name) LIKE ?)`
      : "";
    const params = q ? [like, like, like, like] : [];
    const [{ n }] = await query(`SELECT COUNT(*) AS n FROM sign_register g LEFT JOIN requests r ON r.id = g.request_id ${where}`, params);
    const rows = await query(
      `SELECT ${REG_COLS} FROM sign_register g
         LEFT JOIN requests r ON r.id = g.request_id LEFT JOIN users u ON u.id = r.requestor_id
         ${where} ORDER BY g.signed_at DESC, g.seq DESC LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ enabled: true, total: Number(n), signatures: rows.map(regOut) });
  } catch (e) { next(e); }
});

// One Sign Number, with every other signature on the same document.
router.get("/admin/sign-register/:signNo", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    if (!signNumbersOn()) return res.status(404).json({ error: "Not found" });
    const g = await queryOne(
      `SELECT ${REG_COLS} FROM sign_register g
         LEFT JOIN requests r ON r.id = g.request_id LEFT JOIN users u ON u.id = r.requestor_id
        WHERE g.sign_no = ?`, [String(req.params.signNo).trim().toUpperCase()]);
    if (!g) return res.status(404).json({ error: "No signature has that Sign Number" });
    const siblings = await query(
      `SELECT ${REG_COLS} FROM sign_register g
         LEFT JOIN requests r ON r.id = g.request_id LEFT JOIN users u ON u.id = r.requestor_id
        WHERE g.request_id = ? ORDER BY g.signed_at, g.seq`, [g.request_id]);
    res.json({ signature: regOut(g), document: siblings.map(regOut) });
  } catch (e) { next(e); }
});

// Object storage diagnostic. Does a real write / read-back / delete rather than
// only pinging the bucket — credentials that can reach a bucket but not write to
// it would otherwise look healthy right up until the first upload failed.
// Admin-only: it names the endpoint and bucket, and reports whether credentials
// are present. It never returns the secret itself.
router.get("/storage-health", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    res.json(await storageHealthCheck());
  } catch (e) { next(e); }
});

router.get("/emails", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const rows = await query("SELECT * FROM emails ORDER BY sent_at DESC LIMIT 500");
    res.json({
      emails: rows.map(r => ({
        id: r.id, to: r.to_email, subject: r.subject, body: r.body,
        template: r.template, sentAt: Number(r.sent_at), delivered: !!r.delivered, error: r.error
      }))
    });
  } catch (e) { next(e); }
});

router.get("/reports/teams", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT t.id, t.name,
        SUM(CASE WHEN r.status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN r.status = 'approved_pending' THEN 1 ELSE 0 END) AS pending_finalise,
        SUM(CASE WHEN r.status = 'approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN r.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
        COUNT(r.id) AS total
      FROM teams t LEFT JOIN requests r ON r.target_team_id = t.id
      GROUP BY t.id, t.name ORDER BY t.name
    `);
    res.json({ teams: rows.map(r => ({
      id: r.id, name: r.name,
      total: Number(r.total), pending: Number(r.pending),
      pending_finalise: Number(r.pending_finalise),
      approved: Number(r.approved), rejected: Number(r.rejected)
    })) });
  } catch (e) { next(e); }
});

router.get("/reports/csv", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT r.id, r.file_name, t.name AS team_name, u1.name AS requestor_name,
             u2.name AS approver_name, r.status, r.created_at, r.finalized_at, r.rejected_at, r.reject_reason
      FROM requests r
      LEFT JOIN teams t ON t.id = r.target_team_id
      LEFT JOIN users u1 ON u1.id = r.requestor_id
      LEFT JOIN users u2 ON u2.id = r.approver_id
      ORDER BY r.created_at DESC
    `);

    const header = ["request_id", "file_name", "team", "requestor", "approver", "status", "created_at", "resolved_at", "reject_reason"];
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [header.map(esc).join(",")];
    for (const r of rows) {
      lines.push([
        r.id, r.file_name, r.team_name, r.requestor_name, r.approver_name || "", r.status,
        new Date(Number(r.created_at)).toISOString(),
        r.finalized_at ? new Date(Number(r.finalized_at)).toISOString()
          : (r.rejected_at ? new Date(Number(r.rejected_at)).toISOString() : ""),
        r.reject_reason || ""
      ].map(esc).join(","));
    }
    const csv = lines.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="signflow-report-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (e) { next(e); }
});

export default router;
