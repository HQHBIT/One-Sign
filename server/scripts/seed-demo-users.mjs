// Creates a documented set of dummy users for local testing of the
// multi-organisation setup, and removes any previous run first so nothing is
// left behind. Every row it touches is prefixed `demo_` / `@demo.local`.
//
//   node --env-file=.env scripts/seed-demo-users.mjs          create
//   node --env-file=.env scripts/seed-demo-users.mjs --purge  remove, create nothing
//
// Passwords are generated per run, never hard-coded, and printed once. This
// script is for LOCAL databases. Do not point it at production.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { initDb, execute, query } from "../src/db.js";

const purgeOnly = process.argv.includes("--purge");
await initDb();

// A guard, not a formality: this creates accounts with known credentials, which
// on a real database would be a live way in.
const dbName = (await query("SELECT DATABASE() AS d"))[0]?.d;
const host = process.env.DB_HOST || "localhost";
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  console.error(`\n  Refusing to run against a non-local database host: ${host}`);
  console.error("  This creates accounts with known passwords. Local use only.\n");
  process.exit(1);
}

// ---- remove anything a previous run left ----
const before = await query("SELECT id FROM users WHERE id LIKE 'demo\\_%'");
await query("DELETE FROM signing_authority WHERE user_id LIKE 'demo\\_%'");
await query("DELETE FROM users WHERE id LIKE 'demo\\_%'");
await query("DELETE FROM teams WHERE id LIKE 'demo\\_%'");
console.log(`\n  Removed ${before.length} previous demo user(s) from ${dbName}@${host}.`);

if (purgeOnly) {
  console.log("  --purge: nothing recreated.\n");
  process.exit(0);
}

// A password nobody can guess, different every run. Ambiguous characters are
// left out so it can be read off a screen and typed without confusion.
const pw = () => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const pick = n => Array.from(crypto.randomBytes(n)).map(b => abc[b % abc.length]).join("");
  return `${pick(4)}-${pick(4)}-${pick(4)}`;
};

const now = Date.now();
const teams = [
  ["demo_t_hqhb_it",    "IT",             "hqhb"],
  ["demo_t_hqhb_comms", "Communications", "hqhb"],
  ["demo_t_waqf_it",    "IT",             "waqf"],
  ["demo_t_waqf_comms", "Communications", "waqf"],
];
for (const [id, name, org] of teams) {
  await execute("INSERT INTO teams (id, name, org_id, created_at) VALUES (?, ?, ?, ?)", [id, name, org, now]);
}

const people = [
  ["demo_u_waqf_req", "waqf.requestor@demo.local", "Yusuf (WAQF requestor)", "requestor", "waqf", 0, "demo_t_waqf_it"],
  ["demo_u_waqf_app", "waqf.approver@demo.local",  "Fatema (WAQF approver)", "approver",  "waqf", 0, "demo_t_waqf_it"],
  ["demo_u_waqf_adm", "waqf.admin@demo.local",     "WAQF Admin",             "admin",     "waqf", 0, null],
  ["demo_u_hqhb_req", "hqhb.requestor@demo.local", "Hasan (HQHB requestor)", "requestor", "hqhb", 0, "demo_t_hqhb_it"],
  ["demo_u_hqhb_app", "hqhb.approver@demo.local",  "Zainab (HQHB approver)", "approver",  "hqhb", 0, "demo_t_hqhb_it"],
  ["demo_u_global",   "global.approver@demo.local","Idris (global approver)","approver",  "hqhb", 1, "demo_t_hqhb_comms"],
];

const issued = [];
for (const [id, email, name, role, org, isGlobal, team] of people) {
  const plain = pw();
  await execute(
    `INSERT INTO users (id, email, password_hash, name, role, org_id, is_global, team_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, email, bcrypt.hashSync(plain, 10), name, role, org, isGlobal, team, now]);
  issued.push({ org, role, isGlobal, email, plain });
}

for (const [u, t] of [
  ["demo_u_hqhb_app", "demo_t_hqhb_it"],
  ["demo_u_waqf_app", "demo_t_waqf_it"],
  ["demo_u_global",   "demo_t_hqhb_comms"],
  ["demo_u_global",   "demo_t_waqf_comms"],   // approval reach across the boundary
]) {
  await execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?, ?)", [u, t]);
}

console.log(`  Created ${issued.length} demo users in ${dbName}@${host}.\n`);
console.log("  ORG   ROLE       GLOBAL  EMAIL                          PASSWORD");
console.log("  " + "-".repeat(76));
for (const u of issued) {
  console.log("  " + u.org.padEnd(6) + u.role.padEnd(11) + (u.isGlobal ? "yes     " : "        ") +
    u.email.padEnd(31) + u.plain);
}
console.log("\n  Remove them again with:  node --env-file=.env scripts/seed-demo-users.mjs --purge\n");
process.exit(0);
