// ============================================================
//   Workflow templates — a requestor's saved, reusable routing.
//   ------------------------------------------------------------
//   A template stores the ROUTE only: ordered steps, each with a team and an
//   ordered list of signer userIds. Box placements are per-document, so using a
//   template means: attach a document, place each signer's boxes, submit.
//   Owner-scoped: users see and manage only their own templates.
// ============================================================
import { Router } from "express";
import { query, queryOne, execute } from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();
const uid = () => `wft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// Validate + normalise the steps payload: [{teamId, signers:[userId,...]}, ...]
function parseSteps(raw) {
  const steps = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(steps) || steps.length === 0) throw new Error("Add at least one step");
  return steps.map((st, i) => {
    if (!st?.teamId) throw new Error(`Step ${i + 1}: pick a team`);
    const signers = (Array.isArray(st.signers) ? st.signers : [])
      .map(s => (typeof s === "string" ? s : s?.userId)).filter(Boolean);
    if (signers.length === 0) throw new Error(`Step ${i + 1}: add at least one signer`);
    return { teamId: st.teamId, signers };
  });
}

// Resolve names + validity so the list shows a meaningful summary and flags
// anything that went stale (team deleted, signer deactivated / authority revoked).
async function hydrateTemplate(row) {
  let steps = [];
  try { steps = JSON.parse(row.steps_json) || []; } catch { /* empty */ }
  const out = [];
  for (const st of steps) {
    const team = await queryOne("SELECT id, name FROM teams WHERE id = ?", [st.teamId]);
    const signers = [];
    for (const uidStr of st.signers) {
      const u = await queryOne("SELECT id, name, role, active, team_id, signature_path FROM users WHERE id = ?", [uidStr]);
      // A legitimate signer for a TEAM STEP is exactly who the builder offered:
      // someone who holds signing authority for the team, OR is a member of it
      // (the fallback when the team has no designated approver). Requiring
      // authority alone was stricter than both the builder and the approval
      // step — which only needs the assigned person to sign — so it flagged
      // perfectly workable workflows. This mirrors teamSigners() on the client.
      const active = u && (u.active == null || Number(u.active) === 1);
      const hasAuth = u ? await queryOne("SELECT 1 AS ok FROM signing_authority WHERE user_id = ? AND team_id = ?", [uidStr, st.teamId]) : null;
      const isMember = u && u.team_id === st.teamId;
      const linked = !!(hasAuth || isMember);

      // A specific reason when something is off, so the UI can say what to fix
      // instead of a vague "needs attention".
      let reason = null;
      if (!u) reason = "This user no longer exists — remove them from the step.";
      else if (!active) reason = `${u.name} has been deactivated — remove or replace them.`;
      else if (!linked) reason = `${u.name} is no longer on ${team?.name || "this team"} — add them to the team (or grant signing authority), or pick someone else.`;

      signers.push({
        userId: uidStr,
        name: u?.name || "(removed user)",
        hasSignature: !!u?.signature_path,
        valid: !!(active && linked),
        reason,
      });
    }
    out.push({
      teamId: st.teamId, teamName: team?.name || "(removed team)", teamValid: !!team,
      reason: team ? null : "This team has been deleted — pick a different team for this step.",
      signers,
    });
  }
  return {
    id: row.id, name: row.name, steps: out,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    valid: out.every(s => s.teamValid && s.signers.every(g => g.valid)),
  };
}

// ---------- list mine ----------
router.get("/", authRequired, async (req, res, next) => {
  try {
    const rows = await query("SELECT * FROM workflow_templates WHERE owner_id = ? ORDER BY updated_at DESC", [req.user.id]);
    res.json({ templates: await Promise.all(rows.map(hydrateTemplate)) });
  } catch (e) { next(e); }
});

// ---------- create ----------
router.post("/", authRequired, async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Give the workflow a name" });
    let steps;
    try { steps = parseSteps(req.body?.steps); } catch (e) { return res.status(400).json({ error: e.message }); }
    const id = uid();
    const now = Date.now();
    await execute(
      "INSERT INTO workflow_templates (id, owner_id, name, steps_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [id, req.user.id, name.slice(0, 120), JSON.stringify(steps), now, now]
    );
    res.json({ template: await hydrateTemplate(await queryOne("SELECT * FROM workflow_templates WHERE id = ?", [id])) });
  } catch (e) { next(e); }
});

// ---------- update (rename and/or replace steps) ----------
router.put("/:id", authRequired, async (req, res, next) => {
  try {
    const row = await queryOne("SELECT * FROM workflow_templates WHERE id = ? AND owner_id = ?", [req.params.id, req.user.id]);
    if (!row) return res.status(404).json({ error: "Workflow not found" });
    let name = row.name, stepsJson = row.steps_json;
    if (req.body?.name != null) {
      name = String(req.body.name).trim().slice(0, 120);
      if (!name) return res.status(400).json({ error: "Give the workflow a name" });
    }
    if (req.body?.steps != null) {
      try { stepsJson = JSON.stringify(parseSteps(req.body.steps)); }
      catch (e) { return res.status(400).json({ error: e.message }); }
    }
    await execute("UPDATE workflow_templates SET name = ?, steps_json = ?, updated_at = ? WHERE id = ?", [name, stepsJson, Date.now(), row.id]);
    res.json({ template: await hydrateTemplate(await queryOne("SELECT * FROM workflow_templates WHERE id = ?", [row.id])) });
  } catch (e) { next(e); }
});

// ---------- delete ----------
router.delete("/:id", authRequired, async (req, res, next) => {
  try {
    await execute("DELETE FROM workflow_templates WHERE id = ? AND owner_id = ?", [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
