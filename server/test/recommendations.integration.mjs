// HQHB "Recommend changes": approve, reject, or send back for changes.
//
//   node test/recommendations.integration.mjs      (from server/, MySQL running)
//
// Verifies: the routes are HQHB-only (404 on WAQF, rest of /api/requests intact);
// only the approver whose turn it is may recommend, with a note; the request
// moves to changes_requested and cannot be approved while it is with the
// requestor; the asker keeps sight of it; the requestor may reply, replace the
// document (same type, only while nobody has signed), and add a supporting
// document that needs a signature; resubmitting returns it to pending with the
// round closed; one approval then signs the main document AND the supporting
// one; on a workflow where someone already signed, replacing is refused but a
// plain resubmit lands back with the same approver; a returned request can be
// withdrawn. Spawns its own APIs on spare ports.
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

const PORT = 5000 + 180 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;
const WAQF_PORT = PORT + 5;
const WAQF_BASE = `http://127.0.0.1:${WAQF_PORT}`;
const { initDb, execute, queryOne, query } = await import("../src/db.js");
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
const TEAM = `t_rc_${T}`, R = `u_rc_req_${T}`, A = `u_rc_app_${T}`, B = `u_rc_b_${T}`, OTHER = `u_rc_oth_${T}`;
const USERS = [R, A, B, OTHER];
const UPLOADS = path.join(SERVER, "uploads");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
const mkPdf = async (pages = 1) => { const d = await PDFDocument.create(); for (let i = 0; i < pages; i++) d.addPage([600, 800]); return Buffer.from(await d.save()); };
const pdfBytes = await mkPdf(1);
const revisedBytes = await mkPdf(2);
const auth = (id) => ({ Authorization: "Bearer " + signToken(id) });
const jhdr = (id) => ({ ...auth(id), "Content-Type": "application/json" });
const j = async r => { try { return await r.json(); } catch { return {}; } };
const created = [];

async function createSingle(base) {
  const fd = new FormData();
  fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "rc.pdf");
  fd.append("targetTeamId", TEAM);
  fd.append("marker", JSON.stringify([{ page: 1, x: 20, y: 30, w: 25, h: 8 }]));
  const r = await fetch(`${base}/api/requests`, { method: "POST", headers: auth(R), body: fd });
  const b = await j(r); if (b.request?.id) created.push(b.request.id);
  return { status: r.status, id: b.request?.id };
}
// Direct request: B signs first, then A.
async function createDirectTwo(base) {
  const fd = new FormData();
  fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "rc-direct.pdf");
  fd.append("direct", "true");
  fd.append("signers", JSON.stringify([
    { userId: B, boxes: [{ page: 1, x: 10, y: 20, w: 30, h: 10 }], dateFields: [] },
    { userId: A, boxes: [{ page: 1, x: 10, y: 60, w: 30, h: 10 }], dateFields: [] },
  ]));
  const r = await fetch(`${base}/api/requests`, { method: "POST", headers: auth(R), body: fd });
  const b = await j(r); if (b.request?.id) created.push(b.request.id);
  return { status: r.status, id: b.request?.id };
}
const recommend = (base, id, who, text) =>
  fetch(`${base}/api/requests/${id}/recommend`, { method: "POST", headers: jhdr(who), body: JSON.stringify({ recommendation: text }) });
const approve = (base, id, who) =>
  fetch(`${base}/api/requests/${id}/approve`, { method: "POST", headers: jhdr(who), body: JSON.stringify({ instant: true }) });
function resubmit(id, who, { file, name, reply, boxes } = {}) {
  const fd = new FormData();
  if (file) fd.append("file", new Blob([file], { type: "application/pdf" }), name || "revised.pdf");
  if (reply) fd.append("reply", reply);
  if (boxes) fd.append("boxes", JSON.stringify(boxes));
  return fetch(`${BASE}/api/requests/${id}/resubmit`, { method: "POST", headers: auth(who), body: fd });
}
function attach(id, { needsSignature, boxes, name = "annexure.pdf", bytes = pdfBytes } = {}) {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: "application/pdf" }), name);
  if (needsSignature) fd.append("needsSignature", "true");
  if (boxes) fd.append("boxes", JSON.stringify(boxes));
  return fetch(`${BASE}/api/requests/${id}/attachments`, { method: "POST", headers: auth(R), body: fd });
}

