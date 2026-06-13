import jwt from "jsonwebtoken";
import { queryOne, hydrateUser } from "./db.js";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const COOKIE_NAME = "sf_session";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

export function signToken(userId) {
  return jwt.sign({ sub: userId }, SECRET, { expiresIn: "30d" });
}

/** Attach a session cookie to the response. Used at login. */
export function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE,
    path: "/"
  });
}

/** Clear the session cookie. Used at logout. */
export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export async function authRequired(req, res, next) {
  // Prefer the httpOnly cookie; fall back to Bearer header for backwards compat
  // (e.g. existing browser sessions whose localStorage token hasn't expired).
  let token = req.cookies?.[COOKIE_NAME] || null;
  if (!token) {
    const header = req.headers.authorization || "";
    token = header.startsWith("Bearer ") ? header.slice(7) : null;
  }
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    const payload = jwt.verify(token, SECRET);
    const row = await queryOne("SELECT * FROM users WHERE id = ?", [payload.sub]);
    if (!row) return res.status(401).json({ error: "User not found" });
    req.user = await hydrateUser(row);
    req.userRow = row;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}
