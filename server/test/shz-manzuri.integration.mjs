// The Manzuri coming back — WAQF, after "Send for Shz Saab Approval".
//
//   node test/shz-manzuri.integration.mjs      (from server/, MySQL running)
//
// Verifies: WAQF-only; only after the document was sent, and only by its
// requestor; marking it received records the time; the Manzuri can be uploaded
// (PDF/JPG/PNG) with the mark or later, and a later upload never moves the
// received time; wrong types and oversized images are refused; the requestor
// and the HOD can open it, nobody else can; the HOD board and the requestor's
// "sent" list both carry it. Spawns its own APIs on spare ports.
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..");
config({ path: path.join(SERVER, ".env") });

const PORT = 5000 + 210 + Math.floor(Math.random() * 4);
const BASE = `http://127.0.0.1:${PORT}`;
const HQHB_BASE = `http://127.0.0.1:${PORT + 5}`;
const { initDb, execute, queryOne } = await import("../src/db.js");
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
const HOD = `u_mzh_${T}`, REQ = `u_mzr_${T}`, OTHER = `u_mzo_${T}`;
const RID = `req_mz_${T}`, RID2 = `req_mz2_${T}`;
let TEAM = null, createdTeam = false;
const auth = (id) => ({ Authorization: "Bearer " + signToken(id) });
const jh = (id) => ({ ...auth(id), "Content-Type": "application/json" });
const j = async r => { try { return await r.json(); } catch { return {}; } };
const PDF = Buffer.from("%PDF-1.4 manzuri test\n");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");

function manzuri(base, who, rid, { file, name, type, note, received } = {}) {
  const fd = new FormData();
  if (file) fd.append("file", new Blob([file], { type }), name);
  if (note) fd.append("note", note);
  if (received) fd.append("received", "true");
  return fetch(`${base}/api/shz/manzuri/${rid}`, { method: "POST", headers: auth(who), body: fd });
}

const cleanup = async () => {
  await execute("DELETE FROM shz_forwards WHERE request_id IN (?, ?)", [RID, RID2]).catch(() => {});
  await execute("DELETE FROM requests WHERE id IN (?, ?)", [RID, RID2]).catch(() => {});
  await execute("DELETE FROM signing_authority WHERE user_id IN (?, ?, ?)", [HOD, REQ, OTHER]).catch(() => {});
  await execute("DELETE FROM users WHERE id IN (?, ?, ?)", [HOD, REQ, OTHER]).catch(() => {});
  if (createdTeam) await execute("DELETE FROM teams WHERE id = ?", [TEAM]).catch(() => {});
};

