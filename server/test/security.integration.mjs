// ============================================================
//   Security hardening — regression guard for the 2026-08-12 pentest findings.
//   Needs the API on :5001.  Run: node server/test/security.integration.mjs
// ============================================================
import { config } from "dotenv"; config({ path: "server/.env" });
import bcrypt from "bcryptjs";
const { initDb, queryOne, execute } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
await initDb();

const B = "http://127.0.0.1:5001";
const fail = []; const ck = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fail.push(m); };
const J = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})), headers: r.headers });

await execute("DELETE FROM users WHERE id IN ('u_sec_r','u_sec_adm')");
await execute("DELETE FROM registrations WHERE email='sec-massassign@hqhb.in'");
const now = Date.now();
await execute("INSERT INTO users (id,email,password_hash,name,role,created_at,active) VALUES ('u_sec_r','u_sec_r@hqhb.in',?,'Sec Req','requestor',?,1)", [bcrypt.hashSync("x", 4), now]);
await execute("INSERT INTO users (id,email,password_hash,name,role,created_at,active) VALUES ('u_sec_adm','u_sec_adm@hqhb.in',?,'Sec Admin','admin',?,1)", [bcrypt.hashSync("x", 4), now]);

// ---------- HIGH-002: object email is a clean 400, not a 500 leak ----------
let r = await J(await fetch(B + "/api/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: { $gt: "" }, password: { $gt: "" } }) }));
ck(r.status === 400, "object-typed email is a clean 400, not a 500 (" + r.status + ")");
ck(!/trim is not a function|undefined|SQL|Bind/i.test(r.body.error || ""),
   "*** the error text leaks no internals *** (" + r.body.error + ")");

// ---------- generic 500 body: no raw library text ----------
// A wrong-typed body to a JSON route shouldn't echo a stack/library string.
r = await J(await fetch(B + "/api/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: 123, password: 456 }) }));
ck(r.status === 400 && !/function|undefined/i.test(r.body.error || ""), "numeric input also refused cleanly");

// ---------- MEDIUM-002: login is rate limited ----------
let limited = false, lastStatus = 0;
for (let i = 0; i < 14; i++) {
  const rr = await fetch(B + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "ratelimit-probe@hqhb.in", password: "nope" + i }) });
  lastStatus = rr.status;
  if (rr.status === 429) { limited = true; break; }
}
ck(limited && lastStatus === 429, "login throttles after repeated failures (429)");

// ---------- MEDIUM-004: register never grants a role; creates a PENDING record ----------
r = await J(await fetch(B + "/api/auth/register", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "sec-massassign@hqhb.in", password: "Test@123", name: "Mass Assign", role: "admin", superadmin: true }) }));
ck(r.status === 201, "register returns 201");
const reg = await queryOne("SELECT status FROM registrations WHERE email='sec-massassign@hqhb.in'");
const asUser = await queryOne("SELECT id FROM users WHERE email='sec-massassign@hqhb.in'");
ck(!!reg && reg.status === "pending", "*** register creates a PENDING record, not an active account ***");
ck(!asUser, "*** no user row exists — role=admin was ignored entirely ***");
await execute("DELETE FROM registrations WHERE email='sec-massassign@hqhb.in'");

// ---------- MEDIUM-001: /api/teams leaks no role to a non-admin ----------
r = await J(await fetch(B + "/api/teams", { headers: { Authorization: "Bearer " + signToken("u_sec_r") } }));
const anySigner = (r.body.teams || []).flatMap(t => [...(t.approvers || []), ...(t.members || []), ...(t.signers || [])])[0];
ck(r.status === 200, "teams list loads for a requestor");
if (anySigner) {
  ck(!("role" in anySigner), "*** a requestor sees NO role field on directory entries ***");
  ck(!("its" in anySigner) && !("itsId" in anySigner), "…and no ITS id (never was in this payload)");
}
r = await J(await fetch(B + "/api/teams", { headers: { Authorization: "Bearer " + signToken("u_sec_adm") } }));
const adminSigner = (r.body.teams || []).flatMap(t => [...(t.approvers || []), ...(t.members || [])])[0];
if (adminSigner) ck("role" in adminSigner, "an admin still receives role (they run the Teams page)");

// ---------- LOW-003 / LOW-004: headers ----------
r = await fetch(B + "/api/health");
ck(!r.headers.get("x-powered-by"), "x-powered-by is not advertised");
ck(r.headers.get("x-content-type-options") === "nosniff", "X-Content-Type-Options: nosniff");
ck(r.headers.get("x-frame-options") === "DENY", "X-Frame-Options: DENY");
ck((r.headers.get("strict-transport-security") || "").includes("max-age="), "HSTS present");

// ---------- reject-voice IDOR: participants only, others get 404 ----------
{
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await execute("DELETE FROM requests WHERE id = 'r_sec_voice'");
  await execute("DELETE FROM users WHERE id = 'u_sec_stranger'");
  await execute("INSERT INTO users (id,email,password_hash,name,role,created_at,active) VALUES ('u_sec_stranger','u_sec_stranger@hqhb.in',?,'Sec Stranger','approver',?,1)", [bcrypt.hashSync("x", 4), now]);
  const cols = await queryOne("SHOW COLUMNS FROM requests WHERE Field = 'file_type'").catch(() => null);
  await execute(
    `INSERT INTO requests (id, requestor_id, approver_id, file_name, file_path, ${cols ? "file_type, " : ""}status, created_at, rejected_at, reject_reason, reject_voice_path)
     VALUES ('r_sec_voice','u_sec_r','u_sec_adm','v.pdf','v.pdf',${cols ? "'pdf'," : ""}'rejected',?,?,'no','sec-voice.webm')`, [now, now]);
  const vdir = path.join("server", "uploads", "voicenotes");
  await fs.mkdir(vdir, { recursive: true });
  await fs.writeFile(path.join(vdir, "sec-voice.webm"), Buffer.from("webm"));

  let rr = await fetch(B + "/api/requests/r_sec_voice/reject-voice", { headers: { Authorization: "Bearer " + signToken("u_sec_stranger") } });
  ck(rr.status === 404, "*** a non-participant CANNOT play a rejection voice note (404, same as nonexistent) ***");
  rr = await fetch(B + "/api/requests/r_sec_voice/reject-voice", { headers: { Authorization: "Bearer " + signToken("u_sec_r") } });
  ck(rr.status === 200, "…the requestor still can (200)");
  rr = await fetch(B + "/api/requests/nope/reject-voice", { headers: { Authorization: "Bearer " + signToken("u_sec_stranger") } });
  ck(rr.status === 404, "…and a nonexistent id looks identical (no probing oracle)");

  await execute("DELETE FROM requests WHERE id = 'r_sec_voice'");
  await execute("DELETE FROM users WHERE id = 'u_sec_stranger'");
  await fs.unlink(path.join(vdir, "sec-voice.webm")).catch(() => {});
}

// ---------- LOW-002: CORS never echoes an arbitrary/internal origin ----------
r = await fetch(B + "/api/health", { headers: { Origin: "http://65.1.2.157:3101" } });
const acao = r.headers.get("access-control-allow-origin") || "";
ck(acao !== "http://65.1.2.157:3101", "an unknown origin is NOT reflected in CORS (" + (acao || "none") + ")");

console.log(fail.length ? `\n${fail.length} check(s) failed` : "\nSECURITY HARDENING E2E PASSED");
await execute("DELETE FROM users WHERE id IN ('u_sec_r','u_sec_adm')");
process.exit(fail.length ? 1 : 0);
