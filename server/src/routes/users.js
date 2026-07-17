import { Router } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { query, queryOne, execute, hydrateUser, getPool } from "../db.js";
import { authRequired, requireRole } from "../auth.js";
import { sendEmail } from "../email.js";

// Generate a friendly random password — 10 chars, mixed case + digits, no easily
// confused glyphs (no 0/O/1/l/I). Used by the invite endpoint so admins never
// need to know or transcribe passwords; the user gets it via email.
// Exported so the auth route can reuse the same generator for the public
// /forgot-password flow.
export function genTempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let pwd = "";
  for (let i = 0; i < 10; i++) {
    pwd += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return pwd;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIG_DIR = path.join(__dirname, "..", "..", "uploads", "signatures");

const router = Router();
const uid = (p = "id") => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// Reads native pixel dimensions from a PNG or JPEG buffer. Returns null if the
// format isn't recognised — callers should treat that as "aspect unknown".
function readImageSize(buf) {
  if (!buf || buf.length < 24) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A, then 4-byte length, "IHDR", then W (BE32), H (BE32)
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: FF D8 ... scan for SOFn (FF C0..C3, C5..C7, C9..CB, CD..CF). After the
  // marker: 2-byte segment length, 1-byte precision, 2-byte height, 2-byte width.
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const m = buf[i + 1];
      const isSof = (m >= 0xC0 && m <= 0xCF) && m !== 0xC4 && m !== 0xC8 && m !== 0xCC;
      if (isSof) {
        const h = buf.readUInt16BE(i + 5);
        const w = buf.readUInt16BE(i + 7);
        return { width: w, height: h };
      }
      const segLen = buf.readUInt16BE(i + 2);
      i += 2 + segLen;
    }
  }
  return null;
}

// ---------- list ----------
router.get("/", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const rows = await query("SELECT * FROM users ORDER BY created_at DESC");
    const users = await Promise.all(rows.map(hydrateUser));
    res.json({ users });
  } catch (e) { next(e); }
});

// ---------- directory search (any authenticated user) ----------
// GET /api/users/search?q=  — up to 10 users whose name or email contains q
// (case-insensitive, q length >= 2). Minimal fields; excludes the caller.
// Powers the "send to a specific person" request flow. Declared before any
// "/:id" routes so the literal path is never shadowed.
router.get("/search", authRequired, async (req, res, next) => {
  try {
    const q = (req.query.q || "").toString().trim();
    if (q.length < 2) return res.json({ users: [] });
    const like = `%${q}%`;
    const rows = await query(
      `SELECT id, name, email, signature_path FROM users
       WHERE id <> ? AND (name LIKE ? OR email LIKE ?)
       ORDER BY name ASC LIMIT 10`,
      [req.user.id, like, like]
    );
    res.json({ users: rows.map(r => ({ id: r.id, name: r.name, email: r.email, hasSignature: !!r.signature_path })) });
  } catch (e) { next(e); }
});

// ---------- create ----------
router.post("/", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const { email, password, name, role, team, signingAuthorityTeams } = req.body || {};
    if (!email || !password || !name || !role) return res.status(400).json({ error: "email, password, name, role are required" });
    if (!["admin", "requestor", "approver"].includes(role)) return res.status(400).json({ error: "Invalid role" });

    const existing = await queryOne("SELECT id FROM users WHERE LOWER(email) = LOWER(?)", [email]);
    if (existing) return res.status(409).json({ error: "Email already exists" });

    const id = uid("u");
    const hash = bcrypt.hashSync(password, 10);
    const teamId = role === "requestor" ? (team || null) : null;
    const now = Date.now();

    // Persist the plaintext password chosen at creation so admins can recover
    // it later from the Users page without doing a reset. Cleared on next
    // reset / invite / forgot-password.
    await execute(
      "INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, last_temp_password, last_temp_password_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, email, hash, name, role, teamId, now, password, now]
    );

    if (role === "approver" && Array.isArray(signingAuthorityTeams)) {
      for (const tid of signingAuthorityTeams) {
        try { await execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?, ?)", [id, tid]); } catch {}
      }
    }

    const row = await queryOne("SELECT * FROM users WHERE id = ?", [id]);
    res.json({ user: await hydrateUser(row) });
  } catch (e) { next(e); }
});

