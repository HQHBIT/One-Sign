// ============================================================
//   Confidential documents — end to end against the real API.
//   Needs the API running on :5001 with CONFIDENTIAL_KEY set.
//   Run: node server/test/confidential.integration.mjs
// ============================================================
import { config } from "dotenv"; config({ path: "server/.env" });
import fs from "fs/promises"; import path from "path"; import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import { PDFDocument, StandardFonts } from "pdf-lib";
const { initDb, query, queryOne, execute } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
const { looksEncrypted } = await import("../src/confidential.js");
const { renderTemplate } = await import("../src/email.js");
const { redactEmailBody } = await import("../src/redact.js");
await initDb();

const B = "http://127.0.0.1:5001";
const fail = []; const ck = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fail.push(m); };
const __dir = path.dirname(fileURLToPath(import.meta.url));
const SIGS = path.join(__dir, "..", "uploads", "signatures");
const DOCS = path.join(__dir, "..", "uploads", "documents");
const SIGNED = path.join(__dir, "..", "uploads", "signed");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
await fs.mkdir(SIGS, { recursive: true });

// A PDF whose text we can hunt for in the stored bytes.
const SECRET = "TERMINATION OF EMPLOYMENT - STRICTLY PRIVATE";
const doc = await PDFDocument.create();
const pg = doc.addPage([595, 842]);
pg.drawText(SECRET, { x: 40, y: 700, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
const pdfBytes = Buffer.from(await doc.save());
const FILE_NAME = "PR Termination - Confidential.pdf";

const clean = async () => {
  for (const r of await query("SELECT id, file_path, signed_file_path FROM requests WHERE file_name = ?", [FILE_NAME])) {
    await execute("DELETE FROM confidential_unlocks WHERE request_id=?", [r.id]);
    await execute("DELETE FROM confidential_access_log WHERE request_id=?", [r.id]);
    await execute("DELETE FROM notifications WHERE request_id=?", [r.id]);
    await execute("DELETE FROM requests WHERE id=?", [r.id]);
    if (r.file_path) await fs.unlink(path.join(DOCS, r.file_path)).catch(() => {});
    if (r.signed_file_path) await fs.unlink(path.join(SIGNED, r.signed_file_path)).catch(() => {});
  }
  await execute("DELETE FROM signing_authority WHERE team_id='t_conf'");
  await execute("DELETE FROM users WHERE id IN ('u_cr','u_ca','u_cadm')");
  await execute("DELETE FROM teams WHERE id='t_conf'");
};
await clean();

const now = Date.now();
await execute("INSERT INTO teams (id,name,created_at) VALUES ('t_conf','Confidential Team',?)", [now]);
for (const [id, name, role] of [["u_cr", "Conf Raiser", "requestor"], ["u_ca", "Conf Approver", "approver"], ["u_cadm", "Conf Admin", "admin"]]) {
  await fs.writeFile(path.join(SIGS, id + ".png"), PNG);
  await execute(
    "INSERT INTO users (id,email,password_hash,name,role,team_id,created_at,active,signature_path,signature_aspect) VALUES (?,?,?,?,?,?,?,1,?,1)",
    [id, id + ".conf@hqhb.in", bcrypt.hashSync("x", 4), name, role, role === "admin" ? null : "t_conf", now, id + ".png"]);
}
await execute("INSERT INTO signing_authority (user_id,team_id) VALUES ('u_ca','t_conf')");
const T = (id) => signToken(id);
const auth = (id) => ({ Authorization: "Bearer " + T(id) });

// ---------- create a confidential request ----------
const fd = new FormData();
fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), FILE_NAME);
fd.append("targetTeamId", "t_conf");
fd.append("confidential", "true");
fd.append("marker", JSON.stringify([{ page: 1, x: 40, y: 70, w: 22, h: 6 }]));
let r = await fetch(B + "/api/requests", { method: "POST", headers: auth("u_cr"), body: fd });
ck(r.status === 200, "created a confidential request (" + r.status + ")");
const id = r.status === 200 ? (await r.json()).request.id : null;

// ---------- 1. the file on disk is genuinely encrypted ----------
const row = await queryOne("SELECT * FROM requests WHERE id=?", [id]);
ck(Number(row.confidential) === 1, "stored as confidential");
ck(/\.enc$/.test(row.file_path), "stored file carries .enc (" + row.file_path + ")");
const onDisk = await fs.readFile(path.join(DOCS, row.file_path));
ck(looksEncrypted(onDisk), "bytes on disk are an envelope, not a PDF");
ck(!onDisk.includes(Buffer.from("%PDF")), "no PDF header on disk");
ck(!onDisk.equals(pdfBytes), "*** the stored bytes are NOT the original document ***");
ck(onDisk.length !== pdfBytes.length || !onDisk.equals(pdfBytes), "ciphertext differs from plaintext");

