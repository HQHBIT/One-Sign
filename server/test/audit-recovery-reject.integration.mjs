// Two rules from the 2026-09 security audit:
//
//   1. POST /api/auth/forgot-password must not touch a credential. It starts the
//      mailed-code flow; the password changes only in /verify-otp, after proof.
//   2. POST /api/requests/:id/reject is for a party to the CURRENT stage. Holding
//      signing authority on a workflow's first-step team does not make someone a
//      party to step 2, nor to the withdraw window after everyone has signed.
//
//   node test/audit-recovery-reject.integration.mjs      (from server/, MySQL running)
//
// Starts its own API on a spare port with email and storage off. Requests are
// inserted directly: what is under test is authority, not the request lifecycle.
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..");
config({ path: path.join(SERVER, ".env") });

const PORT = 5000 + 90 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;

const { initDb, execute, queryOne } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
await initDb();

const api = spawn(process.execPath, ["src/index.js"], {
  cwd: SERVER,
  env: { ...process.env, PORT: String(PORT), SENDGRID_API_KEY: "", STORAGE_BUCKET: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
api.stdout.on("data", (d) => { log += d; });
api.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 180; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
  if (i === 179) { console.log(log); throw new Error("API did not start"); }
}

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);
const T = Date.now().toString(36);
const now = Date.now();
// people
const REQ = `u_ar_req_${T}`, S1 = `u_ar_s1_${T}`, S2 = `u_ar_s2_${T}`, AUTH1 = `u_ar_auth1_${T}`, LEGACY_APP = `u_ar_lapp_${T}`;
const T1 = `t_ar_1_${T}`, T2 = `t_ar_2_${T}`;
// requests
const WF_STEP2 = `req_ar_wf2_${T}`, WF_DONE = `req_ar_wfd_${T}`, LEGACY = `req_ar_leg_${T}`;
const EMAIL = `${REQ}@audit.test`;
const KNOWN_HASH = bcrypt.hashSync("Known@Password1", 4);

const headers = (id) => ({ Authorization: "Bearer " + signToken(id), "Content-Type": "application/json" });
const reject = (who, id) => fetch(`${BASE}/api/requests/${id}/reject`, { method: "POST", headers: headers(who), body: JSON.stringify({ reason: "no" }) });
const status = async (id) => (await queryOne("SELECT status FROM requests WHERE id = ?", [id]))?.status;

const cleanup = async () => {
  await execute("DELETE FROM request_step_signers WHERE step_id IN (SELECT id FROM request_steps WHERE request_id IN (?, ?, ?))", [WF_STEP2, WF_DONE, LEGACY]);
  await execute("DELETE FROM request_steps WHERE request_id IN (?, ?, ?)", [WF_STEP2, WF_DONE, LEGACY]);
  await execute("DELETE FROM requests WHERE id IN (?, ?, ?)", [WF_STEP2, WF_DONE, LEGACY]);
  await execute("DELETE FROM signing_authority WHERE user_id IN (?, ?, ?, ?)", [S1, S2, AUTH1, LEGACY_APP]);
  await execute("DELETE FROM password_otps WHERE email = ?", [EMAIL]);
  await execute("DELETE FROM users WHERE id IN (?, ?, ?, ?, ?)", [REQ, S1, S2, AUTH1, LEGACY_APP]);
  await execute("DELETE FROM teams WHERE id IN (?, ?)", [T1, T2]);
};

// A workflow request: step 1 on T1 (signer S1), step 2 on T2 (signer S2).
async function workflowRequest(id, { step1, step2, status: st, approver = null }) {
  await execute(
    `INSERT INTO requests (id, requestor_id, file_name, file_path, file_type, target_team_id, marker_json, note, status, created_at, approver_id, approved_at, current_step)
     VALUES (?, ?, ?, ?, 'pdf', ?, NULL, '', ?, ?, ?, ?, 2)`,
    [id, REQ, `${id}.pdf`, `${id}.pdf`, T1, st, now, approver, approver ? now : null]);
  await execute("INSERT INTO request_steps (id, request_id, step_order, team_id, status, created_at) VALUES (?, ?, 1, ?, ?, ?)", [`${id}_st1`, id, T1, step1, now]);
  await execute("INSERT INTO request_steps (id, request_id, step_order, team_id, status, created_at) VALUES (?, ?, 2, ?, ?, ?)", [`${id}_st2`, id, T2, step2, now]);
  await execute("INSERT INTO request_step_signers (id, step_id, signer_order, user_id, page, marker_x, marker_y, marker_w, marker_h, status, signed_at) VALUES (?, ?, 1, ?, 1, 1, 1, 1, 1, 'signed', ?)", [`${id}_sg1`, `${id}_st1`, S1, now]);
  await execute("INSERT INTO request_step_signers (id, step_id, signer_order, user_id, page, marker_x, marker_y, marker_w, marker_h, status) VALUES (?, ?, 1, ?, 1, 1, 1, 1, 1, ?)", [`${id}_sg2`, `${id}_st2`, S2, step2 === "done" ? "signed" : "pending"]);
}

try {
  await cleanup();
  for (const [id, name] of [[T1, "Audit Team One"], [T2, "Audit Team Two"]]) await execute("INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)", [id, `${name} ${T}`, now]);
  for (const [id, role, name] of [[REQ, "requestor", "Audit Requestor"], [S1, "approver", "Step One Signer"], [S2, "approver", "Step Two Signer"], [AUTH1, "approver", "Team One Authority"], [LEGACY_APP, "approver", "Legacy Approver"]]) {
    await execute("INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, active) VALUES (?, ?, ?, ?, ?, NULL, ?, 1)",
      [id, `${id}@audit.test`, id === REQ ? KNOWN_HASH : bcrypt.hashSync("x", 4), name, role, now]);
  }
  await execute("UPDATE users SET last_temp_password = NULL, last_temp_password_at = NULL WHERE id = ?", [REQ]);
  // AUTH1 signs for team one but is named on no step; LEGACY_APP signs for team one too.
  for (const u of [S1, AUTH1, LEGACY_APP]) await execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?, ?)", [u, T1]);
  await execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?, ?)", [S2, T2]);

  // ---------------- 1. forgot-password never rotates a credential ----------------
  let r = await fetch(`${BASE}/api/auth/forgot-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL }) });
  let b = await r.json();
  let u = await queryOne("SELECT password_hash, last_temp_password FROM users WHERE id = ?", [REQ]);
  ck(r.status === 200 && b.ok === true, `forgot-password answers ok (${r.status})`);
  ck(u.password_hash === KNOWN_HASH, "the existing password is left alone");
  ck(u.last_temp_password == null, "and no plaintext temp password is written");
  const otp = await queryOne("SELECT id FROM password_otps WHERE email = ?", [EMAIL]);
  ck(!!otp, "instead a mailed code is started (password_otps row)");
  r = await fetch(`${BASE}/api/auth/forgot-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `nobody_${T}@audit.test` }) });
  b = await r.json();
  ck(r.status === 200 && b.ok === true, "an unknown address gets the same answer (no enumeration)");
  r = await fetch(`${BASE}/api/auth/forgot-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "not-an-email" }) });
  ck(r.status === 400, "a malformed address is refused");

  // ---------------- 2. reject authority is bound to the current stage ----------------
  await workflowRequest(WF_STEP2, { step1: "done", step2: "active", status: "pending" });
  r = await reject(AUTH1, WF_STEP2);
  ck(r.status === 403, `first-step team authority cannot reject at step 2 (${r.status})`);
  ck((await status(WF_STEP2)) === "pending", "and the request is untouched");
  r = await reject(S1, WF_STEP2);
  ck(r.status === 403, `a signer who already signed step 1 cannot reject step 2 (${r.status})`);
  r = await reject(S2, WF_STEP2);
  ck(r.status === 200 && (await status(WF_STEP2)) === "rejected", `the signer whose turn it is can reject (${r.status})`);

  await workflowRequest(WF_DONE, { step1: "done", step2: "done", status: "approved_pending", approver: S2 });
  r = await reject(AUTH1, WF_DONE);
  ck(r.status === 403, `first-step team authority cannot reject a fully-signed request in the withdraw window (${r.status})`);
  ck((await status(WF_DONE)) === "approved_pending", "and the signed document is kept");
  r = await reject(S2, WF_DONE);
  ck(r.status === 200 && (await status(WF_DONE)) === "rejected", `the recorded approver still can (${r.status})`);

  // A legacy single-team request keeps its team-authority rule while pending.
  await execute(
    `INSERT INTO requests (id, requestor_id, file_name, file_path, file_type, target_team_id, marker_json, note, status, created_at)
     VALUES (?, ?, ?, ?, 'pdf', ?, '[{"page":1,"x":1,"y":1,"w":1,"h":1}]', '', 'pending', ?)`,
    [LEGACY, REQ, `${LEGACY}.pdf`, `${LEGACY}.pdf`, T1, now]);
  r = await reject(S2, LEGACY);
  ck(r.status === 403, `no authority on the legacy request's team → refused (${r.status})`);
  r = await reject(LEGACY_APP, LEGACY);
  ck(r.status === 200 && (await status(LEGACY)) === "rejected", `team signing authority still rejects a legacy single-team request (${r.status})`);
} catch (e) {
  fail.push(`the run stopped early: ${e?.message || e}`);
} finally {
  for (const p of pass) console.log("  PASS  " + p);
  for (const f of fail) console.log("  FAIL  " + f);
  await cleanup().catch((e) => console.log("cleanup:", e.message));
  api.kill();
  console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
  if (fail.length) console.log(log.split("\n").filter((l) => /error/i.test(l)).slice(-10).join("\n"));
  process.exit(fail.length ? 1 : 0);
}
