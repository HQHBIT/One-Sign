// Executive ↔ Assistant mapping management. Both an admin and the executive
// themselves can create/remove links and set each link's delegation settings
// (can_approve toggle, signature_source). The assistant's "act on behalf"
// endpoints live in routes/assist.js.
import { Router } from "express";
import { query, queryOne, execute, hydrateUser } from "../db.js";
import { authRequired, requireRole } from "../auth.js";

const router = Router();
const uid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// Admin, or the executive acting on their own links.
function canManage(user, executiveId) {
  return user.role === "admin" || (user.role === "executive" && user.id === executiveId);
}

// ---------- candidate pickers ----------
// Users who can be assistants (for the "add assistant" picker).
router.get("/assistant-candidates", authRequired, async (req, res, next) => {
  try {
    if (req.user.role !== "admin" && req.user.role !== "executive") return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT id, name, email FROM users WHERE role = 'executive_assistant' AND active = 1 ORDER BY name");
    res.json({ candidates: rows });
  } catch (e) { next(e); }
});

// Executives (admin picker).
router.get("/executive-candidates", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const rows = await query("SELECT id, name, email FROM users WHERE role = 'executive' AND active = 1 ORDER BY name");
    res.json({ candidates: rows });
  } catch (e) { next(e); }
});

// ---------- list ----------
// Admin: all links. Executive: only their own.
router.get("/", authRequired, async (req, res, next) => {
  try {
    let rows;
    if (req.user.role === "admin") {
      rows = await query(`
        SELECT ea.*, e.name AS executive_name, e.email AS executive_email,
               a.name AS assistant_name, a.email AS assistant_email
        FROM executive_assistants ea
        JOIN users e ON e.id = ea.executive_id
        JOIN users a ON a.id = ea.assistant_id
        ORDER BY e.name, a.name`);
    } else if (req.user.role === "executive") {
      rows = await query(`
        SELECT ea.*, e.name AS executive_name, e.email AS executive_email,
               a.name AS assistant_name, a.email AS assistant_email
        FROM executive_assistants ea
        JOIN users e ON e.id = ea.executive_id
        JOIN users a ON a.id = ea.assistant_id
        WHERE ea.executive_id = ?
        ORDER BY a.name`, [req.user.id]);
    } else {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json({ links: rows.map(shape) });
  } catch (e) { next(e); }
});

function shape(r) {
  return {
    id: r.id,
    executiveId: r.executive_id, executiveName: r.executive_name, executiveEmail: r.executive_email,
    assistantId: r.assistant_id, assistantName: r.assistant_name, assistantEmail: r.assistant_email,
    canApprove: !!r.can_approve,
    signatureSource: r.signature_source,
  };
}

// ---------- create ----------
router.post("/", authRequired, async (req, res, next) => {
  try {
    const { executiveId, assistantId } = req.body || {};
    if (!assistantId) return res.status(400).json({ error: "assistantId is required" });
    // Executives may only link assistants to themselves; admins may link anyone.
    const execId = req.user.role === "executive" ? req.user.id : executiveId;
    if (!execId) return res.status(400).json({ error: "executiveId is required" });
    if (!canManage(req.user, execId)) return res.status(403).json({ error: "Forbidden" });

    const exec = await queryOne("SELECT id, role FROM users WHERE id = ?", [execId]);
    if (!exec || exec.role !== "executive") return res.status(400).json({ error: "That user is not an executive" });
    const asst = await queryOne("SELECT id, role FROM users WHERE id = ?", [assistantId]);
    if (!asst || asst.role !== "executive_assistant") return res.status(400).json({ error: "That user is not an executive assistant" });

    const dup = await queryOne("SELECT id FROM executive_assistants WHERE executive_id = ? AND assistant_id = ?", [execId, assistantId]);
    if (dup) return res.status(409).json({ error: "That assistant is already linked to this executive" });

    const id = uid("ea");
    await execute(
      "INSERT INTO executive_assistants (id, executive_id, assistant_id, can_approve, signature_source, created_at, created_by) VALUES (?, ?, ?, 0, 'executive', ?, ?)",
      [id, execId, assistantId, Date.now(), req.user.id]
    );
    const row = await queryOne(`
      SELECT ea.*, e.name AS executive_name, e.email AS executive_email,
             a.name AS assistant_name, a.email AS assistant_email
      FROM executive_assistants ea
      JOIN users e ON e.id = ea.executive_id
      JOIN users a ON a.id = ea.assistant_id
      WHERE ea.id = ?`, [id]);
    res.json({ link: shape(row) });
  } catch (e) { next(e); }
});

// ---------- update settings (toggle / signature source) ----------
router.put("/:id", authRequired, async (req, res, next) => {
  try {
    const link = await queryOne("SELECT * FROM executive_assistants WHERE id = ?", [req.params.id]);
    if (!link) return res.status(404).json({ error: "Not found" });
    if (!canManage(req.user, link.executive_id)) return res.status(403).json({ error: "Forbidden" });

    const { canApprove, signatureSource } = req.body || {};
    if (canApprove !== undefined) {
      await execute("UPDATE executive_assistants SET can_approve = ? WHERE id = ?", [canApprove ? 1 : 0, link.id]);
    }
    if (signatureSource !== undefined) {
      if (!["executive", "assistant"].includes(signatureSource)) return res.status(400).json({ error: "Invalid signatureSource" });
      await execute("UPDATE executive_assistants SET signature_source = ? WHERE id = ?", [signatureSource, link.id]);
    }
    const row = await queryOne(`
      SELECT ea.*, e.name AS executive_name, e.email AS executive_email,
             a.name AS assistant_name, a.email AS assistant_email
      FROM executive_assistants ea
      JOIN users e ON e.id = ea.executive_id
      JOIN users a ON a.id = ea.assistant_id
      WHERE ea.id = ?`, [link.id]);
    res.json({ link: shape(row) });
  } catch (e) { next(e); }
});

// ---------- remove ----------
router.delete("/:id", authRequired, async (req, res, next) => {
  try {
    const link = await queryOne("SELECT * FROM executive_assistants WHERE id = ?", [req.params.id]);
    if (!link) return res.status(404).json({ error: "Not found" });
    if (!canManage(req.user, link.executive_id)) return res.status(403).json({ error: "Forbidden" });
    await execute("DELETE FROM executive_assistants WHERE id = ?", [link.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
