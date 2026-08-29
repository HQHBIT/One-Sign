import { Router } from "express";
import { healthCheck as storageHealthCheck } from "../storage.js";
import { query } from "../db.js";
import { authRequired, requireRole } from "../auth.js";

const router = Router();

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