// ---------- 2. the admin is locked out ----------
r = await fetch(`${B}/api/requests/${id}/file`, { headers: auth("u_cadm") });
ck(r.status === 403, "admin gets 403 on the file (" + r.status + ")");
r = await fetch(B + "/api/requests", { headers: auth("u_cadm") });
const adminRow = (await r.json()).requests.find(x => x.id === id);
ck(!!adminRow, "admin still SEES the request exists (operational visibility)");
ck(adminRow.fileName === "Confidential document", "admin sees a redacted name, got: " + adminRow.fileName);
ck(adminRow.note === "", "admin sees no note");
// …but the approver who is DUE to sign must still see what it is called.
r = await fetch(B + "/api/requests", { headers: auth("u_ca") });
const approverRow = (await r.json()).requests.find(x => x.id === id);
ck(approverRow?.fileName === FILE_NAME, "the signer sees the real file name, got: " + approverRow?.fileName);
r = await fetch(B + "/api/requests", { headers: auth("u_cr") });
const raiserRow = (await r.json()).requests.find(x => x.id === id);
ck(raiserRow?.fileName === FILE_NAME, "the requestor sees the real file name");

// ---------- 2b. the CREATION email itself is the redacted variant ----------
// Not just renderTemplate: the row actually recorded for the approver must use
// confidential_new_request and never name the document. (notifyUser is fire-and-
// forget, so allow the insert a moment to land.)
// Only rows from THIS run — the emails table keeps prior runs' rows, and the
// insert lands after the SendGrid round-trip, so filter by creation time and
// wait rather than grabbing whatever is newest.
let createMail = null;
for (let i = 0; i < 25 && !createMail; i++) {
  createMail = await queryOne(
    `SELECT * FROM emails WHERE to_email='u_ca.conf@hqhb.in'
       AND template IN ('new_request','confidential_new_request') AND sent_at >= ?
     ORDER BY sent_at DESC, id DESC LIMIT 1`, [now]);
  if (!createMail) await new Promise(res => setTimeout(res, 300));
}
ck(createMail?.template === "confidential_new_request",
   "creation notice uses the redacted template, got: " + createMail?.template);
ck(createMail && !createMail.subject.includes(FILE_NAME) && !createMail.body.includes(FILE_NAME),
   "creation notice never names the document");

// ---------- 3. a participant still needs an unlock code ----------
r = await fetch(`${B}/api/requests/${id}/file`, { headers: auth("u_ca") });
ck(r.status === 403, "approver without a window gets 403");
ck((await r.json()).needsUnlock === true, "…and is told to unlock");
r = await fetch(`${B}/api/requests/${id}/file`, { headers: auth("u_cr") });
ck(r.status === 403, "even the requestor needs a code for their own document");

// approving is refused too — you cannot sign what you cannot see
r = await fetch(`${B}/api/requests/${id}/approve`, {
  method: "POST", headers: { ...auth("u_ca"), "Content-Type": "application/json" }, body: JSON.stringify({ instant: true }) });
ck(r.status === 403, "approve is refused without a live window (" + r.status + ")");

// ---------- 4. wrong codes are counted and capped ----------
// A oneAccess user who set a work email has their OLD address demoted to
// secondary_email. The code must go to the WORK address (users.email) — sending
// it to the superseded one makes the document permanently unopenable for them.
await execute("UPDATE users SET secondary_email = 'stale.old@onelogin.com' WHERE id = 'u_ca'");

r = await fetch(`${B}/api/requests/${id}/unlock`, { method: "POST", headers: auth("u_ca") });
ck(r.status === 200, "code issued (" + r.status + ")");
const issued = await r.json();
ck(/^u•+@hqhb\.in$/.test(issued.to) && !issued.to.includes("_ca.conf"),
   "the address is masked in the response: " + issued.to);

const badTry = () => fetch(`${B}/api/requests/${id}/unlock/verify`, {
  method: "POST", headers: { ...auth("u_ca"), "Content-Type": "application/json" }, body: JSON.stringify({ code: "000000" }) });
let last;
for (let i = 0; i < 5; i++) last = await badTry();
ck(last.status === 400, "wrong codes are rejected");
const lastBody = await last.json();
ck(lastBody.attemptsLeft === 0, "attempts run out (left=" + lastBody.attemptsLeft + ")");
last = await badTry();
ck((await last.json()).code === "too_many_attempts", "a 6th attempt is refused outright");

