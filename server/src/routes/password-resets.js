import { Router } from "express";
import { query, queryOne, execute } from "../db.js";
import { authRequired, requireRole } from "../auth.js";

const router = Router();

function hydrate(r) {
  return {
    id: r.id, userId: r.user_id, email: r.email, userName: r.user_name || "",
    newPassword: r.new_password_plain || "",
    status: r.status, rejectReason: r.reject_reason || "",
    createdAt: Number(r.created_at),
    decidedAt: r.decided_at ? Number(r.decided_at) : null
  };
}

// ADMIN — list reset requests (pending first, newest first) + pending count.
router.get("/", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT pr.*, u.name AS user_name FROM password_resets pr
      LEFT JOIN users u ON u.id = pr.user_id
      ORDER BY (pr.status = 'pending') DESC, pr.created_at DESC
    `);
    res.json({ resets: rows.map(hydrate), pending: rows.filter(r => r.status === "pending").length });
  } catch (e) { next(e); }
});

// ADMIN — approve: apply the user's chosen password (visible to admin as last_temp_password).
router.post("/:id/approve", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const pr = await queryOne("SELECT * FROM password_resets WHERE id = ?", [req.params.id]);
    if (!pr) return res.status(404).json({ error: "Reset request not found" });
    if (pr.status !== "pending") return res.status(400).json({ error: "Already " + pr.status });
    const user = await queryOne("SELECT id FROM users WHERE id = ?", [pr.user_id]);
    if (!user) return res.status(404).json({ error: "User no longer exists" });

    await execute(
      "UPDATE users SET password_hash = ?, last_temp_password = ?, last_temp_password_at = ? WHERE id = ?",
      [pr.new_password_hash, pr.new_password_plain, Date.now(), pr.user_id]
    );
    await execute("UPDATE password_resets SET status='approved', decided_at=?, decided_by=? WHERE id=?",
      [Date.now(), req.user.id, pr.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ADMIN — reject with an optional reason.
router.post("/:id/reject", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
    const pr = await queryOne("SELECT id, status FROM password_resets WHERE id = ?", [req.params.id]);
    if (!pr) return res.status(404).json({ error: "Reset request not found" });
    if (pr.status !== "pending") return res.status(400).json({ error: "Already " + pr.status });
    await execute("UPDATE password_resets SET status='rejected', reject_reason=?, decided_at=?, decided_by=? WHERE id=?",
      [reason || null, Date.now(), req.user.id, pr.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
