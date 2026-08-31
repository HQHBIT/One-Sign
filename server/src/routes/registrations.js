import { Router } from "express";
import { query, queryOne, execute } from "../db.js";
import { authRequired, requireRole } from "../auth.js";
import { deploymentOrg } from "../org.js";

const router = Router();

function hydrate(r) {
  return {
    id: r.id, name: r.name, email: r.email,
    teamName: r.team_name || "", reportingManager: r.reporting_manager || "",
    status: r.status, rejectReason: r.reject_reason || "",
    createdAt: Number(r.created_at),
    decidedAt: r.decided_at ? Number(r.decided_at) : null
  };
}

// ADMIN — list registrations (pending first, newest first) + pending count.
router.get("/", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const rows = await query("SELECT * FROM registrations ORDER BY (status = 'pending') DESC, created_at DESC");
    res.json({ registrations: rows.map(hydrate), pending: rows.filter(r => r.status === "pending").length });
  } catch (e) { next(e); }
});

// ADMIN — approve: create the user (role requestor) and mark approved.
router.post("/:id/approve", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const reg = await queryOne("SELECT * FROM registrations WHERE id = ?", [req.params.id]);
    if (!reg) return res.status(404).json({ error: "Registration not found" });
    if (reg.status !== "pending") return res.status(400).json({ error: "Already " + reg.status });

    const dup = await queryOne("SELECT id FROM users WHERE LOWER(email) = LOWER(?)", [reg.email]);
    if (dup) {
      await execute("UPDATE registrations SET status='rejected', reject_reason=?, decided_at=?, decided_by=? WHERE id=?",
        ["Email already a user", Date.now(), req.user.id, reg.id]);
      return res.status(409).json({ error: "A user with this email already exists" });
    }

    const userId = "u_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
    // Carry the applicant's chosen password (plaintext) onto the user as last_temp_password
    // so IT Admin can see it in the Users list — same treatment as admin-set passwords.
    await execute(
      "INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, reporting_manager, requested_team, last_temp_password, last_temp_password_at, org_id) VALUES (?, ?, ?, ?, 'requestor', NULL, ?, ?, ?, ?, ?, ?)",
      [userId, reg.email, reg.password_hash, reg.name, Date.now(), reg.reporting_manager, reg.team_name, reg.password_plain || null, reg.password_plain ? Date.now() : null, deploymentOrg()]
    );
    await execute("UPDATE registrations SET status='approved', decided_at=?, decided_by=? WHERE id=?",
      [Date.now(), req.user.id, reg.id]);
    res.json({ ok: true, userId });
  } catch (e) { next(e); }
});

// ADMIN — reject with an optional reason.
router.post("/:id/reject", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
    const reg = await queryOne("SELECT id, status FROM registrations WHERE id = ?", [req.params.id]);
    if (!reg) return res.status(404).json({ error: "Registration not found" });
    if (reg.status !== "pending") return res.status(400).json({ error: "Already " + reg.status });
    await execute("UPDATE registrations SET status='rejected', reject_reason=?, decided_at=?, decided_by=? WHERE id=?",
      [reason || null, Date.now(), req.user.id, req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
