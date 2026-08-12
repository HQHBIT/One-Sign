// ============================================================
//   Multiple tagged signatures — CRUD, defaults, and signing with a chosen one.
//   Needs the API running on :5001.  Run: node server/test/signatures.integration.mjs
// ============================================================
import { config } from "dotenv"; config({ path: "server/.env" });
import fs from "fs/promises"; import path from "path"; import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import { PDFDocument } from "pdf-lib";
const { initDb, query, queryOne, execute } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
await initDb();

const B = "http://127.0.0.1:5001";
const fail = []; const ck = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fail.push(m); };
const __dir = path.dirname(fileURLToPath(import.meta.url));
const SIGS = path.join(__dir, "..", "uploads", "signatures");
const DOCS = path.join(__dir, "..", "uploads", "documents");
const SIGNED = path.join(__dir, "..", "uploads", "signed");
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG = Buffer.from(PNG_B64, "base64");
const DATA_URL = "data:image/png;base64," + PNG_B64;
await fs.mkdir(SIGS, { recursive: true });

const clean = async () => {
  for (const r of await query("SELECT id, file_path, signed_file_path FROM requests WHERE requestor_id = 'u_sg_r'")) {
    await execute("DELETE FROM notifications WHERE request_id=?", [r.id]);
    await execute("DELETE FROM requests WHERE id=?", [r.id]);
    if (r.file_path) await fs.unlink(path.join(DOCS, r.file_path)).catch(() => {});
    if (r.signed_file_path) await fs.unlink(path.join(SIGNED, r.signed_file_path)).catch(() => {});
  }
  for (const s of await query("SELECT file_path FROM user_signatures WHERE user_id IN ('u_sg_a','u_sg_b','u_sg_r')")) {
    await fs.unlink(path.join(SIGS, s.file_path)).catch(() => {});
  }
  await execute("DELETE FROM user_signatures WHERE user_id IN ('u_sg_a','u_sg_b','u_sg_r')");
  await execute("DELETE FROM signing_authority WHERE team_id = 't_sg'");
  await execute("DELETE FROM users WHERE id IN ('u_sg_a','u_sg_b','u_sg_r')");
  await execute("DELETE FROM teams WHERE id = 't_sg'");
};
await clean();

const now = Date.now();
await execute("INSERT INTO teams (id,name,created_at) VALUES ('t_sg','Sig Team',?)", [now]);
// A has a LEGACY single signature (file + users row, no table rows) — the
// migration case. B is a bystander whose signature must be unusable by A.
for (const [id, name, role] of [["u_sg_a", "Sig Approver", "approver"], ["u_sg_b", "Sig Other", "approver"], ["u_sg_r", "Sig Raiser", "requestor"]]) {
  await fs.writeFile(path.join(SIGS, id + ".png"), PNG);
  await execute(
    "INSERT INTO users (id,email,password_hash,name,role,team_id,created_at,active,signature_path,signature_aspect) VALUES (?,?,?,?,?,'t_sg',?,1,?,1)",
    [id, id + "@hqhb.in", bcrypt.hashSync("x", 4), name, role, now, id + ".png"]);
}
await execute("INSERT INTO signing_authority (user_id,team_id) VALUES ('u_sg_a','t_sg')");
const auth = (id) => ({ Authorization: "Bearer " + signToken(id), "Content-Type": "application/json" });
const J = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });

// ---------- 1. lazy migration ----------
let r = await J(await fetch(B + "/api/users/me/signatures", { headers: auth("u_sg_a") }));
ck(r.status === 200 && r.body.signatures.length === 1, "legacy signature migrates into the list");
ck(r.body.signatures[0].isDefault === true, "…as the default");
ck(r.body.signatures[0].label === "My signature", "…labelled 'My signature'");
const legacyId = r.body.signatures[0].id;

