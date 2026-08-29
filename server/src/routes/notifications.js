// In-app notification centre: list my notifications + mark them read.
import { Router } from "express";
import { query, execute } from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();

// GET /api/notifications → { notifications: [...latest 50], unread }
router.get("/", authRequired, async (req, res, next) => {
  try {
    const rows = await query(
      "SELECT id, type, title, body, request_id, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
      [req.user.id]
    );
    const unread = rows.filter(r => r.read_at == null).length;
    res.json({
      unread,
      notifications: rows.map(r => ({
        id: r.id, type: r.type, title: r.title, body: r.body,
        requestId: r.request_id, createdAt: Number(r.created_at),
        read: r.read_at != null,
      })),
    });
  } catch (e) { next(e); }
});

// POST /api/notifications/read  body: { ids?: [...] } — omitted/empty = mark ALL read.
router.post("/read", authRequired, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
    if (ids.length) {
      const ph = ids.map(() => "?").join(",");
      await execute(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND id IN (${ph})`, [Date.now(), req.user.id, ...ids]);
    } else {
      await execute("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", [Date.now(), req.user.id]);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
