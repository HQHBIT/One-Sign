// PDFs up to 30 MB; an "email already used" refusal is EXACT and names the holder.
//
//   node test/upload-limit-and-email.integration.mjs      (from server/, MySQL running)
//
// Verifies: a 20 MB PDF request is accepted (the old ceiling was 15 MB); a 31 MB
// PDF is refused with 413 and a readable message; a 15 MB Excel file is refused
// (Excel stays at 14 MB); an email one letter different from an existing one is
// NOT a clash; an exact (case-insensitive) duplicate IS, and the message names
// the account holding it. Spawns its own API on a spare port.
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import { PDFDocument } from "pdf-lib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..");
config({ path: path.join(SERVER, ".env") });

const PORT = 5000 + 170 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;
const { initDb, execute } = await import("../src/db.js");
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
const TEAM = `t_ul_${T}`, R = `u_ul_req_${T}`, ADM = `u_ul_adm_${T}`, H1 = `u_ul_h1_${T}`, H2 = `u_ul_h2_${T}`;
const UPLOADS = path.join(SERVER, "uploads");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
const MB = 1024 * 1024;
const auth = (id) => ({ Authorization: "Bearer " + signToken(id) });
const j = async r => { try { return await r.json(); } catch { return {}; } };
const created = [];

// A VALID PDF of roughly `mb` megabytes: random bytes attached inside it do not compress.
async function pdfOf(mb) {
  const d = await PDFDocument.create(); d.addPage([600, 800]);
  await d.attach(crypto.randomBytes(Math.floor(mb * MB)), "padding.bin", { mimeType: "application/octet-stream" });
  return Buffer.from(await d.save());
}
async function createWith(bytes, name, type) {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type }), name);
  fd.append("targetTeamId", TEAM);
  fd.append("marker", JSON.stringify([{ page: 1, x: 20, y: 30, w: 25, h: 8 }]));
  // One retry on a CLIENT-side network error: a large body sent straight after
  // another can be aborted by the test client on a reused connection. Run alone,
  // the server answers these correctly (verified); a real browser goes via nginx.
  let r, lastErr;
  for (let attempt = 0; attempt < 2 && !r; attempt++) {
    try { r = await fetch(`${BASE}/api/requests`, { method: "POST", headers: auth(R), body: fd }); }
    catch (e) { lastErr = e; await new Promise(res => setTimeout(res, 500)); }
  }
  if (!r) return { status: 0, body: { error: "fetch failed: " + (lastErr?.cause?.code || lastErr?.message) } };
  const b = await j(r); if (b.request?.id) created.push(b.request.id);
  return { status: r.status, body: b };
}
const setEmail = (id, email) => fetch(`${BASE}/api/users/${id}/email`, {
  method: "PUT", headers: { ...auth(ADM), "Content-Type": "application/json" }, body: JSON.stringify({ email }) });

const cleanup = async () => {
  for (const id of created) {
    await execute("DELETE FROM requests WHERE id = ?", [id]).catch(() => {});
    for (const f of [path.join(UPLOADS, "documents", `${id}.pdf`), path.join(UPLOADS, "documents", `${id}.xlsx`)]) await fs.unlink(f).catch(() => {});
  }
  await execute("DELETE FROM signing_authority WHERE user_id IN (?, ?, ?, ?, ?)", [R, ADM, H1, H2, R]).catch(() => {});
  await execute("DELETE FROM users WHERE id IN (?, ?, ?, ?)", [R, ADM, H1, H2]).catch(() => {});
  await execute("DELETE FROM teams WHERE id = ?", [TEAM]).catch(() => {});
  await fs.unlink(path.join(UPLOADS, "signatures", `${R}.png`)).catch(() => {});
};