// ---------- 2. add a second, tagged ----------
r = await J(await fetch(B + "/api/users/me/signatures", { method: "POST", headers: auth("u_sg_a"), body: JSON.stringify({ dataUrl: DATA_URL, label: "Official" }) }));
ck(r.status === 200, "added a second signature tagged 'Official' (" + r.status + ")");
const officialId = r.body.signature?.id;
ck(r.body.signature?.isDefault === false, "the new one is NOT default — the first stays");

r = await J(await fetch(B + "/api/users/me/signatures", { method: "POST", headers: auth("u_sg_a"), body: JSON.stringify({ dataUrl: DATA_URL, label: "official" }) }));
ck(r.status === 400, "duplicate tag (case-insensitive) is rejected");
r = await J(await fetch(B + "/api/users/me/signatures", { method: "POST", headers: auth("u_sg_a"), body: JSON.stringify({ dataUrl: DATA_URL }) }));
ck(r.status === 400, "a tag is required");

// ---------- 3. cap at 5 ----------
for (const l of ["Three", "Four", "Five"]) {
  await fetch(B + "/api/users/me/signatures", { method: "POST", headers: auth("u_sg_a"), body: JSON.stringify({ dataUrl: DATA_URL, label: l }) });
}
r = await J(await fetch(B + "/api/users/me/signatures", { method: "POST", headers: auth("u_sg_a"), body: JSON.stringify({ dataUrl: DATA_URL, label: "Six" }) }));
ck(r.status === 400, "a sixth signature is refused (cap 5)");

// ---------- 4. make another the default -> users row follows ----------
r = await J(await fetch(B + "/api/users/me/signatures/" + officialId, { method: "PUT", headers: auth("u_sg_a"), body: JSON.stringify({ makeDefault: true }) }));
ck(r.status === 200 && r.body.signature.isDefault === true, "'Official' becomes the default");
const offRow = await queryOne("SELECT file_path FROM user_signatures WHERE id=?", [officialId]);
const uRow = await queryOne("SELECT signature_path FROM users WHERE id='u_sg_a'");
ck(uRow.signature_path === offRow.file_path, "users.signature_path follows the default — every legacy path uses it");

// ---------- 5. image access is own-only ----------
ck((await fetch(B + "/api/users/me/signatures/" + officialId + "/image", { headers: auth("u_sg_a") })).status === 200, "owner can fetch the image");
ck((await fetch(B + "/api/users/me/signatures/" + officialId + "/image", { headers: auth("u_sg_b") })).status === 404, "someone else cannot");

// ---------- 6. approve with a CHOSEN (non-default) signature ----------
const doc = await PDFDocument.create(); doc.addPage([595, 842]);
const pdf = Buffer.from(await doc.save());
const mkReq = async () => {
  const fd = new FormData();
  fd.append("file", new Blob([pdf], { type: "application/pdf" }), "sig-pick.pdf");
  fd.append("targetTeamId", "t_sg");
  fd.append("marker", JSON.stringify([{ page: 1, x: 40, y: 70, w: 22, h: 6 }]));
  const c = await fetch(B + "/api/requests", { method: "POST", headers: { Authorization: "Bearer " + signToken("u_sg_r") }, body: fd });
  return (await c.json()).request.id;
};

let reqId = await mkReq();
r = await J(await fetch(B + `/api/requests/${reqId}/approve`, { method: "POST", headers: auth("u_sg_a"), body: JSON.stringify({ instant: true, signatureId: legacyId }) }));
ck(r.status === 200, "approved with the chosen (non-default) signature (" + r.status + ")");
let reqRow = await queryOne("SELECT applied_signature_path FROM requests WHERE id=?", [reqId]);
const legacyRow = await queryOne("SELECT file_path FROM user_signatures WHERE id=?", [legacyId]);
ck(reqRow.applied_signature_path === legacyRow.file_path,
   "*** the CHOSEN signature was stamped, not the default *** (" + reqRow.applied_signature_path + ")");

