import { Router } from "express";
import bcrypt from "bcryptjs";
import { queryOne, hydrateUser } from "../db.js";
import { signToken, authRequired, setSessionCookie, clearSessionCookie } from "../auth.js";

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
    setSessionCookie(res, token);
    // Token is still returned in the body so existing clients keep working,
    // but new clients no longer need to read or store it — the cookie is
    // sent automatically.
    res.json({ token, user: await hydrateUser(row) });
  } catch (e) { next(e); }
});

router.post("/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", authRequired, (req, res) => {
  res.json({ user: req.user });
});

export default router;
