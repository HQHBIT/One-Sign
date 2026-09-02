import { Router } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { query, queryOne, execute, hydrateUser, getPool } from "../db.js";
import { authRequired, requireRole, isSigner } from "../auth.js";
import { sendEmail } from "../email.js";
import { deploymentOrg } from "../org.js";

// A department member is also an approver of that department (product
// direction 2026-09-02): they hold that team's signing authority, so Teams &
// authority lists them under Approvers and a request routed to the team can
// reach them. HQHB only — the WAQF box keeps explicit appointment, and both
// boxes deploy from the same branch, so the organisation decides, not the code
// version. Adding only: an authority granted by hand is never removed here.
const membersAreApprovers = () => deploymentOrg() === "hqhb";
async function grantTeamAuthority(runner, userId, teamId) {
  if (!teamId || !membersAreApprovers()) return;
  try {
    await runner("INSERT IGNORE INTO signing_authority (user_id, team_id) VALUES (?, ?)", [userId, teamId]);
  } catch (e) {
    // A member who could not be made an approver must not fail their creation
    // or their move between departments — the backfill script catches these.
    console.error("[teams] could not grant member authority:", e.message);
  }
}

// Roles an admin may assign when creating users.
const ASSIGNABLE_ROLES = ["admin", "requestor", "approver", "executive", "executive_assistant"];

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
// Exported: the assist route stores an executive's signature the same way.
export function readImageSize(buf) {
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
       WHERE id <> ? AND active = 1 AND (name LIKE ? OR email LIKE ?)
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
    if (!ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ error: "Invalid role" });

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
      "INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, last_temp_password, last_temp_password_at, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, email, hash, name, role, teamId, now, password, now, deploymentOrg()]
    );

    if (isSigner(role) && Array.isArray(signingAuthorityTeams)) {
      for (const tid of signingAuthorityTeams) {
        try { await execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?, ?)", [id, tid]); } catch {}
      }
    }
    await grantTeamAuthority(execute, id, teamId);

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
        if (!ASSIGNABLE_ROLES.includes(r.role)) continue;
        const [exists] = await conn.execute("SELECT id FROM users WHERE LOWER(email) = LOWER(?)", [r.email]);
        if (exists.length) continue;
        const id = uid("u");
        const hash = bcrypt.hashSync(r.password, 10);
        await conn.execute(
          "INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, last_temp_password, last_temp_password_at, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [id, r.email, hash, r.name, r.role, r.role === "requestor" ? (r.team || null) : null, now, r.password, now, deploymentOrg()]
        );
        if (isSigner(r.role) && r.teams) {
          const tids = r.teams.split("|").map(s => s.trim()).filter(Boolean);
          for (const tid of tids) {
            try { await conn.execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?, ?)", [id, tid]); } catch {}
          }
        }
        await grantTeamAuthority((sql, args) => conn.execute(sql, args),
          id, r.role === "requestor" ? (r.team || null) : null);
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
    const isApprover = isSigner(target.role);
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
        const isApprover = isSigner(target.role);
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
    await grantTeamAuthority(execute, req.params.id, teamId);
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
// A signature image from either a multipart file or a dataUrl → {buffer, ext},
// or null when neither is usable. Shared by the single- and multi-signature routes.
function parseSignatureUpload(req) {
  const buf = req.file?.buffer;
  if (buf) {
    const mt = (req.file.mimetype || "").toLowerCase();
    return { buffer: buf, ext: mt.includes("jpeg") || mt.includes("jpg") ? "jpg" : "png" };
  }
  const dataUrlField = req.body?.dataUrl;
  if (dataUrlField && dataUrlField.startsWith("data:image/")) {
    const match = /^data:image\/(png|jpeg|jpg);base64,(.+)$/.exec(dataUrlField);
    if (!match) return null;
    return { buffer: Buffer.from(match[2], "base64"), ext: match[1] === "jpeg" ? "jpg" : match[1] };
  }
  return null;
}