// ---------- bulk create ----------
router.post("/bulk", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const { rows } = req.body || {};
    if (!Array.isArray(rows)) return res.status(400).json({ error: "rows must be an array" });

    let imported = 0;
    const now = Date.now();
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      for (const r of rows) {
        if (!r.email || !r.name || !r.role || !r.password) continue;
        if (!["admin", "requestor", "approver"].includes(r.role)) continue;
        const [exists] = await conn.execute("SELECT id FROM users WHERE LOWER(email) = LOWER(?)", [r.email]);
        if (exists.length) continue;
        const id = uid("u");
        const hash = bcrypt.hashSync(r.password, 10);
        await conn.execute(
          "INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, last_temp_password, last_temp_password_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [id, r.email, hash, r.name, r.role, r.role === "requestor" ? (r.team || null) : null, now, r.password, now]
        );
        if (r.role === "approver" && r.teams) {
          const tids = r.teams.split("|").map(s => s.trim()).filter(Boolean);
          for (const tid of tids) {
            try { await conn.execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?, ?)", [id, tid]); } catch {}
          }
        }
        imported++;
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    res.json({ imported });
  } catch (e) { next(e); }
});

// ---------- send a single welcome / invite email ----------
// POST /api/users/:id/invite
// Generates a fresh random temp password, hashes it, and emails the plaintext
// to the user. Admin-only. Used by the team-onboarding flow to bulk-send.
router.post("/:id/invite", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const target = await queryOne("SELECT * FROM users WHERE id = ?", [req.params.id]);
    if (!target) return res.status(404).json({ error: "User not found" });

    // Look up team and signing-authority context for the email body
    let teamName = null;
    if (target.team_id) {
      const t = await queryOne("SELECT name FROM teams WHERE id = ?", [target.team_id]);
      teamName = t?.name || null;
    }
    const [authRows] = await getPool().execute(
      "SELECT t.name FROM signing_authority sa JOIN teams t ON t.id = sa.team_id WHERE sa.user_id = ?",
      [target.id]
    );
    const authNames = authRows.map(r => r.name);
    const isApprover = target.role === "approver";
    if (isApprover && authNames.length > 0) teamName = authNames.join(", ");

    const password = genTempPassword();
    const hash = bcrypt.hashSync(password, 10);
    await execute(
      "UPDATE users SET password_hash = ?, last_temp_password = ?, last_temp_password_at = ? WHERE id = ?",
      [hash, password, Date.now(), target.id]
    );

    const signInUrl = req.protocol + "://" + req.get("host");
    const result = await sendEmail({
      to: target.email,
      template: "welcome",
      ctx: { name: target.name, email: target.email, password, teamName, isApprover, signInUrl }
    });
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

// ---------- bulk invite ----------
// POST /api/users/bulk-invite  body: { ids: ["u_...", ...] }
// Fires the welcome email for every id in the list. Stops at no individual
// failure — returns a per-id status report so the UI can show which succeeded.
router.post("/bulk-invite", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) return res.status(400).json({ error: "ids array required" });

    const results = [];
    for (const id of ids) {
      try {
        const target = await queryOne("SELECT * FROM users WHERE id = ?", [id]);
        if (!target) { results.push({ id, ok: false, error: "User not found" }); continue; }

        let teamName = null;
        if (target.team_id) {
          const t = await queryOne("SELECT name FROM teams WHERE id = ?", [target.team_id]);
          teamName = t?.name || null;
        }
        const [authRows] = await getPool().execute(
          "SELECT t.name FROM signing_authority sa JOIN teams t ON t.id = sa.team_id WHERE sa.user_id = ?",
          [target.id]
        );
        const authNames = authRows.map(r => r.name);
        const isApprover = target.role === "approver";
        if (isApprover && authNames.length > 0) teamName = authNames.join(", ");

        const password = genTempPassword();
        const hash = bcrypt.hashSync(password, 10);
        await execute(
          "UPDATE users SET password_hash = ?, last_temp_password = ?, last_temp_password_at = ? WHERE id = ?",
          [hash, password, Date.now(), target.id]
        );

        const signInUrl = req.protocol + "://" + req.get("host");
        const r = await sendEmail({
          to: target.email,
          template: "welcome",
          ctx: { name: target.name, email: target.email, password, teamName, isApprover, signInUrl }
        });
        results.push({ id, ok: true, email: target.email, delivered: r.delivered, error: r.error || null });
      } catch (e) {
        results.push({ id, ok: false, error: e.message || "Unknown error" });
      }
    }
    res.json({ results, total: ids.length, succeeded: results.filter(r => r.ok).length });
  } catch (e) { next(e); }
});

