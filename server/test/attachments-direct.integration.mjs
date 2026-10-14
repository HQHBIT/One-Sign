// Can the person who actually has to sign see the attachment?
//
//   node test/attachments-direct.integration.mjs      (from server/, MySQL running)
//
// The batch flow creates DIRECT requests: the signer is a row in
// request_step_signers, not requests.approver_id. attachments.integration.mjs
// granted access the easy way (approver_id), which never exercised the branch of
// authoriseAccess the real flow depends on. This builds the request exactly as
// MultiDocFlow does — POST /api/requests with direct + signers — and then asks
// whether that signer can list and read the attachment.
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import { PDFDocument } from "pdf-lib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..");
config({ path: path.join(SERVER, ".env") });

const PORT = 5000 + 190 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;
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
  console.log(child.log); throw new Error("API did not start");
}

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);
const T = Date.now().toString(36), now = Date.now();
const REQ = `u_ad_req_${T}`, SIGNER = `u_ad_sig_${T}`;
const auth = (id) => ({ Authorization: "Bearer " + signToken(id) });
const hdr = (id) => ({ ...auth(id), "Content-Type": "application/json" });
const j = async r => { try { return await r.json(); } catch { return {}; } };

// The create path bakes the PDF, so it must be a real one.
async function realPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]).drawText("main document");
  return Buffer.from(await doc.save());
}
const ATT = Buffer.from("%PDF-1.4 supporting document\n");

let createdId = null;
const cleanup = async () => {
  if (createdId) {
    await execute("DELETE FROM request_attachments WHERE request_id = ?", [createdId]).catch(() => {});
    await execute("DELETE FROM request_step_signers WHERE step_id IN (SELECT id FROM request_steps WHERE request_id = ?)", [createdId]).catch(() => {});
    await execute("DELETE FROM request_steps WHERE request_id = ?", [createdId]).catch(() => {});
    await execute("DELETE FROM requests WHERE id = ?", [createdId]).catch(() => {});
  }
  await execute("DELETE FROM users WHERE id IN (?,?)", [REQ, SIGNER]).catch(() => {});
};

let api = null;
try {
  await cleanup();
  const mk = (id, nm, role) => execute(
    "INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, active, org_id) VALUES (?,?,?,?,?,NULL,?,1,'hqhb')",
    [id, `${id}@hqhb.test`, bcrypt.hashSync("x", 4), nm, role, now]);
  await mk(REQ, "Batch Requestor", "requestor");
  await mk(SIGNER, "The Approver", "approver");

  api = startApi(PORT, { ORG_SLUG: "hqhb" });
  await waitFor(BASE, api);

  // 1. Create the request the way MultiDocFlow does.
  const fd = new FormData();
  fd.append("file", new Blob([await realPdf()], { type: "application/pdf" }), "main.pdf");
  fd.append("direct", "true");
  fd.append("signers", JSON.stringify([{ userId: SIGNER, boxes: [{ page: 1, x: 10, y: 10, w: 20, h: 8 }], dateFields: [] }]));
  fd.append("deferNotify", "true");
  const created = await j(await fetch(`${BASE}/api/requests`, { method: "POST", headers: auth(REQ), body: fd }));
  createdId = created?.request?.id || null;
  ck(!!createdId, "a direct request is created the way the batch creates it");
  if (!createdId) throw new Error("could not create the request: " + JSON.stringify(created).slice(0, 300));

  // 2. Attach the supporting document to it.
  const afd = new FormData();
  afd.append("file", new Blob([ATT], { type: "application/pdf" }), "supporting.pdf");
  const up = await fetch(`${BASE}/api/requests/${createdId}/attachments`, { method: "POST", headers: auth(REQ), body: afd });
  ck(up.status === 200, "the requestor attaches a supporting document");

  // 3. THE QUESTION: can the person who has to sign see it?
  const asSigner = await fetch(`${BASE}/api/requests/${createdId}/attachments`, { headers: hdr(SIGNER) });
  const body = await j(asSigner);
  ck(asSigner.status === 200, `the signer can LIST attachments (got ${asSigner.status})`);
  ck(Array.isArray(body.attachments) && body.attachments.length === 1,
    `the signer sees the supporting document (saw ${body.attachments?.length ?? "none"})`);

  // 3b. Order is the requestor's, not upload order. Send one that belongs ABOVE
  // the signed document (negative) after one that belongs below, and the list
  // must still come back in the arranged order.
  const afd2 = new FormData();
  afd2.append("file", new Blob([Buffer.from("%PDF-1.4 goes above\n")], { type: "application/pdf" }), "above.pdf");
  afd2.append("sortOrder", "-1");
  await fetch(`${BASE}/api/requests/${createdId}/attachments`, { method: "POST", headers: auth(REQ), body: afd2 });
  const ordered = await j(await fetch(`${BASE}/api/requests/${createdId}/attachments`, { headers: hdr(SIGNER) }));
  const names = (ordered.attachments || []).map(a => a.fileName);
  const orders = (ordered.attachments || []).map(a => a.sortOrder);
  ck(names[0] === "above.pdf", `the document arranged above comes first (got ${JSON.stringify(names)})`);
  ck(orders[0] === -1 && orders[1] === 1, `positions round-trip (got ${JSON.stringify(orders)})`);

  // 4. And read it.
  const atts = body.attachments || [];
  if (atts[0]) {
    const dl = await fetch(`${BASE}/api/requests/${createdId}/attachments/${atts[0].id}/file`, { headers: auth(SIGNER) });
    const got = Buffer.from(await dl.arrayBuffer());
    ck(dl.status === 200 && got.equals(ATT), "the signer can open the supporting document");
  } else {
    ck(false, "the signer can open the supporting document (no attachment listed)");
  }
} finally {
  api?.kill();
  await cleanup();
}

for (const p of pass) console.log("PASS  " + p);
for (const f of fail) console.log("FAIL  " + f);
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