// Keep user_signatures in step whenever something writes users.signature_path
// directly (the classic pad, the admin setter, bulk upload): the DEFAULT row
// mirrors it, created on first touch. Without this the picker would show a
// stale image for the very signature the system stamps.
async function syncDefaultRow(userId, fileName, aspect) {
  const def = await queryOne("SELECT id FROM user_signatures WHERE user_id = ? AND is_default = 1", [userId]);
  if (def) {
    await execute("UPDATE user_signatures SET file_path = ?, aspect = ? WHERE id = ?", [fileName, aspect, def.id]);
  } else {
    await execute(
      "INSERT INTO user_signatures (id, user_id, label, file_path, aspect, is_default, created_at) VALUES (?, ?, 'My signature', ?, ?, 1, ?)",
      [uid("sig"), userId, fileName, aspect, Date.now()]);
  }
}

router.put("/me/signature", authRequired, upload.single("signature"), async (req, res, next) => {
  try {
    const userId = req.user.id;
    const parsed = parseSignatureUpload(req);
    if (!parsed) return res.status(400).json({ error: "signature file or dataUrl required" });

    await fs.mkdir(SIG_DIR, { recursive: true });
    const fileName = `${userId}.${parsed.ext}`;
    await fs.writeFile(path.join(SIG_DIR, fileName), parsed.buffer);
    const dims = readImageSize(parsed.buffer);
    const aspect = dims && dims.height > 0 ? dims.width / dims.height : null;
    await execute("UPDATE users SET signature_path = ?, signature_aspect = ? WHERE id = ?", [fileName, aspect, userId]);
    await syncDefaultRow(userId, fileName, aspect);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- my signatures (multiple, tagged) ----------
// users.signature_path stays the DEFAULT; these routes manage the named set the
// approver picks from at signing time.
const MAX_SIGNATURES = 5;

// The user's signature rows — migrating a legacy single signature into the
// table on first read, so nobody starts from zero.
async function listSignatureRows(userId) {
  let rows = await query("SELECT * FROM user_signatures WHERE user_id = ? ORDER BY created_at ASC, id ASC", [userId]);
  if (rows.length === 0) {
    const u = await queryOne("SELECT signature_path, signature_aspect FROM users WHERE id = ?", [userId]);
    if (u?.signature_path) {
      await execute(
        "INSERT INTO user_signatures (id, user_id, label, file_path, aspect, is_default, created_at) VALUES (?, ?, 'My signature', ?, ?, 1, ?)",
        [uid("sig"), userId, u.signature_path, u.signature_aspect ?? null, Date.now()]);
      rows = await query("SELECT * FROM user_signatures WHERE user_id = ? ORDER BY created_at ASC, id ASC", [userId]);
    }
  }
  return rows;
}

const shapeSignature = (r) => ({
  id: r.id, label: r.label, aspect: r.aspect == null ? null : Number(r.aspect),
  isDefault: !!Number(r.is_default), createdAt: Number(r.created_at),
  // bgCleaned: this signature has been through background removal (or was
  // inspected and left alone), so the client's one-time pass skips it.
  bgCleaned: !!Number(r.bg_cleaned),
  bgCleanedAt: r.bg_cleaned_at == null ? null : Number(r.bg_cleaned_at),
  // The pre-clean file is still on disk, so the change can be undone.
  canRestoreOriginal: !!r.original_path,
});

router.get("/me/signatures", authRequired, async (req, res, next) => {
  try {
    res.json({ signatures: (await listSignatureRows(req.user.id)).map(shapeSignature) });
  } catch (e) { next(e); }
});

// ---------- one-time background clean of signatures already on file ----------
// Signatures saved before background removal existed keep their paper, so they
// stamp as an opaque rectangle over the document. The client runs the cutout on
// its owner's next sign-in and posts the result here.
//
// The pre-clean file is NEVER deleted. Together with bg_cleaned_at it is both
// the record that this happened and the undo, which matters because the user
// did not ask for it.
router.post("/me/signatures/:sid/background", authRequired, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const row = await queryOne("SELECT * FROM user_signatures WHERE id = ? AND user_id = ?",
      [req.params.sid, userId]);
    if (!row) return res.status(404).json({ error: "Signature not found" });
    // Already settled — the automatic pass never cleans the same signature twice.
    // `force` is the user asking for it explicitly from the manager, which must
    // work whatever the pass decided earlier.
    const forced = req.body?.force === true || req.body?.force === "true";
    if (Number(row.bg_cleaned) && !forced) return res.json({ signature: shapeSignature(row) });

    // `skip` means the client inspected it and left it alone: already
    // transparent, or the image could not be processed. Marking it stops the
    // pass retrying the same image on every future sign-in.
    if (req.body?.skip || !req.body?.dataUrl) {
      await execute("UPDATE user_signatures SET bg_cleaned = 1 WHERE id = ?", [row.id]);
      return res.json({ signature: shapeSignature({ ...row, bg_cleaned: 1 }) });
    }

    const parsed = parseSignatureUpload(req);
    if (!parsed) return res.status(400).json({ error: "dataUrl required" });

    await fs.mkdir(SIG_DIR, { recursive: true });
    const fileName = `${userId}.${row.id}.clean.${parsed.ext}`;
    await fs.writeFile(path.join(SIG_DIR, fileName), parsed.buffer);
    const dims = readImageSize(parsed.buffer);
    const aspect = dims && dims.height > 0 ? dims.width / dims.height : row.aspect;

    const originalPath = row.original_path || row.file_path;
    await execute(
      `UPDATE user_signatures
          SET file_path = ?, aspect = ?, original_path = ?, bg_cleaned = 1, bg_cleaned_at = ?
        WHERE id = ?`,
      [fileName, aspect, originalPath, Date.now(), row.id]);
    // users.signature_path is the path every legacy caller stamps from, so the
    // default row has to stay in step or the clean would never take effect.
    if (Number(row.is_default)) {
      await execute("UPDATE users SET signature_path = ?, signature_aspect = ? WHERE id = ?",
        [fileName, aspect, userId]);
    }
    console.log(`[signature] background cleaned for user=${userId} sig=${row.id}; original kept as ${originalPath}`);
    res.json({ signature: shapeSignature(await queryOne("SELECT * FROM user_signatures WHERE id = ?", [row.id])) });
  } catch (e) { next(e); }
});

// Undo — puts the original file back. bg_cleaned stays 1 so the next sign-in
// does not immediately clean it all over again.
router.post("/me/signatures/:sid/background/revert", authRequired, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const row = await queryOne("SELECT * FROM user_signatures WHERE id = ? AND user_id = ?",
      [req.params.sid, userId]);
    if (!row) return res.status(404).json({ error: "Signature not found" });
    if (!row.original_path) return res.status(400).json({ error: "There is no earlier version to restore" });

    let aspect = row.aspect;
    try {
      const dims = readImageSize(await fs.readFile(path.join(SIG_DIR, row.original_path)));
      if (dims && dims.height > 0) aspect = dims.width / dims.height;
    } catch { /* unreadable original — keep the recorded aspect */ }

    await execute(
      `UPDATE user_signatures
          SET file_path = ?, aspect = ?, original_path = NULL, bg_cleaned = 1, bg_cleaned_at = NULL
        WHERE id = ?`,
      [row.original_path, aspect, row.id]);
    if (Number(row.is_default)) {
      await execute("UPDATE users SET signature_path = ?, signature_aspect = ? WHERE id = ?",
        [row.original_path, aspect, userId]);
    }
    res.json({ signature: shapeSignature(await queryOne("SELECT * FROM user_signatures WHERE id = ?", [row.id])) });
  } catch (e) { next(e); }
});