// ---------- admin: reset a user's password ----------
// POST /api/users/:id/reset-password
// Generates a fresh random temp password, hashes it, and emails the plaintext
// to the user. Admin-only. The "reset_password" template makes it clear an
// administrator initiated the change (vs. user-initiated forgot-password).
router.post("/:id/reset-password", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const target = await queryOne("SELECT * FROM users WHERE id = ?", [req.params.id]);
    if (!target) return res.status(404).json({ error: "User not found" });

    // Admin may optionally pick a specific password via body.password.
    // Empty / missing → auto-generate as before.
    const customPwd = typeof req.body?.password === "string" ? req.body.password.trim() : "";
    let password;
    if (customPwd) {
      if (customPwd.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }
      password = customPwd;
    } else {
      password = genTempPassword();
    }
    const hash = bcrypt.hashSync(password, 10);
    await execute(
      "UPDATE users SET password_hash = ?, last_temp_password = ?, last_temp_password_at = ? WHERE id = ?",
      [hash, password, Date.now(), target.id]
    );

    const signInUrl = req.protocol + "://" + req.get("host");
    const result = await sendEmail({
      to: target.email,
      template: "reset_password",
      ctx: { name: target.name, email: target.email, password, signInUrl, byAdmin: true }
    });
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

// ---------- set / change a requestor's team (department) ----------
// PUT /api/users/:id/team  body: { teamId: "t_..." | null }
// Admin-only. Used by the team-membership editor to (re)assign a requestor
// without having to delete and recreate the user. Sending teamId: null clears
// the assignment. Validates that the user is a requestor and the team exists.
router.put("/:id/team", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const { teamId } = req.body || {};
    const target = await queryOne("SELECT id, role FROM users WHERE id = ?", [req.params.id]);
    if (!target) return res.status(404).json({ error: "User not found" });
    if (target.role !== "requestor") return res.status(400).json({ error: "Only requestors have a department" });
    if (teamId) {
      const team = await queryOne("SELECT id FROM teams WHERE id = ?", [teamId]);
      if (!team) return res.status(404).json({ error: "Team not found" });
    }
    await execute("UPDATE users SET team_id = ? WHERE id = ?", [teamId || null, req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- delete ----------
router.delete("/:id", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: "Cannot delete yourself" });
    await execute("DELETE FROM users WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- my signature ----------
router.put("/me/signature", authRequired, upload.single("signature"), async (req, res, next) => {
  try {
    const userId = req.user.id;
    const buf = req.file?.buffer;
    const dataUrlField = req.body?.dataUrl;
    let buffer = null, ext = "png";

    if (buf) {
      buffer = buf;
      const mt = (req.file.mimetype || "").toLowerCase();
      ext = mt.includes("jpeg") || mt.includes("jpg") ? "jpg" : "png";
    } else if (dataUrlField && dataUrlField.startsWith("data:image/")) {
      const match = /^data:image\/(png|jpeg|jpg);base64,(.+)$/.exec(dataUrlField);
      if (!match) return res.status(400).json({ error: "Invalid dataUrl" });
      ext = match[1] === "jpeg" ? "jpg" : match[1];
      buffer = Buffer.from(match[2], "base64");
    } else {
      return res.status(400).json({ error: "signature file or dataUrl required" });
    }

    await fs.mkdir(SIG_DIR, { recursive: true });
    const fileName = `${userId}.${ext}`;
    await fs.writeFile(path.join(SIG_DIR, fileName), buffer);
    const dims = readImageSize(buffer);
    const aspect = dims && dims.height > 0 ? dims.width / dims.height : null;
    await execute("UPDATE users SET signature_path = ?, signature_aspect = ? WHERE id = ?", [fileName, aspect, userId]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- admin set signature for a user ----------
router.put("/:id/signature", authRequired, requireRole("admin"), upload.single("signature"), async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const target = await queryOne("SELECT id FROM users WHERE id = ?", [targetId]);
    if (!target) return res.status(404).json({ error: "User not found" });
    const buf = req.file?.buffer;
    if (!buf) return res.status(400).json({ error: "Signature file required" });

    await fs.mkdir(SIG_DIR, { recursive: true });
    const mt = (req.file.mimetype || "").toLowerCase();
    const ext = mt.includes("jpeg") || mt.includes("jpg") ? "jpg" : "png";
    const fileName = `${targetId}.${ext}`;
    await fs.writeFile(path.join(SIG_DIR, fileName), buf);
    const dims = readImageSize(buf);
    const aspect = dims && dims.height > 0 ? dims.width / dims.height : null;
    await execute("UPDATE users SET signature_path = ?, signature_aspect = ? WHERE id = ?", [fileName, aspect, targetId]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- get signature image (authenticated) ----------
router.get("/:id/signature", authRequired, async (req, res, next) => {
  try {
    const row = await queryOne("SELECT signature_path FROM users WHERE id = ?", [req.params.id]);
    if (!row?.signature_path) return res.status(404).end();
    res.sendFile(path.join(SIG_DIR, row.signature_path));
  } catch (e) { next(e); }
});

// ---------- bulk signatures ----------
router.post("/signatures/bulk", authRequired, requireRole("admin"), upload.array("signatures", 200), async (req, res, next) => {
  try {
    await fs.mkdir(SIG_DIR, { recursive: true });
    const matched = [];
    for (const f of (req.files || [])) {
      const email = f.originalname.replace(/\.(png|jpg|jpeg)$/i, "").toLowerCase();
      const user = await queryOne("SELECT id FROM users WHERE LOWER(email) = ?", [email]);
      if (!user) continue;
      const mt = (f.mimetype || "").toLowerCase();
      const ext = mt.includes("jpeg") || mt.includes("jpg") ? "jpg" : "png";
      const fileName = `${user.id}.${ext}`;
      await fs.writeFile(path.join(SIG_DIR, fileName), f.buffer);
      const dims = readImageSize(f.buffer);
      const aspect = dims && dims.height > 0 ? dims.width / dims.height : null;
      await execute("UPDATE users SET signature_path = ?, signature_aspect = ? WHERE id = ?", [fileName, aspect, user.id]);
      matched.push({ email, userId: user.id });
    }
    res.json({ matched: matched.length, results: matched });
  } catch (e) { next(e); }
});

// ---------- detect likely-duplicate accounts (same person, two logins) ----------
// A person can end up with a local account AND a separate oneAccess account when
// their oneAccess email differs from their work email. We flag pairs that share the
// same ITS id, or share at least two "name parts" once honorifics are stripped —
// which catches e.g. "Taha Chunawala" (local) vs "Taha bhai … Chunawala" (oneAccess).
const HONORIFICS = new Set(["bhai", "bhaisaheb", "bsb", "behen", "behn", "bhen", "mulla", "shaikh", "sheikh", "janab", "mr", "mrs", "ms", "dr", "the"]);
function nameTokens(name) {
  return String(name || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(t => t.length > 1 && !HONORIFICS.has(t));
}
export async function findDuplicateCandidates() {
  const users = await query("SELECT id, email, name, role, its_id, auth_provider FROM users");
  const toks = users.map(u => nameTokens(u.name));
  const pairs = [];
  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < users.length; j++) {
      const sameIts = users[i].its_id && users[i].its_id === users[j].its_id;
      const setJ = new Set(toks[j]);
      const shared = toks[i].filter(t => setJ.has(t)).length;
      if (sameIts || shared >= 2) {
        pairs.push({
          reason: sameIts ? "same ITS id" : `${shared} name parts match`,
          sharedTokens: shared,
          crossProvider: users[i].auth_provider !== users[j].auth_provider,
          a: users[i],
          b: users[j],
        });
      }
    }
  }
  // Cross-provider pairs (a local + a oneAccess account) are the most likely real
  // splits — surface those first, then the strongest name matches.
  pairs.sort((p, q) => (Number(q.crossProvider) - Number(p.crossProvider)) || (q.sharedTokens - p.sharedTokens));
  return pairs;
}

router.get("/duplicates", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    res.json({ pairs: await findDuplicateCandidates() });
  } catch (e) { next(e); }
});

export default router;
