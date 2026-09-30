// Two high-severity rules from the 2026-09 security assessment:
//
//   CV-02  oneAccess SSO is redeemable only where the server is configured for
//          it AND the deployment's organisation permits it. A box that is not
//          configured (no ONEACCESS_*) or whose organisation disallows SSO must
//          answer 404 at /oneaccess/start and /oneaccess/callback.
//   CV-03  A workflow step signer must hold the team's signing authority; bare
//          membership qualifies only when the team has no approver, and a
//          requestor can never name themselves as a signer of their own request.
//
//   node test/audit-highs.integration.mjs      (from server/, MySQL running)
//
// Spawns its own APIs on spare ports with email and storage off.
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import { PDFDocument } from "pdf-lib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..");
config({ path: path.join(SERVER, ".env") });

const PORT = 5000 + 110 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;
const { initDb, execute, query } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
await initDb();

function startApi(port, env) {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: SERVER, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), SENDGRID_API_KEY: "", STORAGE_BUCKET: "", ...env },
  });
  child.log = ""; child.stdout.on("data", (d) => (child.log += d)); child.stderr.on("data", (d) => (child.log += d));
  return child;
}
async function waitFor(base, child) {
  for (let i = 0; i < 180; i++) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  console.log(child.log); throw new Error("API did not start on " + base);
}
// CV-03 host: SSO explicitly unconfigured, HQHB org.
const api = startApi(PORT, { ORG_SLUG: "hqhb", ONEACCESS_API_BASE_URL: "", ONEACCESS_FRONTEND_URL: "", ONEACCESS_APP_SLUG: "" });
await waitFor(BASE, api);

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);
const T = Date.now().toString(36), now = Date.now();
const R = `u_ah_req_${T}`, A = `u_ah_app_${T}`, M_APP = `u_ah_mapp_${T}`, M_NO = `u_ah_mno_${T}`;
const T_APP = `t_ah_app_${T}`, T_NO = `t_ah_no_${T}`;
const hdr = (id, json = true) => ({ Authorization: "Bearer " + signToken(id), ...(json ? { "Content-Type": "application/json" } : {}) });
const pdf = await (async () => { const d = await PDFDocument.create(); d.addPage([595, 842]); return Buffer.from(await d.save()); })();
const box = { page: 1, x: 10, y: 80, w: 25, h: 8 };
// Create a one-step workflow naming `signerId` on `teamId`, as requestor R.
const createWorkflow = (teamId, signerId) => {
  const fd = new FormData();
  fd.append("file", new Blob([pdf], { type: "application/pdf" }), "wf.pdf");
  fd.append("workflow", JSON.stringify([{ teamId, signers: [{ userId: signerId, boxes: [box], dateFields: [] }] }]));
  return fetch(`${BASE}/api/requests`, { method: "POST", headers: hdr(R, false), body: fd });
};
const j = async (r) => { try { return await r.json(); } catch { return {}; } };

const cleanup = async () => {
  await execute("DELETE FROM requests WHERE requestor_id = ?", [R]);
  await execute("DELETE FROM signing_authority WHERE user_id IN (?, ?, ?, ?)", [R, A, M_APP, M_NO]);
  await execute("DELETE FROM users WHERE id IN (?, ?, ?, ?)", [R, A, M_APP, M_NO]);
  await execute("DELETE FROM teams WHERE id IN (?, ?)", [T_APP, T_NO]);
};