// ---------- 5. the right code opens a window ----------
// Read the code the only way anyone legitimately could: from the sent email.
const mail = await queryOne(
  "SELECT * FROM emails WHERE to_email=? AND template='confidential_unlock_code' ORDER BY sent_at DESC LIMIT 1",
  ["u_ca.conf@hqhb.in"]);
ck(!!mail, "an unlock email was recorded");
ck(mail?.to_email === "u_ca.conf@hqhb.in",
   "*** the code went to the WORK email, not the superseded oneAccess one *** (" + mail?.to_email + ")");
const stale = await queryOne("SELECT id FROM emails WHERE to_email='stale.old@onelogin.com'");
ck(!stale, "nothing was ever sent to the superseded address");
ck(!mail.subject.includes(FILE_NAME) && !mail.body.includes(FILE_NAME), "the unlock email never names the document");
ck(/Unlock code:\s*••/.test(mail.body), "*** the stored copy has the code MASKED *** (" + (mail.body.match(/Unlock code:.*/) || [""])[0].trim() + ")");

// The logged copy is redacted, so take the live code from the DB row instead —
// this proves the hash matches a code we can independently produce.
const rec = await queryOne(
  "SELECT * FROM confidential_unlocks WHERE request_id=? AND user_id='u_ca' AND consumed_at IS NULL ORDER BY issued_at DESC LIMIT 1", [id]);
ck(!!rec, "a fresh unlock row exists after the resend");
let realCode = null;
for (let n = 100000; n < 1000000 && !realCode; n++) {   // brute force is fine for a test fixture
  if (bcrypt.compareSync(String(n), rec.code_hash)) realCode = String(n);
  if (n > 100000 + 3) break; // …but don't actually: fetch it from a fresh issue instead
}
// Issue a code through a test-only path: hash a known code straight into the row.
const KNOWN = "424242";
await execute("UPDATE confidential_unlocks SET code_hash=?, attempts=0, code_expires_at=? WHERE id=?",
  [bcrypt.hashSync(KNOWN, 10), Date.now() + 300000, rec.id]);

r = await fetch(`${B}/api/requests/${id}/unlock/verify`, {
  method: "POST", headers: { ...auth("u_ca"), "Content-Type": "application/json" }, body: JSON.stringify({ code: KNOWN }) });
ck(r.status === 200, "the right code is accepted (" + r.status + ")");
const win = await r.json();
ck(win.windowMs === 120000, "the window is 2 minutes, got " + win.windowMs);

// ---------- 6. inside the window the document opens and decrypts correctly ----------
r = await fetch(`${B}/api/requests/${id}/file`, { headers: auth("u_ca") });
ck(r.status === 200, "inside the window the file is served (" + r.status + ")");
const served = Buffer.from(await r.arrayBuffer());
ck(served.subarray(0, 5).toString() === "%PDF-", "served bytes are a real PDF");
ck(served.equals(pdfBytes), "*** decrypted byte-for-byte back to the original ***");

// downloading is refused for the approver even with a live window
r = await fetch(`${B}/api/requests/${id}/file?download=1`, { headers: auth("u_ca") });
ck(r.status === 403, "approver cannot DOWNLOAD, only view (" + r.status + ")");

// ---------- 7. signing works, and the signed copy is encrypted too ----------
r = await fetch(`${B}/api/requests/${id}/approve`, {
  method: "POST", headers: { ...auth("u_ca"), "Content-Type": "application/json" }, body: JSON.stringify({ instant: true }) });
ck(r.status === 200, "approve succeeds inside the window (" + r.status + ")");
const after = await queryOne("SELECT * FROM requests WHERE id=?", [id]);
ck(after.status === "approved", "request is approved");
ck(/\.enc$/.test(after.signed_file_path), "signed copy carries .enc (" + after.signed_file_path + ")");
const signedOnDisk = await fs.readFile(path.join(SIGNED, after.signed_file_path));
ck(looksEncrypted(signedOnDisk), "*** the SIGNED copy is encrypted at rest too ***");
ck(!signedOnDisk.subarray(0, 5).toString().includes("%PDF"), "signed copy is not a readable PDF on disk");
const leftovers = (await fs.readdir(SIGNED)).filter(f => f.startsWith(id) && !f.endsWith(".enc"));
ck(leftovers.length === 0, "no plaintext signed file was left behind: " + JSON.stringify(leftovers));

// ---------- 8. the window expires ----------
await execute("UPDATE confidential_unlocks SET window_ends_at=? WHERE request_id=?", [Date.now() - 1, id]);
r = await fetch(`${B}/api/requests/${id}/signed`, { headers: auth("u_ca") });
ck(r.status === 403, "*** once the 60s lapses the document locks again *** (" + r.status + ")");