const cleanup = async () => {
  for (const id of created) {
    await execute("DELETE FROM request_recommendations WHERE request_id = ?", [id]).catch(() => {});
    await execute("DELETE FROM request_attachments WHERE request_id = ?", [id]).catch(() => {});
    await execute("DELETE sg FROM request_step_signers sg JOIN request_steps st ON st.id = sg.step_id WHERE st.request_id = ?", [id]).catch(() => {});
    await execute("DELETE FROM request_steps WHERE request_id = ?", [id]).catch(() => {});
    await execute("DELETE FROM notifications WHERE request_id = ?", [id]).catch(() => {});
    await execute("DELETE FROM requests WHERE id = ?", [id]).catch(() => {});
  }
  await execute(`DELETE FROM signing_authority WHERE user_id IN (${USERS.map(() => "?").join(",")})`, USERS).catch(() => {});
  await execute(`DELETE FROM users WHERE id IN (${USERS.map(() => "?").join(",")})`, USERS).catch(() => {});
  await execute("DELETE FROM teams WHERE id = ?", [TEAM]).catch(() => {});
  for (const u of USERS) await fs.unlink(path.join(UPLOADS, "signatures", `${u}.png`)).catch(() => {});
};

let hqhb = null, waqf = null;
try {
  await cleanup();
  await fs.mkdir(path.join(UPLOADS, "signatures"), { recursive: true });
  for (const u of USERS) await fs.writeFile(path.join(UPLOADS, "signatures", `${u}.png`), PNG);
  await execute("INSERT INTO teams (id, name, created_at, org_id) VALUES (?, ?, ?, 'hqhb')", [TEAM, `Recommend Team ${T}`, now]);
  const mk = (id, nm, role, team) => execute(
    "INSERT INTO users (id, email, password_hash, name, role, team_id, signature_path, signature_aspect, created_at, active, org_id) VALUES (?,?,?,?,?,?,?,1,?,1,'hqhb')",
    [id, `${id}@rc.test`, bcrypt.hashSync("x", 4), nm, role, team, `${id}.png`, now]);
  await mk(R, "RC Requestor", "requestor", TEAM);
  await mk(A, "RC Approver", "approver", null);
  await mk(B, "RC First Signer", "approver", null);
  await mk(OTHER, "RC Unrelated", "requestor", null);
  await execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?, ?)", [A, TEAM]);

  hqhb = startApi(PORT, { ORG_SLUG: "hqhb" }); await waitFor(BASE, hqhb);
  waqf = startApi(WAQF_PORT, { ORG_SLUG: "waqf" }); await waitFor(WAQF_BASE, waqf);

  // ---- HQHB only ----
  const w = await createSingle(WAQF_BASE);
  ck((await recommend(WAQF_BASE, w.id, A, "fix it")).status === 404, "WAQF box: recommend is 404 (feature absent)");
  ck((await fetch(`${WAQF_BASE}/api/requests/${w.id}/resubmit`, { method: "POST", headers: auth(R) })).status === 404, "WAQF box: resubmit is 404");
  ck((await fetch(`${WAQF_BASE}/api/requests`, { headers: auth(R) })).status === 200, "WAQF box: the rest of /api/requests still works");

  // ---- single-team request: who may recommend ----
  const c = await createSingle(BASE);
  ck(!!c.id, `create a single-team request (${c.status})`);
  ck((await recommend(BASE, c.id, OTHER, "change it")).status === 403, "an unrelated user cannot recommend changes");
  ck((await recommend(BASE, c.id, R, "change it")).status === 403, "the requestor cannot recommend changes on their own request");
  ck((await recommend(BASE, c.id, A, "   ")).status === 400, "a recommendation needs text");

  let r = await recommend(BASE, c.id, A, "Please attach the signed quotation and fix the total.");
  let b = await j(r);
  ck(r.status === 200 && b.request?.status === "changes_requested", `the approver sends it back (${r.status}, ${b.request?.status})`);
  ck(b.request?.recommendations?.length === 1 && b.request.recommendations[0].round === 1
    && b.request.recommendations[0].requestedByName === "RC Approver" && !b.request.recommendations[0].resubmittedAt,
    "round 1 is recorded with the approver's name, still open");
  const note = await queryOne("SELECT title FROM notifications WHERE request_id = ? AND user_id = ? AND type = 'changes_requested'", [c.id, R]);
  ck(!!note && /Changes requested/.test(note.title), "the requestor is notified in-app");

  ck((await approve(BASE, c.id, A)).status === 400, "it cannot be approved while it is with the requestor");
  ck((await recommend(BASE, c.id, A, "again")).status === 400, "it cannot be sent back twice in one round");
  const aList = await j(await fetch(`${BASE}/api/requests`, { headers: auth(A) }));
  ck(aList.requests?.some(x => x.id === c.id && x.status === "changes_requested"), "the approver who asked still sees it while it is returned");
  ck((await fetch(`${BASE}/api/requests/${c.id}/file`, { headers: auth(A) })).status === 200, "…and may still open the document");

  // ---- requestor revises ----
  ck((await attach(c.id, { needsSignature: true })).status === 400, "a supporting document that needs a signature must carry boxes");
  r = await attach(c.id, { needsSignature: true, boxes: [{ page: 1, x: 50, y: 70, w: 30, h: 10 }], name: "quotation.pdf" });
  b = await j(r);
  const attId = b.attachment?.id;
  ck(r.status === 200 && b.attachment?.needsSignature && b.attachment?.boxes?.length === 1 && !b.attachment?.signed,
    `while returned, the requestor adds a supporting document that needs a signature (${r.status})`);
  r = await attach(c.id, { name: "notes.pdf" });
  ck(r.status === 200 && !(await j(r)).attachment?.needsSignature, "…and one that is only for reading");

  ck((await resubmit(c.id, OTHER, { reply: "x" })).status === 403, "only the requestor may resubmit");
  const xfd = new FormData();
  xfd.append("file", new Blob([Buffer.from("PK fake")], { type: "application/octet-stream" }), "wrong.xlsx");
  ck((await fetch(`${BASE}/api/requests/${c.id}/resubmit`, { method: "POST", headers: auth(R), body: xfd })).status === 400,
    "a revised document must be the same type as the original");

  const before = await queryOne("SELECT file_path FROM requests WHERE id = ?", [c.id]);
  r = await resubmit(c.id, R, { file: revisedBytes, name: "rc-v2.pdf", reply: "Attached the quotation; total fixed.", boxes: [{ page: 2, x: 20, y: 30, w: 25, h: 8 }] });
  b = await j(r);
  const after = await queryOne("SELECT file_path, file_name, marker_json FROM requests WHERE id = ?", [c.id]);
  ck(r.status === 200 && b.request?.status === "pending", `resubmitting puts it back to pending (${r.status} ${b.error || ""})`);
  ck(after.file_path !== before.file_path && after.file_name === "rc-v2.pdf", "the main document was replaced, the original kept on file");
  ck(JSON.parse(after.marker_json)[0]?.page === 2, "the approver's box moved to where the requestor placed it on the revision");
  const rec = b.request?.recommendations?.[0];
  ck(rec?.resubmittedAt && rec.reply === "Attached the quotation; total fixed." && rec.documentReplaced, "round 1 is closed with the reply and 'document replaced'");
  ck(!!(await queryOne("SELECT 1 AS ok FROM notifications WHERE request_id = ? AND user_id = ? AND type = 'resubmitted'", [c.id, A])),
    "the approver who asked is notified it is back");
  ck((await resubmit(c.id, R, {})).status === 400, "a pending request cannot be resubmitted");

  // ---- one approval signs both ----
  r = await approve(BASE, c.id, A);
  ck(r.status === 200, `the approver approves (${r.status} ${(await j(r)).error || ""})`);
  const fin = await queryOne("SELECT status, signed_file_path FROM requests WHERE id = ?", [c.id]);
  ck(fin.status === "approved" && !!fin.signed_file_path, "Approve signs and finalises at once");
  const att = await queryOne("SELECT signed_at, signed_by, signed_file_path FROM request_attachments WHERE id = ?", [attId]);
  ck(!!att?.signed_at && att.signed_by === A && !!att.signed_file_path, "the supporting document was signed by the same approval");
  const sdl = await fetch(`${BASE}/api/requests/${c.id}/attachments/${attId}/file?signed=1`, { headers: auth(R) });
  const sbytes = Buffer.from(await sdl.arrayBuffer());
  ck(sdl.status === 200 && sbytes.length > pdfBytes.length + 100, "the signed supporting document can be downloaded");
  const readOnly = await queryOne("SELECT signed_at FROM request_attachments WHERE request_id = ? AND needs_signature = 0", [c.id]);
  ck(readOnly && !readOnly.signed_at, "the read-only supporting document is not stamped");

  // ---- workflow where someone already signed ----
  const d = await createDirectTwo(BASE);
  ck(!!d.id, `create a two-signer direct request (${d.status})`);
  ck((await recommend(BASE, d.id, A, "not my turn yet")).status === 403, "a later signer cannot recommend before their turn");
  r = await approve(BASE, d.id, B);
  ck(r.status === 200, `the first signer signs (${r.status})`);
  r = await recommend(BASE, d.id, A, "Second page is missing.");
  ck(r.status === 200, `the second signer sends it back (${r.status})`);
  r = await resubmit(d.id, R, { file: revisedBytes, name: "x.pdf" });
  ck(r.status === 409, `once someone has signed, the main document cannot be replaced (${r.status})`);
  ck((await queryOne("SELECT status FROM requests WHERE id = ?", [d.id])).status === "changes_requested", "…and the refused attempt left it returned");
  r = await resubmit(d.id, R, { reply: "Added it as a supporting document." });
  ck(r.status === 200 && (await j(r)).request?.status === "pending", "a reply-only resubmit is accepted");
  const nxt = await queryOne(`SELECT sg.user_id, (SELECT COUNT(*) FROM request_step_signers s2 JOIN request_steps t2 ON t2.id = s2.step_id
      WHERE t2.request_id = ? AND s2.status = 'signed') AS n FROM request_step_signers sg JOIN request_steps st ON st.id = sg.step_id
      WHERE st.request_id = ? AND st.status = 'active' AND sg.status = 'pending' ORDER BY sg.signer_order LIMIT 1`, [d.id, d.id]);
  ck(nxt?.user_id === A && Number(nxt.n) === 1, "it lands back with the approver who asked; the earlier signature stands");

  // ---- a returned request may be withdrawn ----
  const e = await createSingle(BASE);
  await recommend(BASE, e.id, A, "Wrong form.");
  r = await fetch(`${BASE}/api/requests/${e.id}/cancel`, { method: "POST", headers: jhdr(R), body: "{}" });
  ck(r.status === 200, `the requestor may withdraw a returned request (${r.status})`);
  const recs = await query("SELECT round FROM request_recommendations WHERE request_id = ?", [e.id]);
  ck(recs.length === 1, "the recommendation history survives a withdrawal");
} catch (e) {
  fail.push(`the run stopped early: ${e?.stack || e}`);
} finally {
  for (const p of pass) console.log("  PASS  " + p);
  for (const f of fail) console.log("  FAIL  " + f);
  await cleanup().catch(e => console.log("cleanup:", e.message));
  if (hqhb) hqhb.kill(); if (waqf) waqf.kill();
  console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
  if (fail.length && hqhb) console.log(hqhb.log.split("\n").filter(l => /error|Error/.test(l)).slice(-12).join("\n"));
  process.exit(fail.length ? 1 : 0);
}
