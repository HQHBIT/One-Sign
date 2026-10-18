// Retention by request type (HQHB).
//
//   node test/retention.integration.mjs      (from server/, MySQL running)
//
// Verifies: the HQHB box accepts the eight types and stamps each one's period
// at creation, WAQF keeps the original five and stamps nothing; the
// Confidential type is always confidential; nothing happens to a request still
// in progress, or to one made before retention existed; two days before the
// period ends the requestor is sent their copy (attached — but never for a
// confidential one); files are removed only when the period ends AND the notice
// has had its two days; after removal every file route answers 410 and the
// record itself remains. The job is driven with explicit times rather than by
// waiting. Spawns its own APIs on spare ports.
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import { PDFDocument } from "pdf-lib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..");
config({ path: path.join(SERVER, ".env") });

const PORT = 5000 + 200 + Math.floor(Math.random() * 4);
const BASE = `http://127.0.0.1:${PORT}`;
const WAQF_BASE = `http://127.0.0.1:${PORT + 5}`;
const { initDb, execute, queryOne, query } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
const { retentionTick, RETENTION_DAYS, NOTICE_BEFORE_MS } = await import("../src/retention.js");
const { diskPathFor } = await import("../src/filestore.js");
const { REQUEST_TYPES } = await import("../../client/src/lib/constants.js");
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
const DAY = 86_400_000;
const T = Date.now().toString(36), now = Date.now();
const TEAM = `t_ret_${T}`, R = `u_ret_req_${T}`, A = `u_ret_app_${T}`;
const UPLOADS = path.join(SERVER, "uploads");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
const pdfBytes = await (async () => { const d = await PDFDocument.create(); d.addPage([600, 800]); return Buffer.from(await d.save()); })();
const auth = (id) => ({ Authorization: "Bearer " + signToken(id) });
const j = async r => { try { return await r.json(); } catch { return {}; } };
const created = [];
// Only this test's requests: the local database may hold others.
const tick = (t) => retentionTick(t, { ids: created });
const exists = (p) => fs.access(p).then(() => true, () => false);

async function create(base, requestType, extra = {}) {
  const fd = new FormData();
  fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), `${requestType}.pdf`);
  fd.append("targetTeamId", TEAM);
  fd.append("marker", JSON.stringify([{ page: 1, x: 20, y: 30, w: 25, h: 8 }]));
  fd.append("requestType", requestType);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  const r = await fetch(`${base}/api/requests`, { method: "POST", headers: auth(R), body: fd });
  const b = await j(r);
  if (b.request?.id) created.push(b.request.id);
  return { status: r.status, id: b.request?.id, error: b.error };
}
const approve = (id) => fetch(`${BASE}/api/requests/${id}/approve`, {
  method: "POST", headers: { ...auth(A), "Content-Type": "application/json" }, body: JSON.stringify({ instant: true }) });
const row = (id) => queryOne("SELECT * FROM requests WHERE id = ?", [id]);
const noticeFor = (id) => queryOne("SELECT title, body FROM notifications WHERE request_id = ? AND type = 'retention_notice'", [id]);

const cleanup = async () => {
  for (const id of created) {
    await execute("DELETE FROM notifications WHERE request_id = ?", [id]).catch(() => {});
    await execute("DELETE FROM requests WHERE id = ?", [id]).catch(() => {});
  }
  await execute("DELETE FROM signing_authority WHERE user_id IN (?, ?)", [R, A]).catch(() => {});
  await execute("DELETE FROM users WHERE id IN (?, ?)", [R, A]).catch(() => {});
  await execute("DELETE FROM teams WHERE id = ?", [TEAM]).catch(() => {});
  for (const u of [R, A]) await fs.unlink(path.join(UPLOADS, "signatures", `${u}.png`)).catch(() => {});
};