// ---------- 7. no signatureId -> the default applies ----------
reqId = await mkReq();
r = await J(await fetch(B + `/api/requests/${reqId}/approve`, { method: "POST", headers: auth("u_sg_a"), body: JSON.stringify({ instant: true }) }));
ck(r.status === 200, "approved with no signatureId (" + r.status + ")");
reqRow = await queryOne("SELECT applied_signature_path FROM requests WHERE id=?", [reqId]);
ck(reqRow.applied_signature_path === offRow.file_path, "…and the DEFAULT was stamped");

// ---------- 8. someone else's signature is refused ----------
const bList = await J(await fetch(B + "/api/users/me/signatures", { headers: auth("u_sg_b") }));
const bSigId = bList.body.signatures[0].id;
reqId = await mkReq();
r = await J(await fetch(B + `/api/requests/${reqId}/approve`, { method: "POST", headers: auth("u_sg_a"), body: JSON.stringify({ instant: true, signatureId: bSigId }) }));
ck(r.status === 400, "another user's signatureId is rejected (" + r.status + ")");

// ---------- 9. deleting the default promotes another and users row follows ----------
r = await J(await fetch(B + "/api/users/me/signatures/" + officialId, { method: "DELETE", headers: auth("u_sg_a") }));
ck(r.status === 200, "deleted the default");
const after = await J(await fetch(B + "/api/users/me/signatures", { headers: auth("u_sg_a") }));
const newDef = after.body.signatures.find(s => s.isDefault);
ck(!!newDef && newDef.id !== officialId, "another signature was promoted to default");
const u2 = await queryOne("SELECT signature_path FROM users WHERE id='u_sg_a'");
const defRow = await queryOne("SELECT file_path FROM user_signatures WHERE id=?", [newDef.id]);
ck(u2.signature_path === defRow.file_path, "users.signature_path follows the promotion");

// ---------- 10. SECURITY: signature images are owner-or-admin only ----------
// Being signed in must NOT allow harvesting other people's signatures — the
// exact forgery risk this system exists to prevent. Foreign requests get the
// same 404 an absent signature produces (no probing oracle).
await execute("DELETE FROM users WHERE id='u_sg_adm'");
await execute("INSERT INTO users (id,email,password_hash,name,role,created_at,active) VALUES ('u_sg_adm','u_sg_adm@hqhb.in',?,'Sig Admin','admin',?,1)", [bcrypt.hashSync("x", 4), Date.now()]);

r = { status: (await fetch(B + "/api/users/u_sg_a/signature", { headers: { Authorization: "Bearer " + signToken("u_sg_b") } })).status };
ck(r.status === 404, "*** another APPROVER cannot fetch my signature image *** (" + r.status + ")");
r = { status: (await fetch(B + "/api/users/u_sg_a/signature", { headers: { Authorization: "Bearer " + signToken("u_sg_r") } })).status };
ck(r.status === 404, "*** a REQUESTOR cannot fetch an approver's signature image *** (" + r.status + ")");
r = { status: (await fetch(B + "/api/users/u_sg_a/signature", { headers: { Authorization: "Bearer " + signToken("u_sg_a") } })).status };
ck(r.status === 200, "the owner still fetches their own (" + r.status + ")");
r = { status: (await fetch(B + "/api/users/u_sg_a/signature", { headers: { Authorization: "Bearer " + signToken("u_sg_adm") } })).status };
ck(r.status === 200, "the admin still fetches it for the Signatures page (" + r.status + ")");
r = { status: (await fetch(B + "/api/users/u_sg_nonexistent/signature", { headers: { Authorization: "Bearer " + signToken("u_sg_b") } })).status };
ck(r.status === 404, "foreign and nonexistent are indistinguishable (both 404)");
await execute("DELETE FROM users WHERE id='u_sg_adm'");

console.log(fail.length ? `\n${fail.length} check(s) failed` : "\nMULTIPLE SIGNATURES E2E PASSED");
await clean();
process.exit(fail.length ? 1 : 0);
