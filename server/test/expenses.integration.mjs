// End-to-end check against a RUNNING server (default :5001) + MySQL.
// Usage: node server/test/expenses.integration.mjs
// Mints an admin token straight from the DB (independent of the current admin
// password) and deletes its own test rows afterwards.
import { config } from "dotenv";
config({ path: "server/.env" });
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";

const BASE = process.env.API_BASE || "http://localhost:5001";
const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = "Integration Test (auto)";

let failures = 0;
const check = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) failures++; };
const j = async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
});

const [admins] = await conn.execute("SELECT id FROM users WHERE role='admin' ORDER BY created_at ASC LIMIT 1");
check("admin user exists in DB", admins.length > 0);
const token = admins.length ? jwt.sign({ sub: admins[0].id }, SECRET, { expiresIn: "1h" }) : "";
const auth = { Authorization: `Bearer ${token}` };

// 1) public POST — valid
const ok = await j(await fetch(`${BASE}/api/expenses`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ amount: 250.75, paidBy: TAG, date: "2026-06-16", repaymentDone: false, description: "Round-trip check" })
}));
check("public POST valid -> 201", ok.status === 201 && ok.body.ok === true);

// 2) public POST — invalid (amount 0)
const bad = await j(await fetch(`${BASE}/api/expenses`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ amount: 0, paidBy: "X", date: "2026-06-16" })
}));
check("public POST invalid -> 400", bad.status === 400);

// 3) GET without auth -> 401
check("GET without token -> 401", (await j(await fetch(`${BASE}/api/expenses`))).status === 401);

// 4) GET as admin -> our row present + numeric summary
const list = await j(await fetch(`${BASE}/api/expenses`, { headers: auth }));
const mine = (list.body.expenses || []).find(e => e.paidBy === TAG && e.amount === 250.75);
check("admin GET -> list + summary", list.status === 200 && !!mine && typeof list.body.summary.outstanding === "number");
check("description round-trips", mine?.description === "Round-trip check");

// 5) PATCH repayment -> flips
const patch = mine ? await j(await fetch(`${BASE}/api/expenses/${mine.id}/repayment`, {
  method: "PATCH", headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ done: true })
})) : { status: 0, body: {} };
check("PATCH repayment -> ok", patch.status === 200 && patch.body.ok === true);

// 6) flag persisted
const list2 = await j(await fetch(`${BASE}/api/expenses`, { headers: auth }));
const flipped = (list2.body.expenses || []).find(e => mine && e.id === mine.id);
check("repayment flag persisted", !!flipped && flipped.repaymentDone === true);

// cleanup
await conn.execute("DELETE FROM expenses WHERE paid_by = ?", [TAG]);
await conn.end();

console.log(failures ? `\n${failures} check(s) failed` : "\nAll integration checks passed");
// Set the exit code and let the event loop drain. Calling process.exit() here
// races the mysql2/undici socket close and trips a libuv teardown assertion on
// Windows; a natural exit avoids it.
process.exitCode = failures ? 1 : 0;
