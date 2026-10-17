// ============================================================
//   WHAT'S NEW — which feature videos a user has already been shown
//   ------------------------------------------------------------
//   The catalogue (titles, videos, who each applies to) ships with the client
//   in client/src/lib/whatsNew.js. The server only remembers, per user, which
//   feature ids have been shown, so a video plays once per user rather than
//   once per device. Ids are opaque here: an unknown id is harmless.
// ============================================================
import express from "express";
import { authRequired } from "../auth.js";
import { query, queryOne, execute } from "../db.js";

const router = express.Router();
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

// GET /api/whats-new → { seen: [featureId], joinedAt }
// joinedAt lets the client tell a brand-new account (shown only the newest
// video) from an existing one (shown every feature released since they joined).
router.get("/", authRequired, async (req, res, next) => {
  try {
    const rows = await query("SELECT feature_id FROM feature_views WHERE user_id = ?", [req.user.id]);
    const me = await queryOne("SELECT created_at FROM users WHERE id = ?", [req.user.id]);
    res.json({ seen: rows.map(r => r.feature_id), joinedAt: me?.created_at ? Number(me.created_at) : null });
  } catch (e) { next(e); }
});

// POST /api/whats-new/seen  { id } — watched to the end or skipped; either way
// it is not shown again on sign-in (it stays in the What's new library).
router.post("/seen", authRequired, async (req, res, next) => {
  try {
    const id = String(req.body?.id || "");
    if (!ID.test(id)) return res.status(400).json({ error: "Unknown feature" });
    await execute(
      "INSERT IGNORE INTO feature_views (user_id, feature_id, seen_at) VALUES (?, ?, ?)",
      [req.user.id, id, Date.now()]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
