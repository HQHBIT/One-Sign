// "Send for Shz Saab Approval" — the WAQF HOD tracking board.
//
//   node test/shz-forward.integration.mjs      (from server/, MySQL running)
//
// Verifies: the feature is WAQF-only (404 on an HQHB box); a requestor can
// forward only their OWN fully-signed document; one forward per document; the
// HOD (anyone on the "HOD" team) sees the forwards and a non-HOD does not;
// hydrateUser marks the HOD. Spawns its own APIs on spare ports.
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..");
config({ path: path.join(SERVER, ".env") });

const PORT = 5000 + 150 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;
const HQHB_PORT = PORT + 5;
const HQHB_BASE = `http://127.0.0.1:${HQHB_PORT}`;
const { initDb, execute, query } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
await initDb();

function startApi(port, env) {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: SERVER, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), SENDGRID_API_KEY: "", STORAGE_BUCKET: "", ...env },
  });
  child.log = ""; child.stdout.on("data", d => (child.log += d)); child.stderr.on("data", d => (child.log += d));
  return child;
}
async function waitFor(base, child) {
  for (let i = 0; i < 180; i++) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {} await new Promise(r => setTimeout(r, 500)); }
  console.log(child.log); throw new Error("API did not start on " + base);
}

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);
const T = Date.now().toString(36), now = Date.now();
let TEAM = `t_hod_${T}`, createdTeam = false;
const HOD = `u_hod_${T}`, REQ = `u_req_${T}`, OTHER = `u_oth_${T}`;
// 2026-11-25: signers see what they signed; authority holders what went to their team.
const SIGNER = `u_sig_${T}`, AUTH = `u_aut_${T}`, TEAM2 = `t_shzsig_${T}`;
const RID = `req_shz_${T}`, RID2 = `req_shz2_${T}`;
const hdr = (id) => ({ Authorization: "Bearer " + signToken(id), "Content-Type": "application/json" });
const j = async r => { try { return await r.json(); } catch { return {}; } };

const cleanup = async () => {
  await execute("DELETE FROM shz_forwards WHERE org_id = 'waqf' AND request_id IN (?, ?)", [RID, RID2]).catch(() => {});
  await execute("DELETE FROM requests WHERE id IN (?, ?)", [RID, RID2]).catch(() => {});
  await execute("DELETE FROM signing_authority WHERE user_id IN (?, ?, ?, ?, ?)", [HOD, REQ, OTHER, SIGNER, AUTH]).catch(() => {});
  await execute("DELETE FROM users WHERE id IN (?, ?, ?, ?, ?)", [HOD, REQ, OTHER, SIGNER, AUTH]).catch(() => {});
  await execute("DELETE FROM teams WHERE id = ?", [TEAM2]).catch(() => {});
  if (createdTeam) await execute("DELETE FROM teams WHERE id = ?", [TEAM]).catch(() => {});
};

