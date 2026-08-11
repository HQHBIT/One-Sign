// ============================================================
//   Batch notification — one summary email per signer, every document named.
//   Needs the API on :5001.  Run: node server/test/notify-batch.integration.mjs
// ============================================================
import { config } from "dotenv"; config({ path: "server/.env" });
import fs from "fs/promises"; import path from "path";
import bcrypt from "bcryptjs";
import { PDFDocument } from "pdf-lib";
const { initDb, query, queryOne, execute } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
await initDb();

const B = "http://127.0.0.1:5001";
const fail = []; const ck = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fail.push(m); };
const SIGS = "server/uploads/signatures";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const doc = await PDFDocument.create(); doc.addPage([595, 842]);
const pdf = Buffer.from(await doc.save());

const clean = async () => {
  for (const r of await query("SELECT id FROM requests WHERE requestor_id = 'u_nb_r'")) {
    await execute("DELETE FROM notifications WHERE request_id=?", [r.id]);
    await execute("DELETE FROM requests WHERE id=?", [r.id]);
  }
  await execute("DELETE FROM user_signatures WHERE user_id IN ('u_nb_r','u_nb_a','u_nb_b')");
  await execute("DELETE FROM users WHERE id IN ('u_nb_r','u_nb_a','u_nb_b')");
};
await clean();

const now = Date.now();
for (const [id, name, role] of [["u_nb_r", "Nb Raiser", "requestor"], ["u_nb_a", "Nb Alpha", "approver"], ["u_nb_b", "Nb Beta", "approver"]]) {
  await fs.writeFile(path.join(SIGS, id + ".png"), PNG);
  await execute(
    "INSERT INTO users (id,email,password_hash,name,role,created_at,active,signature_path,signature_aspect) VALUES (?,?,?,?,?,?,1,?,1)",
    [id, id + "@hqhb.in", bcrypt.hashSync("x", 4), name, role, now, id + ".png"]);
}
const auth = { Authorization: "Bearer " + signToken("u_nb_r") };

const mk = async (fileName, signerId) => {
  const fd = new FormData();
  fd.append("file", new Blob([pdf], { type: "application/pdf" }), fileName);
  fd.append("direct", "true");
  fd.append("deferNotify", "true");
  fd.append("signers", JSON.stringify([{ userId: signerId, boxes: [{ page: 1, x: 40, y: 70, w: 22, h: 6 }], dateFields: [] }]));
  const c = await fetch(B + "/api/requests", { method: "POST", headers: auth, body: fd });
  if (c.status !== 200) throw new Error(fileName + " -> " + c.status + " " + (await c.text()).slice(0, 160));
  return (await c.json()).request.id;
};

// Two documents to Alpha, one to Beta — a mixed batch.
const t0 = Date.now();
const idA1 = await mk("Budget Sheet Q3.pdf", "u_nb_a");
const idA2 = await mk("Vendor Contract.pdf", "u_nb_a");
const idB1 = await mk("Petty Cash Note.pdf", "u_nb_b");

// ---------- 1. deferNotify held everything back ----------
let mails = await query("SELECT * FROM emails WHERE to_email IN ('u_nb_a@hqhb.in','u_nb_b@hqhb.in') AND sent_at >= ?", [t0]);
ck(mails.length === 0, "no per-document email went out during creation (deferNotify)");
let bells = await query("SELECT * FROM notifications WHERE user_id IN ('u_nb_a','u_nb_b') AND created_at >= ?", [t0]);
ck(bells.length === 0, "no in-app notice yet either");

// ---------- 2. the summary ----------
const r = await fetch(B + "/api/requests/notify-batch", {
  method: "POST", headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ ids: [idA1, idA2, idB1] }) });
const body = await r.json();
ck(r.status === 200 && body.notified === 2, "one notice per signer (" + JSON.stringify(body) + ")");

// Alpha: ONE batch email naming BOTH documents.
const aMails = await query("SELECT * FROM emails WHERE to_email='u_nb_a@hqhb.in' AND sent_at >= ?", [t0]);
ck(aMails.length === 1, "Alpha got exactly ONE email, not two (" + aMails.length + ")");
ck(aMails[0]?.template === "new_request_batch", "…using the batch template (" + aMails[0]?.template + ")");
ck(/2 documents need your signature/.test(aMails[0]?.subject || ""), "…subject carries the count");
ck((aMails[0]?.body || "").includes("Budget Sheet Q3.pdf") && (aMails[0]?.body || "").includes("Vendor Contract.pdf"),
   "*** BOTH document names, as uploaded, are in the email ***");
ck(/Review & sign/.test(aMails[0]?.body || ""), "…with the Review option");

// Beta: a single-document batch reads like the classic notice.
const bMails = await query("SELECT * FROM emails WHERE to_email='u_nb_b@hqhb.in' AND sent_at >= ?", [t0]);
ck(bMails.length === 1 && bMails[0].template === "new_request", "Beta's single document uses the classic email");
ck((bMails[0]?.body || "").includes("Petty Cash Note.pdf"), "…named after the uploaded file");

// In-app: one bell item for Alpha listing both names.
bells = await query("SELECT * FROM notifications WHERE user_id='u_nb_a' AND created_at >= ?", [t0]);
ck(bells.length === 1 && /2 documents/.test(bells[0].title), "Alpha's bell shows one combined notice");
ck(/Budget Sheet Q3\.pdf/.test(bells[0]?.body || ""), "…listing the names");

// ---------- 3. only the raiser's own pending requests count ----------
const again = await fetch(B + "/api/requests/notify-batch", {
  method: "POST", headers: { Authorization: "Bearer " + signToken("u_nb_a"), "Content-Type": "application/json" },
  body: JSON.stringify({ ids: [idA1, idA2] }) });
const againBody = await again.json();
ck(again.status === 200 && againBody.requests === 0, "someone else cannot re-announce another person's batch");

console.log(fail.length ? `\n${fail.length} check(s) failed` : "\nBATCH NOTIFICATION E2E PASSED");
await clean();
for (const u of ["u_nb_r", "u_nb_a", "u_nb_b"]) await fs.unlink(path.join(SIGS, u + ".png")).catch(() => {});
process.exit(fail.length ? 1 : 0);
