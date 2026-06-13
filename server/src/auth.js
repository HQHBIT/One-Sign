import jwt from "jsonwebtoken";
import { queryOne, hydrateUser } from "./db.js";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export function signToken(userId) {
  return jwt.sign({ sub: userId }, SECRET, { expiresIn: "30d" });
}

export async function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
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
