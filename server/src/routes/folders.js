// ============================================================
//   PERSONAL FOLDERS
//   ------------------------------------------------------------
//   A person files their finished documents into folders they name. Everything
//   here is scoped to the signed-in person: no call can name, read or change
//   anyone else's folder, and a folder that is not theirs answers 404 rather
//   than 403 so its existence is not confirmed.
//
//   Filing is an upsert on (user, request) — the table's primary key — which is
//   what makes "one folder per document" true without any checking here.
//   Deleting a folder deletes only the folder; the cascade drops its placement
//   rows and the documents reappear in the main list.
// ============================================================
import { Router } from "express";
import { query, queryOne, execute, getPool } from "../db.js";
import { authRequired } from "../auth.js";
import { deploymentOrg } from "../org.js";
import { authoriseAccess } from "./requests.js";

const router = Router();
const uid = () => `fld_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const MAX_NAME = 60;

// Trimmed and single-spaced, so "  Finance   2026 " and "Finance 2026" are the
// same folder and the unique key sees them that way.
const cleanName = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

const mine = (userId, id) => queryOne("SELECT id, name FROM folders WHERE id = ? AND user_id = ?", [id, userId]);

// A name the person already uses, other than the folder being renamed.
async function clash(userId, name, exceptId = null) {
  return queryOne(
    "SELECT id, name FROM folders WHERE user_id = ? AND name = ? AND id <> ?",
    [userId, name, exceptId || ""]);
}

function validName(name, res) {
  if (!name) { res.status(400).json({ error: "Give the folder a name" }); return false; }
  if (name.length > MAX_NAME) { res.status(400).json({ error: `Keep the name under ${MAX_NAME} characters` }); return false; }
  return true;
}

// GET /api/folders → { folders: [{ id, name, count }], placements: { requestId: folderId } }
// One round trip for everything a list screen needs. Counts are computed here
// each time, joined to requests so a placement whose document has gone is not
// counted; nothing is cached, so nothing can drift.
router.get("/", authRequired, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT f.id, f.name,
              (SELECT COUNT(*) FROM folder_items fi JOIN requests r ON r.id = fi.request_id
                WHERE fi.folder_id = f.id AND fi.user_id = f.user_id) AS count
         FROM folders f WHERE f.user_id = ? ORDER BY f.name`, [req.user.id]);
    const items = await query("SELECT request_id, folder_id FROM folder_items WHERE user_id = ?", [req.user.id]);
    const placements = {};
    for (const it of items) placements[it.request_id] = it.folder_id;
    res.json({ folders: rows.map((f) => ({ id: f.id, name: f.name, count: Number(f.count) })), placements });
  } catch (e) { next(e); }
});

// POST /api/folders { name } → { folder }
router.post("/", authRequired, async (req, res, next) => {
  try {
    const name = cleanName(req.body?.name);
    if (!validName(name, res)) return;
    const existing = await clash(req.user.id, name);
    if (existing) return res.status(409).json({ error: `You already have a folder called "${existing.name}"` });
    const id = uid();
    await execute("INSERT INTO folders (id, user_id, org_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
      [id, req.user.id, req.userRow?.org_id || deploymentOrg() || null, name, Date.now()]);
    res.json({ folder: { id, name, count: 0 } });
  } catch (e) { next(e); }
});

// PUT /api/folders/items { requestIds: [...], folderId | null } — several at once.
// Every id is checked BEFORE anything is written, and the writes share one
// transaction, so a selection either moves whole or not at all. Declared
// before /items/:requestId so "items" is never read as a request id.
const MAX_BULK = 200;
router.put("/items", authRequired, async (req, res, next) => {
  try {
    const raw = req.body?.requestIds;
    if (!Array.isArray(raw) || raw.length === 0) return res.status(400).json({ error: "Choose at least one document" });
    const ids = [...new Set(raw.map((v) => String(v ?? "").trim()).filter(Boolean))];
    if (ids.length === 0 || ids.length > MAX_BULK) return res.status(400).json({ error: `Choose between 1 and ${MAX_BULK} documents` });
    const folderId = req.body?.folderId ? String(req.body.folderId) : null;
    if (folderId && !(await mine(req.user.id, folderId))) return res.status(404).json({ error: "Not found" });
    for (const id of ids) {
      const row = await queryOne("SELECT * FROM requests WHERE id = ?", [id]);
      if (!row || !(await authoriseAccess(req.user, row))) return res.status(404).json({ error: "Not found" });
    }
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const now = Date.now();
      for (const id of ids) {
        if (folderId) {
          await conn.execute(
            `INSERT INTO folder_items (user_id, request_id, folder_id, added_at) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE folder_id = VALUES(folder_id), added_at = VALUES(added_at)`,
            [req.user.id, id, folderId, now]);
        } else {
          await conn.execute("DELETE FROM folder_items WHERE user_id = ? AND request_id = ?", [req.user.id, id]);
        }
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    res.json({ moved: ids.length, folderId });
  } catch (e) { next(e); }
});

// PUT /api/folders/items/:requestId { folderId | null } — file, move or unfile.
// Declared before /:id so the path is never taken for a folder id.
router.put("/items/:requestId", authRequired, async (req, res, next) => {
  try {
    const row = await queryOne("SELECT * FROM requests WHERE id = ?", [req.params.requestId]);
    if (!row || !(await authoriseAccess(req.user, row))) return res.status(404).json({ error: "Not found" });
    const folderId = req.body?.folderId ? String(req.body.folderId) : null;
    if (folderId) {
      if (!(await mine(req.user.id, folderId))) return res.status(404).json({ error: "Not found" });
      await execute(
        `INSERT INTO folder_items (user_id, request_id, folder_id, added_at) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE folder_id = VALUES(folder_id), added_at = VALUES(added_at)`,
        [req.user.id, row.id, folderId, Date.now()]);
    } else {
      await execute("DELETE FROM folder_items WHERE user_id = ? AND request_id = ?", [req.user.id, row.id]);
    }
    res.json({ ok: true, requestId: row.id, folderId });
  } catch (e) { next(e); }
});

// PUT /api/folders/:id { name } → { folder }
router.put("/:id", authRequired, async (req, res, next) => {
  try {
    const folder = await mine(req.user.id, req.params.id);
    if (!folder) return res.status(404).json({ error: "Not found" });
    const name = cleanName(req.body?.name);
    if (!validName(name, res)) return;
    const existing = await clash(req.user.id, name, folder.id);
    if (existing) return res.status(409).json({ error: `You already have a folder called "${existing.name}"` });
    await execute("UPDATE folders SET name = ? WHERE id = ?", [name, folder.id]);
    res.json({ folder: { id: folder.id, name } });
  } catch (e) { next(e); }
});

// DELETE /api/folders/:id — the folder only; its documents return to the main list.
router.delete("/:id", authRequired, async (req, res, next) => {
  try {
    const folder = await mine(req.user.id, req.params.id);
    if (!folder) return res.status(404).json({ error: "Not found" });
    await execute("DELETE FROM folders WHERE id = ?", [folder.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
