// Supporting documents that nobody signs — request attachments.
//
//   node test/attachments.integration.mjs      (from server/, MySQL running)
//
// Verifies: the feature is HQHB-only (404 on a WAQF box); only the requestor may
// attach, and only while the request is pending; whoever may see the request may
// see its attachments; an unrelated user may not; confidentiality is inherited
// from the parent rather than claimed by the caller; the cap is enforced; and
// deleting removes it. Spawns its own APIs on spare ports.
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..");
config({ path: path.join(SERVER, ".env") });

const PORT = 5000 + 170 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;
const WAQF_PORT = PORT + 5;
const WAQF_BASE = `http://127.0.0.1:${WAQF_PORT}`;
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
const REQ = `u_att_req_${T}`, APP = `u_att_app_${T}`, OTHER = `u_att_oth_${T}`;
const RID = `req_att_${T}`, RID_DONE = `req_attd_${T}`, RID_CONF = `req_attc_${T}`;

const auth = (id) => ({ Authorization: "Bearer " + signToken(id) });
const hdr = (id) => ({ ...auth(id), "Content-Type": "application/json" });
const j = async r => { try { return await r.json(); } catch { return {}; } };

// A small payload. Attachments are never parsed or baked — they are stored and
// handed back untouched — so the bytes need not be a real PDF.
const BYTES = Buffer.from("%PDF-1.4 attachment test payload\n");
const form = (name, bytes) => {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: "application/pdf" }), name);
  return fd;
};
const post = (base, rid, who, name = "quotation.pdf", bytes = BYTES) =>
  fetch(`${base}/api/requests/${rid}/attachments`, { method: "POST", headers: auth(who), body: form(name, bytes) });

const cleanup = async () => {
  await execute("DELETE FROM request_attachments WHERE request_id IN (?,?,?)", [RID, RID_DONE, RID_CONF]).catch(() => {});
  await execute("DELETE FROM requests WHERE id IN (?,?,?)", [RID, RID_DONE, RID_CONF]).catch(() => {});
  await execute("DELETE FROM users WHERE id IN (?,?,?)", [REQ, APP, OTHER]).catch(() => {});
};

let hqhb = null, waqf = null;
try {
  await cleanup();
  const mk = (id, nm, role) => execute(
    "INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, active, org_id) VALUES (?,?,?,?,?,NULL,?,1,'hqhb')",
    [id, `${id}@hqhb.test`, bcrypt.hashSync("x", 4), nm, role, now]);
  await mk(REQ, "Att Requestor", "requestor");
  await mk(APP, "Att Approver", "approver");
  await mk(OTHER, "Unrelated Person", "requestor");

  const mkReq = (id, status, confidential) => execute(
    `INSERT INTO requests (id, requestor_id, file_name, file_path, file_type, status, created_at, org_id, approver_id, confidential)
     VALUES (?,?,?,?,'pdf',?,?, 'hqhb', ?, ?)`,
    [id, REQ, "main.pdf", "nonexistent.pdf", status, now, APP, confidential]);
  await mkReq(RID, "pending", 0);
  await mkReq(RID_DONE, "approved", 0);
  await mkReq(RID_CONF, "pending", 1);

  // Serially on purpose. Both APIs run runSchema() on boot, and two of them
  // migrating the same database at once deadlocks on an ALTER — the second only
  // starts once the first is up and the schema is settled.
  hqhb = startApi(PORT, { ORG_SLUG: "hqhb" });
  await waitFor(BASE, hqhb);
  waqf = startApi(WAQF_PORT, { ORG_SLUG: "waqf" });
  await waitFor(WAQF_BASE, waqf);

  // 1-2. HQHB only: the WAQF box does not reveal the routes at all.
  ck((await fetch(`${WAQF_BASE}/api/requests/${RID}/attachments`, { headers: hdr(REQ) })).status === 404,
    "WAQF box: GET attachments is 404 (feature absent, not refused)");
  ck((await post(WAQF_BASE, RID, REQ)).status === 404,
    "WAQF box: POST attachment is 404");

  // The attachments router is mounted on /api/requests, the SAME path as
  // requests.js. Gating it with router.use() would have run the HQHB check for
  // every request route and 404'd the whole requests API on WAQF. This is the
  // check that would have caught that.
  const waqfList = await fetch(`${WAQF_BASE}/api/requests`, { headers: hdr(REQ) });
  ck(waqfList.status === 200, "WAQF box: the rest of /api/requests still works");

  // 3-4. The requestor attaches to their own pending request.
  const up = await post(BASE, RID, REQ);
  const upBody = await j(up);
  ck(up.status === 200 && upBody.attachment?.id, "requestor attaches to own pending request");
  ck(upBody.attachment?.fileName === "quotation.pdf" && upBody.attachment?.fileType === "pdf",
    "attachment keeps its original file name and type");
  const attId = upBody.attachment?.id;

  // 5. Listing shows it.
  const list = await j(await fetch(`${BASE}/api/requests/${RID}/attachments`, { headers: hdr(REQ) }));
  ck(Array.isArray(list.attachments) && list.attachments.length === 1, "requestor lists one attachment");

  // 6. Someone else may not attach to it.
  ck((await post(BASE, RID, OTHER)).status === 403, "a non-requestor cannot attach");

  // 7. Not after approval — a document must not appear under a signature already given.
  ck((await post(BASE, RID_DONE, REQ)).status === 400, "cannot attach to an approved request");

  // 8-9. The approver can see and read it.
  const appList = await fetch(`${BASE}/api/requests/${RID}/attachments`, { headers: hdr(APP) });
  ck(appList.status === 200 && (await j(appList)).attachments?.length === 1, "the approver can list attachments");
  const dl = await fetch(`${BASE}/api/requests/${RID}/attachments/${attId}/file`, { headers: auth(APP) });
  const got = Buffer.from(await dl.arrayBuffer());
  ck(dl.status === 200 && got.equals(BYTES), "the approver downloads the attachment byte-for-byte");

  // 10. An unrelated user cannot.
  ck((await fetch(`${BASE}/api/requests/${RID}/attachments`, { headers: hdr(OTHER) })).status === 403,
    "an unrelated user cannot list attachments");

  // 11. Confidentiality comes from the parent, not the caller.
  const cup = await j(await post(BASE, RID_CONF, REQ, "secret.pdf"));
  const confRow = await query("SELECT confidential FROM request_attachments WHERE id = ?", [cup.attachment?.id]);
  ck(Number(confRow[0]?.confidential) === 1, "an attachment on a confidential request is stored confidential");

  // 12. The cap holds.
  for (let i = 2; i <= 5; i++) await post(BASE, RID, REQ, `extra${i}.pdf`);
  ck((await post(BASE, RID, REQ, "sixth.pdf")).status === 400, "a sixth attachment is refused");

  // 13. Deleting while pending removes it.
  const del = await fetch(`${BASE}/api/requests/${RID}/attachments/${attId}`, { method: "DELETE", headers: hdr(REQ) });
  const after = await j(await fetch(`${BASE}/api/requests/${RID}/attachments`, { headers: hdr(REQ) }));
  ck(del.status === 200 && !after.attachments?.some(a => a.id === attId), "the requestor deletes an attachment while pending");
} finally {
  hqhb?.kill(); waqf?.kill();
  await cleanup();
}

for (const p of pass) console.log("PASS  " + p);
for (const f of fail) console.log("FAIL  " + f);
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
