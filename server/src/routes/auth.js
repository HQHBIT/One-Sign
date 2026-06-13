import { Router } from "express";
import bcrypt from "bcryptjs";
import { queryOne, hydrateUser, execute } from "../db.js";
import { signToken, authRequired } from "../auth.js";
import { sendEmail } from "../email.js";
import { genTempPassword } from "./users.js";

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
      await execute("UPDATE users SET password_hash = ? WHERE id = ?", [hash, row.id]);
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

export default router;