router.post("/me/signatures", authRequired, upload.single("signature"), async (req, res, next) => {
  try {
    const userId = req.user.id;
    const label = String(req.body?.label || "").trim().slice(0, 60);
    if (!label) return res.status(400).json({ error: "Give this signature a name tag" });
    const parsed = parseSignatureUpload(req);
    if (!parsed) return res.status(400).json({ error: "signature file or dataUrl required" });

    const rows = await listSignatureRows(userId);   // migrates the legacy one first
    if (rows.length >= MAX_SIGNATURES) {
      return res.status(400).json({ error: `You can keep up to ${MAX_SIGNATURES} signatures — delete one first` });
    }
    if (rows.some(r => r.label.toLowerCase() === label.toLowerCase())) {
      return res.status(400).json({ error: "You already have a signature with that name" });
    }

    const sigId = uid("sig");
    await fs.mkdir(SIG_DIR, { recursive: true });
    const fileName = `${userId}.${sigId}.${parsed.ext}`;
    await fs.writeFile(path.join(SIG_DIR, fileName), parsed.buffer);
    const dims = readImageSize(parsed.buffer);
    const aspect = dims && dims.height > 0 ? dims.width / dims.height : null;

    // The very first signature is automatically the default — "if the user has
    // a single sign it gets selected by default" starts here.
    const isFirst = rows.length === 0;
    // bg_cleaned = 1: this image came through the capture modal, where the user
    // saw the background-removal preview and either accepted it or deliberately
    // switched it off. Either way it's their decision — the auto-clean pass must
    // not come along later and overrule it.
    await execute(
      "INSERT INTO user_signatures (id, user_id, label, file_path, aspect, is_default, created_at, bg_cleaned) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
      [sigId, userId, label, fileName, aspect, isFirst ? 1 : 0, Date.now()]);
    if (isFirst) {
      await execute("UPDATE users SET signature_path = ?, signature_aspect = ? WHERE id = ?", [fileName, aspect, userId]);
    }
    const row = await queryOne("SELECT * FROM user_signatures WHERE id = ?", [sigId]);
    res.json({ signature: shapeSignature(row) });
  } catch (e) { next(e); }
});

