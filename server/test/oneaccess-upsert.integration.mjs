// Verifies the oneAccess user mirror: a new SSO identity becomes a local requestor
// (matched later by ITS id, not duplicated). Local DB, no network. From repo root:
//   node server/test/oneaccess-upsert.integration.mjs
import { config } from "dotenv";
config({ path: "server/.env" });
const { initDb, queryOne, execute } = await import("../src/db.js");
const { upsertOneAccessUser } = await import("../src/routes/auth.js");

let fail = 0;
const check = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fail++; };

await initDb();

const its = "T" + String(Date.now()).slice(-7);
const email = "sso.new." + Date.now() + "@oneaccess.test";

const norm = (s) => String(s || "").toLowerCase().replace(/\b(team|department)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

const u1 = await upsertOneAccessUser({ its, email, name: "SSO New User", department: "IT" });
check("new SSO user is created", !!u1?.id);
check("role is requestor", u1.role === "requestor");
check("its_id is stored", u1.its_id === its);
check("auth_provider is oneaccess", u1.auth_provider === "oneaccess");
check("email is stored", (u1.email || "").toLowerCase() === email);
check("department stored raw", u1.department === "IT");
check("department resolved to a team", !!u1.team_id);
const t1 = await queryOne("SELECT name FROM teams WHERE id = ?", [u1.team_id]);
check("'IT' maps to the IT team (e.g. IT Team)", norm(t1?.name) === "it");

// Same person signs in again (matched by ITS id) — update, never duplicate.
const u2 = await upsertOneAccessUser({ its, email, name: "SSO Renamed" });
check("same row on second sign-in (no duplicate)", u2.id === u1.id);
check("name is kept in sync", u2.name === "SSO Renamed");
const c = await queryOne("SELECT COUNT(*) AS n FROM users WHERE its_id = ?", [its]);
check("exactly one row for the ITS id", Number(c.n) === 1);

// Match by email when ITS id is absent (adopts an existing local account).
const email2 = "sso.adopt." + Date.now() + "@oneaccess.test";
const seedId = "u_seed_" + Date.now().toString(36);
await execute("INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, 'x', 'Local Person', 'approver', ?)", [seedId, email2, Date.now()]);
const u3 = await upsertOneAccessUser({ its: "", email: email2, name: "Local Person" });
check("adopts existing local account by email (keeps its id + role)", u3.id === seedId && u3.role === "approver");
check("existing account is now oneaccess-managed", u3.auth_provider === "oneaccess");

// Unknown department → a team is created so the SSO user is never left unmapped.
const uniqDept = "QA-" + Date.now();
const its5 = "T" + String(Date.now()).slice(-6) + "9";
const u5 = await upsertOneAccessUser({ its: its5, email: "sso.qa." + Date.now() + "@oneaccess.test", name: "QA Person", department: uniqDept });
check("unknown department creates + assigns a new team", !!u5.team_id);
const t5 = await queryOne("SELECT name FROM teams WHERE id = ?", [u5.team_id]);
check("new team is named after the department", t5?.name === uniqDept);

// cleanup
await execute("DELETE FROM users WHERE its_id IN (?, ?) OR id = ?", [its, its5, seedId]);
await execute("DELETE FROM teams WHERE id = ?", [u5.team_id]);
console.log(fail ? `\n${fail} check(s) failed` : "\nAll oneAccess upsert checks passed");
process.exit(fail ? 1 : 0);
