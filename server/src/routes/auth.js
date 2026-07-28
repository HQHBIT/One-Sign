import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { queryOne, query, hydrateUser, execute } from "../db.js";
import { signToken, authRequired } from "../auth.js";
import { sendEmail } from "../email.js";
import { genTempPassword } from "./users.js";
import { validateRegistration } from "../registrationValidation.js";
import {
  oneAccessEnabled, localLoginEnabled, loginRedirectUrl,
  verifyOneAccessToken, fetchOneAccessProfile, toLocalIdentity,
} from "../oneaccess.js";

const router = Router();

// What the login screen should offer. Lets the client show the oneAccess button
// and hide the local form once the cutover flag is flipped — no redeploy needed.
router.get("/config", (req, res) => {
  res.json({
    oneAccessEnabled: oneAccessEnabled(),
    localLoginEnabled: localLoginEnabled(),
    oneAccessStartUrl: oneAccessEnabled() ? "/api/auth/oneaccess/start" : null,
  });
});

// Bounce the browser to the oneAccess login page (redirect=<slug>).
router.get("/oneaccess/start", (req, res) => {
  if (!oneAccessEnabled()) return res.status(404).json({ error: "oneAccess not configured" });
  res.redirect(loginRedirectUrl());
});

// SSO landing: oneAccess redirects the user back with ?token=<access_jwt>; the SPA
// posts it here. We verify it locally, mirror the user, and issue a SignFlow session.
router.post("/oneaccess/callback", async (req, res, next) => {
  try {
    if (!oneAccessEnabled()) return res.status(404).json({ error: "oneAccess not configured" });
    const token = String(req.body?.token || "").trim();
    if (!token) return res.status(400).json({ error: "Missing token" });

    let claims;
    try { claims = await verifyOneAccessToken(token); }
    catch { return res.status(401).json({ error: "Invalid or expired oneAccess token" }); }

    // Authoritative profile — best effort; fall back to the verified claims.
    let profile = null;
    try { profile = await fetchOneAccessProfile(token); } catch { /* use claims */ }

    const { its, email, emails, name, department, isAdmin, jamaat, jamiaat } = toLocalIdentity(claims, profile);
    if (!its && !email) return res.status(400).json({ error: "oneAccess profile missing its_id and email" });
    // One-time visibility into the real profile shape so field names can be verified.
    if (profile) console.log(`[oneaccess] profile keys: ${Object.keys(profile).join(", ")} | department: ${JSON.stringify(department)} | admin: ${isAdmin} | jamaat: ${JSON.stringify(jamaat)} | jamiaat: ${JSON.stringify(jamiaat)}`);

    const user = await upsertOneAccessUser({ its, email, emails, name, department, isAdmin, jamaat, jamiaat });
    // Admins never get a session via oneAccess — they must use the email/password
    // admin login. (Regular users continue normally.)
    if (user?.adminBlocked) {
      return res.status(403).json({ error: "Admin accounts sign in through the admin login (email and password), not oneAccess." });
    }
    const sfToken = signToken(user.id);
    res.json({ token: sfToken, user: await hydrateUser(user) });
  } catch (e) { next(e); }
});

// Normalise a department/team name for matching: lowercase, drop the generic
// words ("team", "department", …) and punctuation. So "IT" and "IT Team" both
// collapse to "it" and map to the same team.
const normDept = (s) => String(s || "").toLowerCase()
  .replace(/\b(team|teams|department|departments|dept\.?|division|unit|section)\b/g, " ")
  .replace(/[^a-z0-9]+/g, " ").trim();

// Resolve an oneAccess department string to a local team id. Matches an existing
// team by normalised name; if none matches, creates a team named after the
// department so an SSO user is never left without one.
export async function resolveTeamIdForDepartment(dept) {
  const raw = String(dept || "").trim();
  const target = normDept(raw);
  if (!target) return null;
  const teams = await query("SELECT id, name FROM teams");
  const match = teams.find((t) => normDept(t.name) === target);
  if (match) return match.id;
  const id = "t_oa_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await execute("INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)", [id, raw, Date.now()]);
  return id;
}