router.put("/me/signatures/:sid", authRequired, async (req, res, next) => {
  try {
    const row = await queryOne("SELECT * FROM user_signatures WHERE id = ? AND user_id = ?", [req.params.sid, req.user.id]);
    if (!row) return res.status(404).json({ error: "Signature not found" });

    const label = req.body?.label != null ? String(req.body.label).trim().slice(0, 60) : null;
    if (label != null) {
      if (!label) return res.status(400).json({ error: "The name tag cannot be empty" });
      const clash = await queryOne(
        "SELECT 1 AS ok FROM user_signatures WHERE user_id = ? AND id <> ? AND LOWER(label) = LOWER(?)",
        [req.user.id, row.id, label]);
      if (clash) return res.status(400).json({ error: "You already have a signature with that name" });
      await execute("UPDATE user_signatures SET label = ? WHERE id = ?", [label, row.id]);
    }
    if (req.body?.makeDefault === true) {
      await execute("UPDATE user_signatures SET is_default = 0 WHERE user_id = ?", [req.user.id]);
      await execute("UPDATE user_signatures SET is_default = 1 WHERE id = ?", [row.id]);
      // The default IS users.signature_path — legacy stamping paths follow it.
      await execute("UPDATE users SET signature_path = ?, signature_aspect = ? WHERE id = ?", [row.file_path, row.aspect, req.user.id]);
    }
    const fresh = await queryOne("SELECT * FROM user_signatures WHERE id = ?", [row.id]);
    res.json({ signature: shapeSignature(fresh) });
  } catch (e) { next(e); }
});

