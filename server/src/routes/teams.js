import { Router } from "express";
import { query, queryOne, execute } from "../db.js";
import { authRequired, requireRole } from "../auth.js";
import { deploymentOrg } from "../org.js";

const router = Router();
const uid = () => `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

router.get("/", authRequired, async (req, res, next) => {
  try {
    const rows = await query("SELECT id, name FROM teams ORDER BY name");
    // A requestor needs a signer's id (to route to them), name, and signature
    // aspect (to size the box); email disambiguates duplicate names in the
    // picker. `role` is org-structure detail with no role in that decision, so
    // it is sent to admins only — least privilege on the directory.
    const isAdmin = req.user.role === "admin";
    const shape = (u) => ({
      id: u.user_id, name: u.name, email: u.email,
      ...(isAdmin ? { role: u.role } : {}),
      hasSignature: !!u.signature_path,
      signatureAspect: u.signature_aspect != null ? Number(u.signature_aspect) : null
    });

    // Designated approvers: whoever holds signing authority for the team. Any
    // user can be appointed — authority, not role, is what confers signing rights.
    const auths = await query(`
      SELECT sa.team_id, u.id AS user_id, u.name, u.email, u.role, u.signature_path, u.signature_aspect
      FROM signing_authority sa
      JOIN users u ON u.id = sa.user_id
      WHERE u.active = 1
      ORDER BY u.name
    `);
    // Everyone assigned to the team — the fallback signer pool when a team has
    // no designated approver yet, so team routing is never a dead end.
    const mems = await query(`
      SELECT u.team_id, u.id AS user_id, u.name, u.email, u.role, u.signature_path, u.signature_aspect
      FROM users u
      WHERE u.team_id IS NOT NULL AND u.active = 1
      ORDER BY u.name
    `);

    const approversBy = {}, membersBy = {};
    for (const a of auths) (approversBy[a.team_id] ||= []).push(shape(a));
    for (const m of mems) (membersBy[m.team_id] ||= []).push(shape(m));

    const teams = rows.map(t => {
      const approvers = approversBy[t.id] || [];
      const members = membersBy[t.id] || [];
      // `signers` is what a requestor may pick from: the designated approvers,
      // or — when none are set — the team's own members.
      const usingMembers = approvers.length === 0 && members.length > 0;
      return {
        ...t, approvers, members,
        signers: approvers.length ? approvers : members,
        signerSource: usingMembers ? "members" : "approvers",
      };
    });
    res.json({ teams });
  } catch (e) { next(e); }
});

router.post("/", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: "name required" });
    // Scoped to this organisation: the unique key is (org_id, name), so the
    // same team name may legitimately exist in the other one.
    const exists = await queryOne("SELECT 1 AS ok FROM teams WHERE name = ? AND org_id = ?", [name.trim(), deploymentOrg()]);
    if (exists) return res.status(409).json({ error: "Team already exists" });
    const id = uid();
    await execute("INSERT INTO teams (id, name, created_at, org_id) VALUES (?, ?, ?, ?)", [id, name.trim(), Date.now(), deploymentOrg()]);
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