let waqf = null, hqhb = null;
try {
  await cleanup();
  // A WAQF "HOD" team; Mukarram is its approver (so he is the HOD).
  // Reuse this database's WAQF "HOD" team if it has one (names are unique per
  // organisation, and the app treats the first as THE HOD team).
  const existingHod = (await query("SELECT id FROM teams WHERE org_id = 'waqf' AND LOWER(name) = 'hod' LIMIT 1"))[0];
  if (existingHod) TEAM = existingHod.id;
  else { createdTeam = true; await execute("INSERT INTO teams (id, name, created_at, org_id) VALUES (?, 'HOD', ?, 'waqf')", [TEAM, now]); }
  await execute("INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, active, org_id) VALUES (?,?,?,?,?,?,?,1,'waqf')",
    [HOD, `hod.${T}@waqf.test`, bcrypt.hashSync("x", 4), "Mukarram (HOD)", "approver", null, now]);
  await execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?, ?)", [HOD, TEAM]);
  await execute("INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, active, org_id) VALUES (?,?,?,?,?,?,?,1,'waqf')",
    [REQ, `req.${T}@waqf.test`, bcrypt.hashSync("x", 4), "WAQF Requestor", "requestor", null, now]);
  await execute("INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, active, org_id) VALUES (?,?,?,?,?,?,?,1,'waqf')",
    [OTHER, `oth.${T}@waqf.test`, bcrypt.hashSync("x", 4), "Someone Else", "requestor", null, now]);
  // REQ's fully-signed document, and a still-pending one.
  await execute("INSERT INTO requests (id, requestor_id, file_name, file_path, file_type, status, created_at, org_id) VALUES (?,?,?,?,?, 'approved', ?, 'waqf')",
    [RID, REQ, "Trust Deed.pdf", `${RID}.pdf`, "pdf", now]);
  await execute("INSERT INTO requests (id, requestor_id, file_name, file_path, file_type, status, created_at, org_id) VALUES (?,?,?,?,?, 'pending', ?, 'waqf')",
    [RID2, REQ, "Draft.pdf", `${RID2}.pdf`, "pdf", now]);

  // A masool who SIGNED RID, and one who holds authority for its team.
  await execute("INSERT INTO teams (id, name, created_at, org_id) VALUES (?, ?, ?, 'waqf')", [TEAM2, `Jamiat ${T}`, now]);
  for (const [id, nm] of [[SIGNER, "Signing Masool"], [AUTH, "Authority Masool"]]) {
    await execute("INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, active, org_id) VALUES (?,?,?,?,?,?,?,1,'waqf')",
      [id, `${id}@waqf.test`, bcrypt.hashSync("x", 4), nm, "approver", null, now]);
  }
  await execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?, ?)", [AUTH, TEAM2]);
  await execute("UPDATE requests SET approver_id = ?, target_team_id = ? WHERE id = ?", [SIGNER, TEAM2, RID]);

  waqf = startApi(PORT, { ORG_SLUG: "waqf" });
  await waitFor(BASE, waqf);
  hqhb = startApi(HQHB_PORT, { ORG_SLUG: "hqhb" });
  await waitFor(HQHB_BASE, hqhb);

  const forward = (base, uid, requestId, comment) =>
    fetch(`${base}/api/shz/forward`, { method: "POST", headers: hdr(uid), body: JSON.stringify({ requestId, comment }) });

  // ---- hydrateUser marks the HOD ----
  const meHod = await j(await fetch(`${BASE}/api/auth/me`, { headers: hdr(HOD) }));
  ck(meHod?.user?.isHod === true, `hydrateUser: the HOD-team approver is isHod (${meHod?.user?.isHod})`);
  const meReq = await j(await fetch(`${BASE}/api/auth/me`, { headers: hdr(REQ) }));
  ck(meReq?.user?.isHod === false, `hydrateUser: a plain requestor is NOT isHod (${meReq?.user?.isHod})`);

  // ---- requestor forwards their own signed document ----
  let r = await forward(BASE, REQ, RID, "Please review, Saheb.");
  let b = await j(r);
  ck(r.status === 200 && b.forward && b.forward.alreadySent === false && b.forward.forwardedAt > 0,
    `requestor forwards their own signed document (${r.status})`);

  // ---- one forward per document ----
  r = await forward(BASE, REQ, RID, "again");
  b = await j(r);
  ck(r.status === 200 && b.forward?.alreadySent === true, `forwarding again reports it was already sent (${r.status})`);

  // ---- cannot forward a document that is not fully signed ----
  r = await forward(BASE, REQ, RID2, "");
  ck(r.status === 400, `cannot forward a document that is not fully signed (${r.status})`);

  // ---- cannot forward someone else's document ----
  r = await forward(BASE, OTHER, RID, "");
  ck(r.status === 403, `cannot forward a document that isn't yours (${r.status})`);

  // ---- the HOD sees the forward; a non-HOD does not ----
  r = await fetch(`${BASE}/api/shz/forwards`, { headers: hdr(HOD) });
  b = await j(r);
  const seen = (b.forwards || []).find(f => f.requestId === RID);
  ck(r.status === 200 && seen && seen.comment === "Please review, Saheb." && seen.requestorName === "WAQF Requestor" && seen.forwardedAt > 0,
    `the HOD sees the forwarded document with comment, requestor and timestamp (${r.status})`);
  // ---- everyone else: only what they signed or hold authority for ----
  const listFor = async (uid) => ((await j(await fetch(`${BASE}/api/shz/forwards`, { headers: hdr(uid) }))).forwards || []);
  ck((await listFor(SIGNER)).some(f => f.requestId === RID), "a masool who SIGNED the document sees it was sent for Manzuri");
  ck((await listFor(AUTH)).some(f => f.requestId === RID), "a masool with signing authority for its team sees it too");
  ck(!(await listFor(OTHER)).some(f => f.requestId === RID), "someone with no part in it does not see it");
  r = await fetch(`${BASE}/api/requests/${RID}/signed`, { headers: hdr(AUTH) });
  ck(r.status !== 403, `the authority holder may open the signed document (${r.status}, not 403)`);
  r = await fetch(`${BASE}/api/requests/${RID}/signed`, { headers: hdr(OTHER) });
  ck(r.status === 403, `someone with no part in it may not (${r.status})`);
  // A confidential document stays with the people named on it.
  await execute("UPDATE requests SET confidential = 1 WHERE id = ?", [RID]);
  ck(!(await listFor(AUTH)).some(f => f.requestId === RID), "authority alone does not show a CONFIDENTIAL document");
  ck((await listFor(SIGNER)).some(f => f.requestId === RID), "…while the person who signed it still sees it");
  await execute("UPDATE requests SET confidential = 0 WHERE id = ?", [RID]);

  // ---- /sent helper for the requestor's button ----
  r = await fetch(`${BASE}/api/shz/sent`, { headers: hdr(REQ) });
  b = await j(r);
  ck(r.status === 200 && b.sent && b.sent[RID] > 0, `/sent reports when my document was forwarded (${r.status})`);

  // ---- WAQF-only: the HQHB box does not expose any of this ----
  ck((await forward(HQHB_BASE, REQ, RID, "")).status === 404, "forward is 404 on an HQHB box (WAQF-only)");
  ck((await fetch(`${HQHB_BASE}/api/shz/forwards`, { headers: hdr(HOD) })).status === 404, "the HOD dashboard is 404 on an HQHB box (WAQF-only)");
} catch (e) {
  fail.push(`the run stopped early: ${e?.message || e}`);
} finally {
  for (const p of pass) console.log("  PASS  " + p);
  for (const f of fail) console.log("  FAIL  " + f);
  await cleanup().catch(() => {});
  if (waqf) waqf.kill(); if (hqhb) hqhb.kill();
  console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
  if (fail.length && waqf) console.log(waqf.log.split("\n").filter(l => /error/i.test(l)).slice(-12).join("\n"));
  process.exit(fail.length ? 1 : 0);
}
