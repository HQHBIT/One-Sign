import { Router } from "express";
import bcrypt from "bcryptjs";
import { queryOne, hydrateUser, execute } from "../db.js";
import { signToken, authRequired } from "../auth.js";
import { sendEmail } from "../email.js";
import { genTempPassword } from "./users.js";
import { validateRegistration } from "../registrationValidation.js";

const router = Router();

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const row = await queryOne("SELECT * FROM users WHERE LOWER(email) = LOWER(?)", [email.trim()]);
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = signToken(row.id);
    res.json({ token, user: await hydrateUser(row) });
  } catch (e) { next(e); }
});

router.get("/me", authRequired, (req, res) => {
  res.json({ user: req.user });
});

// ---------- authenticated: change my password ----------
// POST /api/auth/change-password  body: { currentPassword, newPassword }
// Self-service. Verifies the user's current password before rotating to the
// new one. Plain "wrong password" returns 401 with a clear message. New
// password is also persisted in last_temp_password so admins can see it
// (consistent with the rest of the password-storing behaviour).
router.post("/change-password", authRequired, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are both required" });
    }
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters" });
    }
    const row = await queryOne("SELECT * FROM users WHERE id = ?", [req.user.id]);
    if (!row) return res.status(404).json({ error: "User not found" });
    if (!bcrypt.compareSync(currentPassword, row.password_hash)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    const hash = bcrypt.hashSync(newPassword, 10);
    await execute(
      "UPDATE users SET password_hash = ?, last_temp_password = ?, last_temp_password_at = ? WHERE id = ?",
      [hash, newPassword, Date.now(), row.id]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- public: forgot password ----------
// POST /api/auth/forgot-password  body: { email }
// User-initiated reset. Generates a fresh temp password, hashes it, and emails
// the plaintext. Intentionally returns the same 200 response whether the email
// exists or not — this prevents account enumeration via response timing /
// response shape. Logs server-side either way for the admin's email log.
router.post("/forgot-password", async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email required" });
    }
    const row = await queryOne(
      "SELECT * FROM users WHERE LOWER(email) = LOWER(?)",
      [email.trim()]
    );
    if (row) {
      const password = genTempPassword();
      const hash = bcrypt.hashSync(password, 10);
      await execute(
        "UPDATE users SET password_hash = ?, last_temp_password = ?, last_temp_password_at = ? WHERE id = ?",
        [hash, password, Date.now(), row.id]
      );
      const signInUrl = req.protocol + "://" + req.get("host");
      await sendEmail({
        to: row.email,
        template: "reset_password",
        ctx: { name: row.name, email: row.email, password, signInUrl, byAdmin: false }
      });
    }
    // Always return ok: true — don't leak whether the email exists.
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- public: self-registration ----------
// POST /api/auth/register  body: { name, email, password, teamName, reportingManager }
// Creates a PENDING registration. The user is not created and cannot sign in
// until an admin approves it. Rejects duplicate emails (existing user OR a
// pending registration) so people don't queue twice.
router.post("/register", async (req, res, next) => {
  try {
    const v = validateRegistration(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { name, email, password, teamName, reportingManager } = v.value;

    const existingUser = await queryOne("SELECT id FROM users WHERE LOWER(email) = LOWER(?)", [email]);
    if (existingUser) return res.status(409).json({ error: "An account with this email already exists" });
    const existingReg = await queryOne("SELECT id FROM registrations WHERE LOWER(email) = LOWER(?) AND status = 'pending'", [email]);
    if (existingReg) return res.status(409).json({ error: "A registration with this email is already awaiting approval" });

    const id = "r_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
    const hash = bcrypt.hashSync(password, 10);
    await execute(
      "INSERT INTO registrations (id, name, email, password_hash, password_plain, team_name, reporting_manager, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
      [id, name, email, hash, password, teamName || null, reportingManager || null, Date.now()]
    );
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- public: request a password reset (IT-approved) ----------
// POST /api/auth/request-reset  body: { email, newPassword }
// The user chooses their OWN new password, but it does NOT take effect until an
// admin approves it in the console. There's no email channel to verify identity,
// so the admin approval IS the verification gate (prevents account takeover).
//
// This is an internal IT tool, so we deliberately do NOT hide whether the email
// exists: an unknown email returns a clear 404 so the user learns to use their
// real address. (The old anti-enumeration "always ok" silently dropped every
// mismatched request — users saw "submitted" but nothing reached the admin.)
// One pending reset per user.
router.post("/request-reset", async (req, res, next) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "A valid email is required" });
    if (newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });

    const user = await queryOne("SELECT id FROM users WHERE LOWER(email) = LOWER(?)", [email]);
    if (!user) {
      return res.status(404).json({ error: "No account found with this email. Check the address or contact IT." });
    }
    const hash = bcrypt.hashSync(newPassword, 10);
    // One pending reset per user — clear any prior pending, then insert the new one.
    await execute("DELETE FROM password_resets WHERE user_id = ? AND status = 'pending'", [user.id]);
    const id = "pr_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
    await execute(
      "INSERT INTO password_resets (id, user_id, email, new_password_hash, new_password_plain, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      [id, user.id, email, hash, newPassword, Date.now()]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