// Mirror an oneAccess identity into the local users table. Existing users are
// matched by ITS id, else email, kept in sync, and marked oneAccess-managed.
// Department is stored raw AND resolved to a team so an SSO-created user is mapped
// identically to a locally-onboarded one.
// ROLE RULE: oneAccess users are NEVER admins — admin access is email/password
// only. New SSO users default to requestor; a matched account keeps whatever role
// it already has; and if the matched account is an admin the login is REFUSED
// (returns { adminBlocked }) so no admin session is ever issued via oneAccess.
export async function upsertOneAccessUser({ its, email, emails, name, department, isAdmin = false, jamaat = "", jamiaat = "" }) {
  const dept = String(department || "").trim();
  // Emails to try when matching an existing account — the full oneAccess set if we
  // have it, else just the primary. Lets a login link to a local account even when
  // the primary oneAccess email differs from the work email on file.
  const matchEmails = [...new Set((Array.isArray(emails) && emails.length ? emails : [email]).map(e => String(e || "").trim().toLowerCase()).filter(Boolean))];
  const jam = String(jamaat || "").trim();
  const jamia = String(jamiaat || "").trim();
  const teamId = dept ? await resolveTeamIdForDepartment(dept) : null;
  // Match an existing ACTIVE account only — a deactivated (merged) duplicate must
  // never be re-adopted; its ITS was cleared on merge so the survivor wins the
  // its_id lookup. Email match also checks secondary_email so a login by the
  // person's oneAccess address resolves to the account it was merged into.
  let row = null;
  if (its) row = await queryOne("SELECT * FROM users WHERE its_id = ? AND active = 1", [its]);
  if (!row && matchEmails.length) {
    const ph = matchEmails.map(() => "?").join(",");
    row = await queryOne(
      `SELECT * FROM users WHERE active = 1 AND (LOWER(email) IN (${ph}) OR LOWER(secondary_email) IN (${ph})) ORDER BY created_at ASC LIMIT 1`,
      [...matchEmails, ...matchEmails]
    );
  }
  if (row) {
    // Admins never authenticate via oneAccess — leave the account untouched and
    // signal the callback to refuse. Admin access is email/password only.
    if (row.role === "admin") return { adminBlocked: true, email: row.email };
    // Preserve the existing PRIMARY email (e.g. @hqhb.in) as the account identity —
    // never let a differing oneAccess address (e.g. gmail) displace it. Keep that
    // address as secondary so a future login by it still resolves to this account.
    // Role is deliberately NOT touched here — oneAccess never changes it.
    const incoming = String(email || "").trim().toLowerCase();
    const primary = String(row.email || "").trim().toLowerCase();
    const secondary = incoming && incoming !== primary && !incoming.endsWith("@oneaccess.local") ? incoming : null;
    await execute(
      "UPDATE users SET name = ?, its_id = COALESCE(NULLIF(?, ''), its_id), department = COALESCE(NULLIF(?, ''), department), team_id = COALESCE(?, team_id), jamaat = COALESCE(NULLIF(?, ''), jamaat), jamiaat = COALESCE(NULLIF(?, ''), jamiaat), secondary_email = COALESCE(?, secondary_email), auth_provider = 'oneaccess' WHERE id = ?",
      [name, its, dept, teamId, jam, jamia, secondary, row.id]
    );
    return await queryOne("SELECT * FROM users WHERE id = ?", [row.id]);
  }
  const id = "u_oa_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  // Unusable local password — these users authenticate through oneAccess only.
  const randomHash = bcrypt.hashSync(crypto.randomUUID(), 10);
  const safeEmail = email || (its ? `${its}@oneaccess.local` : `${id}@oneaccess.local`);
  const role = "requestor"; // oneAccess users are never admins — admin access is email/password only
  await execute(
    "INSERT INTO users (id, email, password_hash, name, role, its_id, department, team_id, jamaat, jamiaat, auth_provider, work_email_set, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'oneaccess', 0, ?)",
    [id, safeEmail, randomHash, name, role, its || null, dept || null, teamId, jam || null, jamia || null, Date.now()]
  );
  return await queryOne("SELECT * FROM users WHERE id = ?", [id]);
}

router.post("/login", async (req, res, next) => {
  try {
    if (!localLoginEnabled()) {
      return res.status(403).json({ error: "Password sign-in is disabled. Please sign in with oneAccess." });
    }
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const row = await queryOne("SELECT * FROM users WHERE LOWER(email) = LOWER(?)", [email.trim()]);
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    // A deactivated (merged-away) account can't sign in — its identity now lives
    // on the surviving @hqhb.in account.
    if (row.active != null && Number(row.active) === 0) {
      return res.status(403).json({ error: "This account has been merged into your primary account. Please sign in there or via oneAccess." });
    }

    const token = signToken(row.id);
    res.json({ token, user: await hydrateUser(row) });
  } catch (e) { next(e); }
});

router.get("/me", authRequired, (req, res) => {
  res.json({ user: req.user });
});

// ---------- authenticated: email-notifications toggle ----------
// PUT /api/auth/me/email-notifications  body: { enabled }
// Off = no workflow emails (new request / approved / rejected / reminder); the
// in-app notifications still arrive. Credential emails always send regardless.
router.put("/me/email-notifications", authRequired, async (req, res, next) => {
  try {
    const enabled = req.body?.enabled === true || req.body?.enabled === "true";
    await execute("UPDATE users SET email_notifications = ? WHERE id = ?", [enabled ? 1 : 0, req.user.id]);
    const row = await queryOne("SELECT * FROM users WHERE id = ?", [req.user.id]);
    res.json({ user: await hydrateUser(row) });
  } catch (e) { next(e); }
});