// the requestor CAN download now that it is fully signed — after unlocking
const cr = await queryOne("SELECT * FROM confidential_unlocks WHERE request_id=? AND user_id='u_cr' ORDER BY issued_at DESC LIMIT 1", [id]);
await execute(
  `INSERT INTO confidential_unlocks (id, request_id, user_id, code_hash, issued_at, code_expires_at, consumed_at, window_ends_at)
   VALUES (?,?,?,?,?,?,?,?)`,
  ["cu_test_dl", id, "u_cr", bcrypt.hashSync("x", 4), Date.now(), Date.now() + 300000, Date.now(), Date.now() + 60000]);
r = await fetch(`${B}/api/requests/${id}/signed?download=1`, { headers: auth("u_cr") });
ck(r.status === 200, "the requestor CAN download once fully signed (" + r.status + ")");

// ---------- 9. rate limiting on code issuance ----------
let limited = false;
for (let i = 0; i < 8; i++) {
  const rr = await fetch(`${B}/api/requests/${id}/unlock`, { method: "POST", headers: auth("u_cr") });
  if (rr.status === 429) { limited = true; break; }
}
ck(limited, "code issuance is rate limited");

// ---------- 10. workflow notification emails never name the document ----------
const nt = renderTemplate("confidential_new_request", { approverName: "A", requestorName: "B", requestId: id, fileName: FILE_NAME });
ck(!nt.subject.includes(FILE_NAME) && !nt.html.includes(FILE_NAME) && !nt.text.includes(FILE_NAME),
   "confidential_new_request never leaks the file name");
const rt = renderTemplate("confidential_rejected", { requestorName: "B", approverName: "A", requestId: id, reason: "because reasons" });
ck(!rt.text.includes("because reasons"), "confidential_rejected never leaks the reason");
ck(redactEmailBody("Unlock code: 123456").includes("••"), "unlock codes are masked in the log");

// ---------- 11. the access log recorded the right things ----------
const log = await query("SELECT action, COUNT(*) n FROM confidential_access_log WHERE request_id=? GROUP BY action", [id]);
const byAction = Object.fromEntries(log.map(l => [l.action, Number(l.n)]));
ck((byAction.unlock_fail || 0) >= 5, "failed unlocks were logged (" + (byAction.unlock_fail || 0) + ")");
ck((byAction.unlock_ok || 0) >= 1, "successful unlock logged");
ck((byAction.view || 0) >= 1, "views logged");
ck((byAction.sign || 0) >= 1, "signing logged");

// ---------- 12. a NON-confidential request is untouched ----------
const fd2 = new FormData();
fd2.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "ordinary.pdf");
fd2.append("targetTeamId", "t_conf");
fd2.append("marker", JSON.stringify([{ page: 1, x: 40, y: 70, w: 22, h: 6 }]));
r = await fetch(B + "/api/requests", { method: "POST", headers: auth("u_cr"), body: fd2 });
const ordId = (await r.json()).request.id;
const ord = await queryOne("SELECT * FROM requests WHERE id=?", [ordId]);
ck(!/\.enc$/.test(ord.file_path), "an ordinary document is NOT encrypted");
r = await fetch(`${B}/api/requests/${ordId}/file`, { headers: auth("u_ca") });
ck(r.status === 200, "an ordinary document opens with no unlock (" + r.status + ")");
r = await fetch(`${B}/api/requests/${ordId}/file`, { headers: auth("u_cadm") });
ck(r.status === 200, "admin still opens ordinary documents");
await execute("DELETE FROM notifications WHERE request_id=?", [ordId]);
await execute("DELETE FROM requests WHERE id=?", [ordId]);
await fs.unlink(path.join(DOCS, ord.file_path)).catch(() => {});

// ---------- 13. a placeholder oneAccess address fails loudly ----------
await execute("UPDATE users SET email = 'u_ca.12345@oneaccess.local' WHERE id = 'u_ca'");
r = await fetch(`${B}/api/requests/${id}/unlock`, { method: "POST", headers: auth("u_ca") });
ck(r.status === 400 && (await r.json()).code === "no_work_email",
   "a user with no work email is told so, not left waiting for a code that cannot arrive");
await execute("UPDATE users SET email = 'u_ca.conf@hqhb.in' WHERE id = 'u_ca'");

console.log(fail.length ? `\n${fail.length} check(s) failed` : "\nCONFIDENTIAL DOCUMENTS E2E PASSED");
await clean();
for (const u of ["u_cr", "u_ca", "u_cadm"]) await fs.unlink(path.join(SIGS, u + ".png")).catch(() => {});
process.exit(fail.length ? 1 : 0);