let api = null;
try {
  await cleanup();
  await fs.mkdir(path.join(UPLOADS, "signatures"), { recursive: true });
  await fs.writeFile(path.join(UPLOADS, "signatures", `${R}.png`), PNG);
  await execute("INSERT INTO teams (id, name, created_at, org_id) VALUES (?, ?, ?, 'hqhb')", [TEAM, `Upload Limit Team ${T}`, now]);
  const ins = (id, email, name, role, extra = {}) => execute(
    "INSERT INTO users (id, email, password_hash, name, role, team_id, signature_path, signature_aspect, its_id, active, created_at, org_id) VALUES (?,?,?,?,?,?,?,1,?,?,?,'hqhb')",
    [id, email, bcrypt.hashSync("x", 4), name, role, extra.team || null, extra.sig || null, extra.its || null, extra.active ?? 1, now]);
  await ins(R, `${R}@ul.test`, "UL Requestor", "requestor", { team: TEAM, sig: `${R}.png` });
  await ins(ADM, `${ADM}@ul.test`, "UL Admin", "admin");
  await ins(H1, `hussain.ul${T}@hqhb.test`, "Hussain Holder", "requestor", { its: "30398913" });
  await ins(H2, `someone.ul${T}@hqhb.test`, "Second Account", "requestor");

  await execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?, ?)", [H2, TEAM]);   // the team needs an approver
  api = startApi(PORT, { ORG_SLUG: "hqhb" }); await waitFor(BASE, api);

  // ---- uploads ----
  let r = await createWith(await pdfOf(20), "big.pdf", "application/pdf");
  ck(r.status === 200, `a 20 MB PDF is accepted (was refused at 15 MB) (${r.status} ${r.body.error || ""})`);
  r = await createWith(await pdfOf(31), "huge.pdf", "application/pdf");
  ck(r.status === 413 && /30 MB/.test(r.body.error || ""), `a 31 MB PDF is refused with 413 and a readable message (${r.status}: ${r.body.error})`);
  r = await createWith(crypto.randomBytes(15 * MB), "big.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  ck(r.status === 413 && /14 MB/.test(r.body.error || ""), `a 15 MB Excel file is refused — Excel stays at 14 MB (${r.status}: ${r.body.error})`);
  r = await createWith(crypto.randomBytes(40 * MB), "enormous.pdf", "application/pdf");
  ck(r.status === 413 && !/Something went wrong/.test(r.body.error || ""), `a file past the multer ceiling gets a clear 413, not "Something went wrong" (${r.status}: ${r.body.error})`);

  // ---- email: exact, word-for-word ----
  let e = await setEmail(H2, `husssain.ul${T}@hqhb.test`);   // one extra 's'
  ck(e.status === 200, `an email one letter different from an existing one is NOT a clash (${e.status} ${(await j(e)).error || ""})`);
  e = await setEmail(H2, `HUSSAIN.UL${T}@HQHB.TEST`);         // same address, different case
  const eb = await j(e);
  ck(e.status === 409 && /Hussain Holder/.test(eb.error || "") && /ITS 30398913/.test(eb.error || ""),
    `an exact (case-insensitive) duplicate IS refused, naming the holder and ITS (${e.status}: ${eb.error})`);
  await execute("UPDATE users SET active = 0 WHERE id = ?", [H1]);
  e = await setEmail(H2, `hussain.ul${T}@hqhb.test`);
  const eb2 = await j(e);
  ck(e.status === 409 && /deactivated/.test(eb2.error || ""), `a deactivated holder still blocks, and the message says so (${e.status}: ${eb2.error})`);
} catch (err) {
  fail.push(`the run stopped early: ${err?.message || err}`);
} finally {
  for (const p of pass) console.log("  PASS  " + p);
  for (const f of fail) console.log("  FAIL  " + f);
  await cleanup().catch(e => console.log("cleanup:", e.message));
  if (api) api.kill();
  console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
  if (fail.length && api) console.log(api.log.split("\n").filter(l => /error|Error/.test(l)).slice(-12).join("\n"));
  process.exit(fail.length ? 1 : 0);
}