router.delete("/me/signatures/:sid", authRequired, async (req, res, next) => {
  try {
    const row = await queryOne("SELECT * FROM user_signatures WHERE id = ? AND user_id = ?", [req.params.sid, req.user.id]);
    if (!row) return res.status(404).json({ error: "Signature not found" });

    await execute("DELETE FROM user_signatures WHERE id = ?", [row.id]);

    if (Number(row.is_default) === 1) {
      // Promote the newest remaining signature, or clear the user's signature
      // entirely — hasSignature flows from users.signature_path.
      const nextDef = await queryOne(
        "SELECT * FROM user_signatures WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1", [req.user.id]);
      if (nextDef) {
        await execute("UPDATE user_signatures SET is_default = 1 WHERE id = ?", [nextDef.id]);
        await execute("UPDATE users SET signature_path = ?, signature_aspect = ? WHERE id = ?", [nextDef.file_path, nextDef.aspect, req.user.id]);
      } else {
        await execute("UPDATE users SET signature_path = NULL, signature_aspect = NULL WHERE id = ?", [req.user.id]);
      }
    }

    // Remove the image only when nothing references it any more. Signed PDFs
    // already carry the stamped pixels, so past documents are unaffected.
    const stillUsed = await queryOne("SELECT 1 AS ok FROM user_signatures WHERE user_id = ? AND file_path = ?", [req.user.id, row.file_path]);
    const u = await queryOne("SELECT signature_path FROM users WHERE id = ?", [req.user.id]);
    if (!stillUsed && u?.signature_path !== row.file_path) {
      await fs.unlink(path.join(SIG_DIR, row.file_path)).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get("/me/signatures/:sid/image", authRequired, async (req, res, next) => {
  try {
    const row = await queryOne("SELECT file_path FROM user_signatures WHERE id = ? AND user_id = ?", [req.params.sid, req.user.id]);
    if (!row) return res.status(404).end();
    res.sendFile(path.join(SIG_DIR, row.file_path));
  } catch (e) { next(e); }
});

// ---------- high-contrast (inverted) display ----------
// The user's own switch. Refused unless the admin has granted access — the
// feature is per-user by design, not global.
router.put("/me/dark-mode", authRequired, async (req, res, next) => {
  try {
    const me = await queryOne("SELECT dark_mode_allowed FROM users WHERE id = ?", [req.user.id]);
    if (!Number(me?.dark_mode_allowed)) {
      return res.status(403).json({ error: "High-contrast display has not been enabled for your account — ask your administrator" });
    }
    const on = req.body?.on === true || req.body?.on === "true" ? 1 : 0;
    // Three dark variants; the user picks whichever reads best for them.
    // 'grayscale' removes hue entirely, so any colour-vision deficiency sees
    // the same picture — everything is distinguished by brightness alone.
    const VARIANTS = ["natural", "invert", "grayscale"];
    const variant = VARIANTS.includes(req.body?.variant) ? req.body.variant : null;
    if (variant) {
      await execute("UPDATE users SET dark_mode_on = ?, dark_mode_variant = ? WHERE id = ?", [on, variant, req.user.id]);
    } else {
      await execute("UPDATE users SET dark_mode_on = ? WHERE id = ?", [on, req.user.id]);
    }
    res.json({ ok: true, on: !!on });
  } catch (e) { next(e); }
});

// The admin's per-user gate. Revoking also switches the display back to normal,
// so a revoked user is never stranded in a mode they can no longer control.
router.put("/:id/dark-mode-access", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const target = await queryOne("SELECT id FROM users WHERE id = ?", [req.params.id]);
    if (!target) return res.status(404).json({ error: "User not found" });
    const allowed = req.body?.allowed === true || req.body?.allowed === "true" ? 1 : 0;
    if (allowed) {
      await execute("UPDATE users SET dark_mode_allowed = 1 WHERE id = ?", [target.id]);
    } else {
      await execute("UPDATE users SET dark_mode_allowed = 0, dark_mode_on = 0 WHERE id = ?", [target.id]);
    }
    res.json({ ok: true, allowed: !!allowed });
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
    await syncDefaultRow(targetId, fileName, aspect);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- get signature image (owner or admin ONLY) ----------
// A signature image is the single most forgeable artefact this system stores.
// Being signed in is NOT enough to fetch someone else's — that would let any
// user harvest every signature in the organisation by iterating ids. Only the
// owner (previews, self-sign) and the admin (Signatures page) may read one.
// Everyone else gets the same 404 an absent signature produces, so the
// endpoint cannot even be used to probe who has a signature on file. Stamping
// other people's signatures onto documents happens purely server-side and
// never needed this endpoint.
router.get("/:id/signature", authRequired, async (req, res, next) => {
  try {
    if (req.params.id !== req.user.id && req.user.role !== "admin") return res.status(404).end();
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
      await syncDefaultRow(user.id, fileName, aspect);
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
  const users = await query("SELECT id, email, name, role, its_id, auth_provider FROM users WHERE active = 1");
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

// ---------- everyone who signs in via oneAccess, with their document footprint ----
// So an admin can gauge risk before linking/merging: an account with 0 raised + 0
// signed is safe to touch; one that owns/signed documents needs care.
router.get("/oneaccess", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT u.id, u.name, u.email, u.its_id, u.role, u.active,
        (SELECT COUNT(*) FROM requests r WHERE r.requestor_id = u.id) AS raised,
        (SELECT COUNT(DISTINCT st.request_id) FROM request_step_signers sg
           JOIN request_steps st ON st.id = sg.step_id
           WHERE sg.user_id = u.id AND sg.status = 'signed') AS signed
      FROM users u WHERE u.auth_provider = 'oneaccess' AND u.active = 1
      ORDER BY LOWER(u.name)
    `);
    res.json({ users: rows.map(r => ({ ...r, raised: Number(r.raised), signed: Number(r.signed), active: r.active == null ? true : !!Number(r.active) })) });
  } catch (e) { next(e); }
});

// ============================================================
//   ITS-driven account reconciliation (link + merge duplicates)
// ============================================================
// Rule: the @hqhb.in account is the keeper. When two ACTIVE accounts share an
// ITS, the other account's data is migrated onto the @hqhb.in one and that other
// account is DEACTIVATED (reversible) — never hard-deleted.

const isHqhb = (email) => /@hqhb\.in\s*$/i.test(String(email || "").trim());

// Document footprint for one account — used to show the admin exactly what a
// merge would move before they confirm it.
async function footprint(userId) {
  const raised = await queryOne("SELECT COUNT(*) AS n FROM requests WHERE requestor_id = ?", [userId]);
  const approved = await queryOne("SELECT COUNT(*) AS n FROM requests WHERE approver_id = ?", [userId]);
  const signed = await queryOne(
    `SELECT COUNT(DISTINCT st.request_id) AS n FROM request_step_signers sg
       JOIN request_steps st ON st.id = sg.step_id
      WHERE sg.user_id = ? AND sg.status = 'signed'`, [userId]);
  return { raised: Number(raised?.n || 0), approved: Number(approved?.n || 0), signed: Number(signed?.n || 0) };
}

async function accountBrief(u) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role,
    itsId: u.its_id || null, authProvider: u.auth_provider || "local",
    isHqhb: isHqhb(u.email), hasSignature: !!u.signature_path,
    footprint: await footprint(u.id),
  };
}

// Preview two accounts that share an ITS: pick the survivor (the @hqhb.in one)
// and attach each account's footprint. When neither/both are @hqhb.in the
// survivor is ambiguous and the admin chooses in the UI.
async function buildMergePreview(a, b) {
  const [ba, bb] = [await accountBrief(a), await accountBrief(b)];
  let survivorId = null;
  if (ba.isHqhb && !bb.isHqhb) survivorId = ba.id;
  else if (bb.isHqhb && !ba.isHqhb) survivorId = bb.id;
  return { survivorId, ambiguous: survivorId == null, accounts: [ba, bb] };
}

// Migrate every reference from `loserId` onto `survivorId`, record the move, then
// deactivate the loser. Transactional: on any error nothing changes.
export async function mergeUsers(survivorId, loserId, performedBy = null) {
  if (survivorId === loserId) throw new Error("Cannot merge an account into itself");
  const survivor = await queryOne("SELECT * FROM users WHERE id = ?", [survivorId]);
  const loser = await queryOne("SELECT * FROM users WHERE id = ?", [loserId]);
  if (!survivor) throw new Error("Keeper account not found");
  if (!loser) throw new Error("Duplicate account not found");
  if (loser.active != null && Number(loser.active) === 0) throw new Error("That duplicate is already deactivated");

  const moved = {};
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    // 1. Requests they raised / approved.
    let [r] = await conn.execute("UPDATE requests SET requestor_id = ? WHERE requestor_id = ?", [survivorId, loserId]);
    moved.requestsRaised = r.affectedRows;
    [r] = await conn.execute("UPDATE requests SET approver_id = ? WHERE approver_id = ?", [survivorId, loserId]);
    moved.requestsApproved = r.affectedRows;

    // 2. Signing steps they were a signer on.
    [r] = await conn.execute("UPDATE request_step_signers SET user_id = ? WHERE user_id = ?", [survivorId, loserId]);
    moved.signerRows = r.affectedRows;

    // 3. Signing authority — PK is (user_id, team_id); drop loser rows that would
    //    collide with the survivor's grants, then move the remainder.
    await conn.execute(
      `DELETE l FROM signing_authority l
         JOIN signing_authority s ON s.team_id = l.team_id AND s.user_id = ?
        WHERE l.user_id = ?`, [survivorId, loserId]);
    [r] = await conn.execute("UPDATE signing_authority SET user_id = ? WHERE user_id = ?", [survivorId, loserId]);
    moved.signingAuthorities = r.affectedRows;

    // 4. Signature — only fill a gap; never overwrite the keeper's own.
    moved.signatureCopied = false;
    if (!survivor.signature_path && loser.signature_path) {
      try {
        const ext = path.extname(loser.signature_path) || ".png";
        const destName = `${survivorId}${ext}`;
        await fs.copyFile(path.join(SIG_DIR, loser.signature_path), path.join(SIG_DIR, destName));
        await conn.execute("UPDATE users SET signature_path = ?, signature_aspect = ? WHERE id = ?",
          [destName, loser.signature_aspect ?? null, survivorId]);
        moved.signatureCopied = true;
      } catch { /* source file missing — skip */ }
    }

    // 5. Carry the identity onto the keeper: keep its ITS, and remember the
    //    loser's address as secondary so oneAccess-by-email still finds it.
    const loserEmail = String(loser.email || "").toLowerCase();
    const survivorEmail = String(survivor.email || "").toLowerCase();
    const its = survivor.its_id || loser.its_id || null;
    const secondary = loserEmail && loserEmail !== survivorEmail && !loserEmail.endsWith("@oneaccess.local") ? loserEmail : null;
    await conn.execute(
      "UPDATE users SET its_id = COALESCE(its_id, ?), secondary_email = COALESCE(?, secondary_email) WHERE id = ?",
      [its, secondary, survivorId]);

    // 6. Deactivate the loser (reversible) + clear its ITS so it can never match again.
    await conn.execute("UPDATE users SET active = 0, merged_into = ?, deactivated_at = ?, its_id = NULL WHERE id = ?",
      [survivorId, Date.now(), loserId]);

    // 7. Audit.
    await conn.execute(
      "INSERT INTO user_merges (survivor_id, survivor_email, merged_id, merged_email, its_id, moved_json, performed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [survivorId, survivor.email, loserId, loser.email, its, JSON.stringify(moved), performedBy, Date.now()]);

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return { moved, survivor: await hydrateUser(await queryOne("SELECT * FROM users WHERE id = ?", [survivorId])) };
}

// ---------- admin: set/clear a user's ITS id ----------
// PUT /api/users/:id/its-id  body: { its }
// Sets the ITS; if that ITS already sits on another ACTIVE account, returns a
// merge preview so the UI can offer to reconcile them (no auto-merge).
router.put("/:id/its-id", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const its = req.body?.its == null ? "" : String(req.body.its).trim();
    const target = await queryOne("SELECT * FROM users WHERE id = ?", [req.params.id]);
    if (!target) return res.status(404).json({ error: "User not found" });
    await execute("UPDATE users SET its_id = ? WHERE id = ?", [its || null, req.params.id]);
    let collision = null;
    if (its) {
      const other = await queryOne(
        "SELECT * FROM users WHERE its_id = ? AND id <> ? AND active = 1 ORDER BY created_at ASC LIMIT 1",
        [its, req.params.id]);
      if (other) collision = await buildMergePreview({ ...target, its_id: its }, other);
    }
    res.json({ ok: true, its: its || null, collision });
  } catch (e) { next(e); }
});

// ---------- admin: change a user's email ----------
// PUT /api/users/:id/email  body: { email }
// Updates the account's primary email (used for sign-in + all notifications).
// Rejects an email already in use by another account.
router.put("/:id/email", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "A valid email is required" });
    const target = await queryOne("SELECT id FROM users WHERE id = ?", [req.params.id]);
    if (!target) return res.status(404).json({ error: "User not found" });
    const clash = await queryOne("SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ?", [email, req.params.id]);
    if (clash) return res.status(409).json({ error: "That email is already used by another account." });
    await execute("UPDATE users SET email = ? WHERE id = ?", [email, req.params.id]);
    const row = await queryOne("SELECT * FROM users WHERE id = ?", [req.params.id]);
    res.json({ user: await hydrateUser(row) });
  } catch (e) { next(e); }
});

// ---------- admin: change an existing user's role ----------
// Lets an admin promote/convert existing accounts (e.g. approver → executive, or
// any user → executive_assistant) without recreating them. History (requests,
// signature, sign-ins) is untouched. Safety rails:
//   - an admin cannot change their OWN role (prevents locking yourself out);
//   - leaving a signing role (approver/executive) clears signing authority;
//   - leaving executive / executive_assistant removes assistant links so no
//     stale delegation lingers.
router.put("/:id/role", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const role = String(req.body?.role || "").trim();
    if (!ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ error: "Invalid role" });
    if (req.params.id === req.user.id) return res.status(400).json({ error: "You can't change your own role" });
    const target = await queryOne("SELECT * FROM users WHERE id = ?", [req.params.id]);
    if (!target) return res.status(404).json({ error: "User not found" });
    if (target.role === role) return res.json({ user: await hydrateUser(target) });

    await execute("UPDATE users SET role = ? WHERE id = ?", [role, req.params.id]);

    // Cleanup that no longer applies under the new role.
    if (isSigner(target.role) && !isSigner(role)) {
      await execute("DELETE FROM signing_authority WHERE user_id = ?", [req.params.id]);
    }
    if (target.role === "executive" && role !== "executive") {
      await execute("DELETE FROM executive_assistants WHERE executive_id = ?", [req.params.id]);
    }
    if (target.role === "executive_assistant" && role !== "executive_assistant") {
      await execute("DELETE FROM executive_assistants WHERE assistant_id = ?", [req.params.id]);
    }

    const row = await queryOne("SELECT * FROM users WHERE id = ?", [req.params.id]);
    res.json({ user: await hydrateUser(row) });
  } catch (e) { next(e); }
});

// ---------- admin: list ITS-collision merge candidates ----------
// GET /api/users/merge-candidates → active account pairs that share an ITS.
router.get("/merge-candidates", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const rows = await query("SELECT * FROM users WHERE active = 1 AND its_id IS NOT NULL AND its_id <> '' ORDER BY its_id, created_at ASC");
    const byIts = new Map();
    for (const u of rows) { const k = u.its_id; if (!byIts.has(k)) byIts.set(k, []); byIts.get(k).push(u); }
    const candidates = [];
    for (const [its, group] of byIts) {
      if (group.length < 2) continue;
      for (let i = 1; i < group.length; i++) candidates.push({ its, ...(await buildMergePreview(group[0], group[i])) });
    }
    res.json({ candidates });
  } catch (e) { next(e); }
});

// ---------- admin: merge a duplicate into the keeper ----------
// POST /api/users/merge  body: { survivorId, loserId }
router.post("/merge", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const { survivorId, loserId } = req.body || {};
    if (!survivorId || !loserId) return res.status(400).json({ error: "survivorId and loserId are required" });
    if (survivorId === loserId) return res.status(400).json({ error: "Pick two different accounts" });
    if (loserId === req.user.id) return res.status(400).json({ error: "You can't deactivate your own account in a merge" });
    const result = await mergeUsers(survivorId, loserId, req.user.id);
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

// ---------- admin: reactivate a deactivated account (undo a merge's deactivation) ----------
// PUT /api/users/:id/reactivate — restores sign-in access; does NOT pull back
// already-migrated documents (those stay on the keeper).
router.put("/:id/reactivate", authRequired, requireRole("admin"), async (req, res, next) => {
  try {
    const u = await queryOne("SELECT id FROM users WHERE id = ?", [req.params.id]);
    if (!u) return res.status(404).json({ error: "User not found" });
    await execute("UPDATE users SET active = 1, merged_into = NULL, deactivated_at = NULL WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