// ---------- authenticated: set my work email (oneAccess first-run capture) ----------
// PUT /api/auth/me/work-email  body: { email }
// The work email becomes the account's PRIMARY address (used for every
// notification); the oneAccess sign-in email is kept as a secondary so future
// SSO logins still resolve here. Marks the account confirmed so the prompt won't
// show again. Rejects an email already used by a different account.
router.put("/me/work-email", authRequired, async (req, res, next) => {
  try {
    const workEmail = String(req.body?.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(workEmail)) return res.status(400).json({ error: "A valid email is required" });
    const me = await queryOne("SELECT * FROM users WHERE id = ?", [req.user.id]);
    if (!me) return res.status(404).json({ error: "User not found" });
    const currentPrimary = String(me.email || "").trim().toLowerCase();
    if (workEmail !== currentPrimary) {
      const clash = await queryOne("SELECT id FROM users WHERE LOWER(email) = ? AND id <> ?", [workEmail, me.id]);
      if (clash) return res.status(409).json({ error: "This email already has an account. Please contact IT to link them." });
      // Keep the previous (oneAccess) email as secondary for login matching, unless
      // it's just the synthetic @oneaccess.local placeholder.
      const secondary = currentPrimary && !currentPrimary.endsWith("@oneaccess.local") ? me.email : (me.secondary_email || null);
      await execute("UPDATE users SET email = ?, secondary_email = COALESCE(?, secondary_email), work_email_set = 1 WHERE id = ?", [workEmail, secondary, me.id]);
    } else {
      await execute("UPDATE users SET work_email_set = 1 WHERE id = ?", [me.id]);
    }
    const updated = await queryOne("SELECT * FROM users WHERE id = ?", [me.id]);
    res.json({ user: await hydrateUser(updated) });
  } catch (e) { next(e); }
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

// ---------- public: self-service password reset via email OTP ----------
// The user resets their OWN password with a one-time code emailed to them — no
// admin approval, and the code is never exposed to IT (redacted in the Email log).
//
// POST /api/auth/forgot-password/send-otp  body: { email }
// Emails a fresh 6-digit code (10-min expiry). Always returns ok — never reveals
// whether the email belongs to an account (anti-enumeration) — and won't resend
// within a 45s cooldown to avoid inbox spam.
router.post("/forgot-password/send-otp", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "A valid email is required" });
    const user = await queryOne("SELECT id, name, email, active FROM users WHERE LOWER(email) = ?", [email]);
    if (user && (user.active == null || Number(user.active) === 1)) {
      const now = Date.now();
      const recent = await queryOne("SELECT created_at FROM password_otps WHERE email = ? ORDER BY created_at DESC LIMIT 1", [email]);
      if (!recent || now - Number(recent.created_at) > 45000) {
        const code = String(crypto.randomInt(100000, 1000000)); // cryptographically-random 6 digits
        const hash = bcrypt.hashSync(code, 10);
        const id = "otp_" + now.toString(36) + "_" + Math.random().toString(36).slice(2, 7);
        await execute("DELETE FROM password_otps WHERE email = ?", [email]); // one live code per email
        await execute(
          "INSERT INTO password_otps (id, email, otp_hash, expires_at, attempts, used, created_at) VALUES (?, ?, ?, ?, 0, 0, ?)",
          [id, email, hash, now + 10 * 60 * 1000, now]
        );
        await sendEmail({ to: user.email, template: "password_otp", ctx: { name: user.name, otp: code, minutes: 10 } });
      }
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/auth/forgot-password/verify-otp  body: { email, otp, newPassword }
// Verifies the code and sets the new password immediately. The self-chosen password
// is NOT copied into the admin-visible last_temp_password — IT stays out of the loop.
router.post("/forgot-password/verify-otp", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.otp || "").trim();
    const newPassword = String(req.body?.newPassword || "");
    if (!email || !code) return res.status(400).json({ error: "Email and code are required" });
    if (newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });

    const row = await queryOne("SELECT * FROM password_otps WHERE email = ? AND used = 0 ORDER BY created_at DESC LIMIT 1", [email]);
    if (!row) return res.status(400).json({ error: "No active reset code. Please request a new one." });
    if (Date.now() > Number(row.expires_at)) {
      await execute("DELETE FROM password_otps WHERE id = ?", [row.id]);
      return res.status(400).json({ error: "This code has expired. Please request a new one." });
    }
    if (Number(row.attempts) >= 5) {
      await execute("DELETE FROM password_otps WHERE id = ?", [row.id]);
      return res.status(429).json({ error: "Too many incorrect attempts. Please request a new code." });
    }
    if (!bcrypt.compareSync(code, row.otp_hash)) {
      await execute("UPDATE password_otps SET attempts = attempts + 1 WHERE id = ?", [row.id]);
      return res.status(401).json({ error: "Incorrect code. Please try again." });
    }

    const user = await queryOne("SELECT id FROM users WHERE LOWER(email) = ?", [email]);
    if (!user) return res.status(404).json({ error: "Account not found" });
    const hash = bcrypt.hashSync(newPassword, 10);
    await execute("UPDATE users SET password_hash = ?, last_temp_password = NULL, last_temp_password_at = NULL WHERE id = ?", [hash, user.id]);
    await execute("DELETE FROM password_otps WHERE email = ?", [email]); // burn all codes for this email
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