let waqf = null, hqhb = null;
try {
  await cleanup();
  // Use the WAQF "HOD" team if this database already has one (the app treats
  // the first one as THE HOD team), else make one for the test.
  const existing = await queryOne("SELECT id FROM teams WHERE org_id = 'waqf' AND LOWER(name) = 'hod' LIMIT 1");
  if (existing) TEAM = existing.id;
  else { TEAM = `t_mzhod_${T}`; createdTeam = true; await execute("INSERT INTO teams (id, name, created_at, org_id) VALUES (?, 'HOD', ?, 'waqf')", [TEAM, now]); }
  const mk = (id, nm, role) => execute(
    "INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, active, org_id) VALUES (?,?,?,?,?,NULL,?,1,'waqf')",
    [id, `${id}@waqf.test`, bcrypt.hashSync("x", 4), nm, role, now]);
  await mk(HOD, "Manzuri HOD", "approver");
  await mk(REQ, "Manzuri Requestor", "requestor");
  await mk(OTHER, "Someone Else", "requestor");
  await execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?, ?)", [HOD, TEAM]);
  for (const id of [RID, RID2]) await execute(
    "INSERT INTO requests (id, requestor_id, file_name, file_path, file_type, status, created_at, org_id) VALUES (?,?,?,?, 'pdf', 'approved', ?, 'waqf')",
    [id, REQ, id === RID ? "Trust Deed.pdf" : "Not sent.pdf", `${id}.pdf`, now]);

  waqf = startApi(PORT, { ORG_SLUG: "waqf" }); await waitFor(BASE, waqf);
  hqhb = startApi(PORT + 5, { ORG_SLUG: "hqhb" }); await waitFor(HQHB_BASE, hqhb);

  ck((await manzuri(HQHB_BASE, REQ, RID, { received: true })).status === 404, "HQHB box: the Manzuri routes do not exist");

  // Not before the document was sent.
  ck((await manzuri(BASE, REQ, RID2, { received: true })).status === 404, "a document not sent for Shz Saab approval cannot be marked");

  const f = await fetch(`${BASE}/api/shz/forward`, { method: "POST", headers: jh(REQ), body: JSON.stringify({ requestId: RID, comment: "For approval" }) });
  ck(f.status === 200, `the requestor sends it for Shz Saab approval (${f.status})`);

  ck((await manzuri(BASE, OTHER, RID, { received: true })).status === 403, "someone else cannot mark the Manzuri");
  ck((await manzuri(BASE, REQ, RID, {})).status === 400, "an empty submission is refused");

  // Marked received, no file yet.
  const t1 = Date.now();
  let r = await manzuri(BASE, REQ, RID, { received: true, note: "Received by hand" });
  let b = await j(r);
  ck(r.status === 200 && b.manzuri?.receivedAt >= t1 && !b.manzuri.fileName && b.manzuri.note === "Received by hand",
    `marked received: the time is recorded, the note kept, no file yet (${JSON.stringify(b.manzuri)})`);
  const receivedAt = b.manzuri.receivedAt;

  // Wrong type / too large.
  ck((await manzuri(BASE, REQ, RID, { file: Buffer.from("x"), name: "manzuri.docx", type: "application/octet-stream" })).status === 400, "a .docx is refused");
  ck((await manzuri(BASE, REQ, RID, { file: Buffer.alloc(16 * 1024 * 1024, 1), name: "huge.jpg", type: "image/jpeg" })).status === 413, "an image over 15 MB is refused");

  // Upload later: the received time does not move.
  await new Promise(res => setTimeout(res, 20));
  r = await manzuri(BASE, REQ, RID, { file: PDF, name: "Manzuri.pdf", type: "application/pdf" });
  b = await j(r);
  ck(r.status === 200 && b.manzuri.fileName === "Manzuri.pdf" && b.manzuri.receivedAt === receivedAt && b.manzuri.uploadedAt > receivedAt,
    "the Manzuri uploaded later: the received time stays, the upload time is recorded");
  ck(b.manzuri.note === "Received by hand", "…and the earlier note is kept");

  // Who may open it.
  const asReq = await fetch(`${BASE}/api/shz/manzuri/${RID}/file`, { headers: auth(REQ) });
  ck(asReq.status === 200 && Buffer.from(await asReq.arrayBuffer()).equals(PDF) && /pdf/.test(asReq.headers.get("content-type")), "the requestor opens it, byte-for-byte");
  ck((await fetch(`${BASE}/api/shz/manzuri/${RID}/file`, { headers: auth(HOD) })).status === 200, "the HOD opens it");
  ck((await fetch(`${BASE}/api/shz/manzuri/${RID}/file`, { headers: auth(OTHER) })).status === 403, "nobody else can");

  // Replace with a photo.
  r = await manzuri(BASE, REQ, RID, { file: PNG, name: "Manzuri-photo.png", type: "image/png" });
  const img = await fetch(`${BASE}/api/shz/manzuri/${RID}/file`, { headers: auth(HOD) });
  ck(r.status === 200 && /image\/png/.test(img.headers.get("content-type")), "a photo can replace it, served as an image");

  // The HOD board and the requestor's list carry it.
  const board = await j(await fetch(`${BASE}/api/shz/forwards`, { headers: auth(HOD) }));
  const row = board.forwards?.find(x => x.requestId === RID);
  ck(row?.manzuri?.receivedAt === receivedAt && row.manzuri.fileName === "Manzuri-photo.png", "the HOD board shows the Manzuri and when it was received");
  const sent = await j(await fetch(`${BASE}/api/shz/sent`, { headers: auth(REQ) }));
  ck(typeof sent.sent?.[RID] === "number" && sent.manzuri?.[RID]?.receivedAt === receivedAt, "the requestor's list has it too (and the old 'sent' shape is unchanged)");
} catch (e) {
  fail.push(`the run stopped early: ${e?.stack || e}`);
} finally {
  for (const p of pass) console.log("  PASS  " + p);
  for (const f of fail) console.log("  FAIL  " + f);
  await cleanup().catch(() => {});
  if (waqf) waqf.kill(); if (hqhb) hqhb.kill();
  console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
  if (fail.length && waqf) console.log(waqf.log.split("\n").filter(l => /error|Error/.test(l)).slice(-10).join("\n"));
  process.exit(fail.length ? 1 : 0);
}
