import { Router } from "express";
import { query, queryOne, execute } from "../db.js";
import { authRequired, requireRole } from "../auth.js";

const router = Router();
const uid = () => `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

router.get("/", authRequired, async (req, res, next) => {
  try {
    const rows = await query("SELECT id, name FROM teams ORDER BY name");
    // Include each team's approvers (with hasSignature flag) so requestors can build workflows
    const auths = await query(`
      SELECT sa.team_id, u.id AS user_id, u.name, u.email, u.signature_path
      FROM signing_authority sa
      JOIN users u ON u.id = sa.user_id
      WHERE u.role = 'approver'
      ORDER BY u.name
    `);
    const byTeam = {};
    for (const a of auths) {
      (byTeam[a.team_id] ||= []).push({
        id: a.user_id, name: a.name, email: a.email, hasSignature: !!a.signature_path
      });
    }
    const teams = rows.map(t => ({ ...t, approvers: byTeam[t.id] || [] }));
    res.json({ teams });
  } catch (e) { next(e); }
});

router.post("/", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: "name required" });
    const exists = await queryOne("SELECT 1 AS ok FROM teams WHERE name = ?", [name.trim()]);
    if (exists) return res.status(409).json({ error: "Team already exists" });
    const id = uid();
    await execute("INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)", [id, name.trim(), Date.now()]);
    res.json({ team: { id, name: name.trim() } });
  } catch (e) { next(e); }
});

router.delete("/:id", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    await execute("DELETE FROM teams WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.put("/:teamId/authority/:userId", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    try { await execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?, ?)", [req.params.userId, req.params.teamId]); } catch {}
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete("/:teamId/authority/:userId", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    await execute("DELETE FROM signing_authority WHERE user_id = ? AND team_id = ?", [req.params.userId, req.params.teamId]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
