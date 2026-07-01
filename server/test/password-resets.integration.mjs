// Run against a RUNNING server (default :5001) + MySQL.
// Usage: node server/test/password-resets.integration.mjs
import { config } from "dotenv";
config({ path: "server/.env" });
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

const BASE = process.env.API_BASE || "http://localhost:5001";
const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TS = Date.now();
const UID = "u_pwreset_" + TS.toString(36);
const EMAIL = "pwreset.test." + TS + "@hqhb.in";
const OLD_PW = "OldPass123";
const NEW_PW = "NewPass456";

let fail = 0;
const check = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fail++; };
const j = async r => ({ status: r.status, body: await r.json().catch(() => ({})) });
const login = (email, password) => fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });

const conn = await mysql.createConnection({ host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const [admins] = await conn.execute("SELECT id FROM users WHERE role='admin' ORDER BY created_at ASC LIMIT 1");
const auth = { Authorization: `Bearer ${jwt.sign({ sub: admins[0].id }, SECRET, { expiresIn: "1h" })}` };

// temp user with a known OLD password
await conn.execute(
  "INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, 'PW Reset Test', 'requestor', ?)",
  [UID, EMAIL, bcrypt.hashSync(OLD_PW, 10), TS]
);

// 1) request reset -> ok
const rr = await j(await fetch(`${BASE}/api/auth/request-reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, newPassword: NEW_PW }) }));
check("request-reset -> 200 ok", rr.status === 200 && rr.body.ok === true);

// 2) admin sees it pending, with the chosen password visible
const list = await j(await fetch(`${BASE}/api/password-resets`, { headers: auth }));
const mine = (list.body.resets || []).find(r => r.email === EMAIL);
check("admin sees pending reset (password visible)", list.status === 200 && mine && mine.status === "pending" && mine.newPassword === NEW_PW);

// 3) not applied yet: new password fails, old still works
check("new password rejected before approval", (await login(EMAIL, NEW_PW)).status === 401);
check("old password still works before approval", (await login(EMAIL, OLD_PW)).status === 200);

// 4) approve
const appr = await j(await fetch(`${BASE}/api/password-resets/${mine?.id}/approve`, { method: "POST", headers: auth }));
check("approve -> ok", appr.status === 200 && appr.body.ok === true);

// 5) now new password works, old no longer does
const postNew = await j(await login(EMAIL, NEW_PW));
check("new password works after approval", postNew.status === 200 && !!postNew.body.token);
check("old password no longer works", (await login(EMAIL, OLD_PW)).status === 401);

// cleanup
await conn.execute("DELETE FROM password_resets WHERE email = ?", [EMAIL]);
await conn.execute("DELETE FROM users WHERE id = ?", [UID]);
await conn.end();

console.log(fail ? `\n${fail} check(s) failed` : "\nAll password-reset checks passed");
process.exitCode = fail ? 1 : 0;