let hqhb = null, waqf = null;
try {
  await cleanup();
  // ---- the policy itself, and that client and server agree on it ----
  ck(JSON.stringify(RETENTION_DAYS) === JSON.stringify({ document: 7, leave: 3, expense: 15, invoice: 15, project: 30, workdone: 7, confidential: 60, general: 15 }),
    "periods: Document 7 · Leave 3 · Expense 15 · Invoice/PO 15 · Project 30 · Work done 7 · Confidential 60 · Others 15 days");
  const clientDays = Object.fromEntries(REQUEST_TYPES.filter(t => t.retentionDays).map(t => [t.key, t.retentionDays]));
  ck(JSON.stringify(clientDays) === JSON.stringify(RETENTION_DAYS), `the app shows the same periods the server applies (${JSON.stringify(clientDays)})`);

  await fs.mkdir(path.join(UPLOADS, "signatures"), { recursive: true });
  for (const u of [R, A]) await fs.writeFile(path.join(UPLOADS, "signatures", `${u}.png`), PNG);
  await execute("INSERT INTO teams (id, name, created_at, org_id) VALUES (?, ?, ?, 'hqhb')", [TEAM, `Retention Team ${T}`, now]);
  for (const [id, nm, role] of [[R, "Ret Requestor", "requestor"], [A, "Ret Approver", "approver"]]) await execute(
    "INSERT INTO users (id, email, password_hash, name, role, team_id, signature_path, signature_aspect, created_at, active, org_id) VALUES (?,?,?,?,?,?,?,1,?,1,'hqhb')",
    [id, `${id}@ret.test`, bcrypt.hashSync("x", 4), nm, role, role === "requestor" ? TEAM : null, `${id}.png`, now]);
  await execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?, ?)", [A, TEAM]);

  hqhb = startApi(PORT, { ORG_SLUG: "hqhb" }); await waitFor(BASE, hqhb);
  waqf = startApi(PORT + 5, { ORG_SLUG: "waqf" }); await waitFor(WAQF_BASE, waqf);

  // ---- creation ----
  const byType = {};
  for (const t of Object.keys(RETENTION_DAYS)) {
    const c = await create(BASE, t);
    byType[t] = c.id;
    const r = await row(c.id);
    ck(c.status === 200 && r.request_type === t && Number(r.retention_days) === RETENTION_DAYS[t], `HQHB "${t}" request stamped ${RETENTION_DAYS[t]} days (${c.status} ${c.error || ""})`);
  }
  const conf = await row(byType.confidential);
  ck(conf.request_type === "confidential" && Number(conf.confidential) === 1, "the Confidential type is always confidential");
  const w = await create(WAQF_BASE, "project");
  const wr = await row(w.id);
  ck(wr.request_type === "general" && wr.retention_days === null, "WAQF: no new types, nothing stamped (kept indefinitely)");

  // ---- a leave request through its whole life ----
  const leave = await create(BASE, "leave");
  ck((await approve(leave.id)).status === 200, "the leave request is approved");
  let L = await row(leave.id);
  const decided = Number(L.finalized_at);
  const ends = decided + 3 * DAY;
  const signedPath = diskPathFor("signed", L.signed_file_path), origPath = diskPathFor("documents", L.file_path);
  ck(!!decided && await exists(signedPath), "signed copy stored, period counting from the decision");

  await tick(decided + 12 * 3600_000);
  ck(!(await row(leave.id)).retention_notified_at, "half a day in: nothing happens");

  await tick(ends - NOTICE_BEFORE_MS + 60_000);
  L = await row(leave.id);
  const n = await noticeFor(leave.id);
  ck(!!L.retention_notified_at && !L.files_purged_at, "two days before the end: the requestor is notified, nothing removed");
  ck(/Stored until/.test(n?.title || "") && /emailed it to you/.test(n?.body || ""), `…with their signed copy attached (${n?.title} — ${n?.body})`);
  const mail = await queryOne("SELECT subject FROM emails WHERE to_email = ? AND template = 'retention_notice' ORDER BY sent_at DESC LIMIT 1", [`${R}@ret.test`]);
  ck(/Your copy of leave\.pdf/.test(mail?.subject || ""), `the email went out (${mail?.subject})`);

  await tick(ends - 60_000);
  ck(!(await row(leave.id)).files_purged_at, "a minute before the end: still there");

  await tick(ends + 60_000);
  L = await row(leave.id);
  ck(!!L.files_purged_at, "after the end: the files are removed");
  ck(!(await exists(signedPath)) && !(await exists(origPath)), "…from the disk (signed copy and original)");
  ck(L.status === "approved" && L.file_name === "leave.pdf", "…but the record stays, with its outcome");
  const f = await fetch(`${BASE}/api/requests/${leave.id}/file`, { headers: auth(R) });
  const fb = await j(f);
  ck(f.status === 410 && fb.removed && /storage period ended/.test(fb.error), `opening it now explains it was removed (${f.status} ${fb.error})`);
  ck((await fetch(`${BASE}/api/requests/${leave.id}/signed`, { headers: auth(R) })).status === 410, "the signed copy route says the same");
  const list = await j(await fetch(`${BASE}/api/requests`, { headers: auth(R) }));
  const item = list.requests?.find(x => x.id === leave.id);
  ck(item?.filesPurgedAt && item.retentionDays === 3, "the request list marks it as removed");

  // ---- a confidential request: notified, never attached ----
  const cf = await create(BASE, "confidential");
  await execute("UPDATE requests SET status = 'approved', finalized_at = ? WHERE id = ?", [now - 59 * DAY, cf.id]);
  await tick(now);
  const cn = await noticeFor(cf.id);
  ck(!!cn && !/emailed it to you/.test(cn.body || "") && /confidential document/.test(cn.title || ""), `confidential: notified, but nothing attached and not named (${cn?.title})`);
  const cmail = await queryOne("SELECT subject FROM emails WHERE to_email = ? AND template = 'confidential_retention_notice' ORDER BY sent_at DESC LIMIT 1", [`${R}@ret.test`]);
  ck(!!cmail && !/confidential\.pdf/.test(cmail.subject), `…the email is the confidential version (${cmail?.subject})`);

  // ---- a notice that comes late still gets its full two days ----
  const late = await create(BASE, "leave");
  await execute("UPDATE requests SET status = 'approved', finalized_at = ? WHERE id = ?", [now - 10 * DAY, late.id]);
  await tick(now);
  ck(!!(await row(late.id)).retention_notified_at && !(await row(late.id)).files_purged_at, "long overdue: notified first, not removed in the same pass");
  await tick(now + NOTICE_BEFORE_MS - 60_000);
  ck(!(await row(late.id)).files_purged_at, "…and not before two days have passed since the notice");
  await tick(now + NOTICE_BEFORE_MS + 60_000);
  ck(!!(await row(late.id)).files_purged_at, "…then removed");

  // ---- never touched ----
  const pending = await create(BASE, "leave");
  await execute("UPDATE requests SET created_at = ? WHERE id = ?", [now - 30 * DAY, pending.id]);
  const old = await create(BASE, "leave");
  await execute("UPDATE requests SET status = 'approved', finalized_at = ?, retention_days = NULL WHERE id = ?", [now - 300 * DAY, old.id]);
  await tick(now + 400 * DAY);
  const P = await row(pending.id), O = await row(old.id);
  ck(!P.retention_notified_at && !P.files_purged_at, "a request still awaiting signature is never touched, however old");
  ck(!O.retention_notified_at && !O.files_purged_at, "a request from before retention existed is never touched");
} catch (e) {
  fail.push(`the run stopped early: ${e?.stack || e}`);
} finally {
  for (const p of pass) console.log("  PASS  " + p);
  for (const f of fail) console.log("  FAIL  " + f);
  await cleanup().catch(() => {});
  if (hqhb) hqhb.kill(); if (waqf) waqf.kill();
  console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
  if (fail.length && hqhb) console.log(hqhb.log.split("\n").filter(l => /error|Error/.test(l)).slice(-12).join("\n"));
  process.exit(fail.length ? 1 : 0);
}
