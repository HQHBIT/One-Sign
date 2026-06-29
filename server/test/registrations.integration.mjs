// Run against a RUNNING server (default :5001) + MySQL.
// Usage: node server/test/registrations.integration.mjs
// Mints an admin token from the DB (independent of the admin password) and
// cleans up its own rows.
import { config } from "dotenv";
config({ path: "server/.env" });
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";

const BASE = process.env.API_BASE || "http://localhost:5001";
const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const EMAIL = "reg.test." + Date.now() + "@hqhb.in";
const PW = "regtest123";

let fail = 0;
const check = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fail++; };
const j = async r => ({ status: r.status, body: await r.json().catch(() => ({})) });

const conn = await mysql.createConnection({ host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const [admins] = await conn.execute("SELECT id FROM users WHERE role='admin' ORDER BY created_at ASC LIMIT 1");
const token = jwt.sign({ sub: admins[0].id }, SECRET, { expiresIn: "1h" });
const auth = { Authorization: `Bearer ${token}` };

// 1) public register — valid
const reg = await j(await fetch(`${BASE}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Reg Test", email: EMAIL, password: PW, teamName: "QA", reportingManager: "Lead" }) }));
check("register valid -> 201", reg.status === 201);

// 2) duplicate pending -> 409
const dupReg = await j(await fetch(`${BASE}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Reg Test", email: EMAIL, password: PW }) }));
check("duplicate pending -> 409", dupReg.status === 409);

// 3) cannot log in yet (no user row)
const preLogin = await j(await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PW }) }));
check("login before approval -> 401", preLogin.status === 401);

// 4) admin sees it pending
const list = await j(await fetch(`${BASE}/api/registrations`, { headers: auth }));
const mine = (list.body.registrations || []).find(r => r.email === EMAIL);
check("admin list shows pending", list.status === 200 && mine && mine.status === "pending");

// 5) approve -> user created
const appr = await j(await fetch(`${BASE}/api/registrations/${mine.id}/approve`, { method: "POST", headers: auth }));
check("approve -> ok", appr.status === 200 && appr.body.ok === true);

// 6) now login works with the chosen password
const postLogin = await j(await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PW }) }));
check("login after approval -> token", postLogin.status === 200 && !!postLogin.body.token);

// cleanup
await conn.execute("DELETE FROM users WHERE LOWER(email) = LOWER(?)", [EMAIL]);
await conn.execute("DELETE FROM registrations WHERE LOWER(email) = LOWER(?)", [EMAIL]);
await conn.end();

console.log(fail ? `\n${fail} check(s) failed` : "\nAll registration checks passed");
process.exitCode = fail ? 1 : 0;