let hqhbSso = null, waqfSso = null;
try {
  await cleanup();
  for (const [id, name] of [[T_APP, "Approver Team"], [T_NO, "No-Approver Team"]]) await execute("INSERT INTO teams (id, name, created_at, org_id) VALUES (?, ?, ?, 'hqhb')", [id, `${name} ${T}`, now]);
  // R: requestor with a signature on file (workflow create requires one), member of T_NO.
  await execute("INSERT INTO users (id, email, password_hash, name, role, team_id, signature_path, created_at, active, org_id) VALUES (?,?,?,?,?,?,?,?,1,'hqhb')", [R, `${R}@ah.test`, bcrypt.hashSync("x", 4), "Audit Requestor", "requestor", T_NO, `${R}.png`, now]);
  await execute("INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, active, org_id) VALUES (?,?,?,?,?,?,?,1,'hqhb')", [A, `${A}@ah.test`, bcrypt.hashSync("x", 4), "The Approver", "approver", T_APP, now]);
  await execute("INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, active, org_id) VALUES (?,?,?,?,?,?,?,1,'hqhb')", [M_APP, `${M_APP}@ah.test`, bcrypt.hashSync("x", 4), "Member of Approver Team", "requestor", T_APP, now]);
  await execute("INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, active, org_id) VALUES (?,?,?,?,?,?,?,1,'hqhb')", [M_NO, `${M_NO}@ah.test`, bcrypt.hashSync("x", 4), "Member of No-Approver Team", "requestor", T_NO, now]);
  await execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?, ?)", [A, T_APP]); // T_APP has an approver; T_NO has none

  // ---- CV-03 ----
  let r = await createWorkflow(T_APP, R);
  ck(r.status === 400 && /yourself/i.test((await j(r)).error || ""), `a requestor cannot name themselves as a signer (${r.status})`);
  r = await createWorkflow(T_APP, M_APP);
  ck(r.status === 400 && /not an approver/i.test((await j(r)).error || ""), `a non-approver member of a team that HAS approvers is refused (${r.status})`);
  r = await createWorkflow(T_APP, A);
  ck(r.status === 200, `the team's approver is accepted (${r.status} ${(await j(r)).error || ""})`);
  r = await createWorkflow(T_NO, M_NO);
  ck(r.status === 200, `a member of a team with NO approver is still accepted (routing fallback) (${r.status} ${(await j(r)).error || ""})`);

  // ---- CV-02: unconfigured server keeps SSO off ----
  ck((await fetch(`${BASE}/api/auth/oneaccess/start`, { redirect: "manual" })).status === 404, "SSO off when the server is not configured (no ONEACCESS_*)");

  // ---- CV-02: configured server, but the organisation decides ----
  const ssoEnv = { ONEACCESS_API_BASE_URL: "https://oneaccess.example.test/api", ONEACCESS_FRONTEND_URL: "https://oneaccess.example.test", ONEACCESS_APP_SLUG: "signflow-test" };
  hqhbSso = startApi(PORT + 10, { ORG_SLUG: "hqhb", ...ssoEnv });
  await waitFor(`http://127.0.0.1:${PORT + 10}`, hqhbSso);   // start sequentially so their boot migrations don't contend
  waqfSso = startApi(PORT + 20, { ORG_SLUG: "waqf", ...ssoEnv });
  await waitFor(`http://127.0.0.1:${PORT + 20}`, waqfSso);
  const start = (p) => fetch(`http://127.0.0.1:${p}/api/auth/oneaccess/start`, { redirect: "manual" });
  const callback = (p) => fetch(`http://127.0.0.1:${p}/api/auth/oneaccess/callback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "x" }) });
  const hs = (await start(PORT + 10)).status;
  ck(hs === 302 || hs === 301, `HQHB (allow_oneaccess=1) opens the SSO door when configured (${hs})`);
  ck((await start(PORT + 20)).status === 404, "WAQF (allow_oneaccess=0) keeps the SSO door shut even though the server is configured — /start");
  ck((await callback(PORT + 20)).status === 404, "…and /callback refuses before any token verification");
} catch (e) {
  fail.push(`the run stopped early: ${e?.message || e}`);
} finally {
  for (const p of pass) console.log("  PASS  " + p);
  for (const f of fail) console.log("  FAIL  " + f);
  await cleanup().catch((e) => console.log("cleanup:", e.message));
  api.kill(); if (hqhbSso) hqhbSso.kill(); if (waqfSso) waqfSso.kill();
  console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
  if (fail.length) console.log(api.log.split("\n").filter((l) => /error/i.test(l)).slice(-10).join("\n"));
  process.exit(fail.length ? 1 : 0);
}
