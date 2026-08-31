// Does a confidential document require the emailed unlock code again?
//
// This replaces the test that proved the opposite. The code was suspended on
// 2026-08-31 because executives could not open confidential documents; that
// turned out to be a key the server no longer held, failing well after this
// gate, so the suspension was restored the same day. What this file has to
// prove is that the restoration is real and complete — not just that the flag
// flipped, but that each of the three gates is closed and that the one legal
// way through it still works.
//
//   node --env-file=.env test/confidential-otp.integration.mjs
//
// Needs the API running on :5001, started from THIS build — UNLOCK_REQUIRED is
// read once at module load, so a server left running from the suspended build
// will fail these tests for the wrong reason.
//
// The emailed code is never readable from here (only its bcrypt hash is stored,
// and email delivery is out of scope), so the test issues a real code through
// the real endpoint and then overwrites the stored hash with one it knows. The
// verification path itself — expiry, attempt counting, window opening — runs
// exactly as it does in production.
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { initDb, execute, query, queryOne } from "../src/db.js";
import { signToken } from "../src/auth.js";
import { looksEncrypted } from "../src/confidential.js";
import { diskPathFor } from "../src/filestore.js";
import fs from "node:fs/promises";

const B = process.env.TEST_BASE_URL || "http://127.0.0.1:5001";
await initDb();

const now = Date.now();
const ids = ["u_otp_r", "u_otp_a", "u_otp_adm"];
const clean = async () => {
  await query("DELETE FROM requests WHERE requestor_id IN ('u_otp_r')");
  await query("DELETE FROM signing_authority WHERE team_id='t_otp'");
  await query(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  await query("DELETE FROM teams WHERE id='t_otp'");
};
await clean();

await execute("INSERT INTO teams (id,name,created_at) VALUES ('t_otp','OTP Team',?)", [now]);
const hash = bcrypt.hashSync("x", 4);
for (const [id, email, name, role] of [
  ["u_otp_r", "otp.req@demo.local", "Requestor", "requestor"],
  ["u_otp_a", "otp.app@demo.local", "Approver", "approver"],
  ["u_otp_adm", "otp.adm@demo.local", "IT Admin", "admin"],
]) {
  await execute(
    "INSERT INTO users (id,email,password_hash,name,role,team_id,created_at,active,signature_path,signature_aspect) VALUES (?,?,?,?,?,?,?,1,?,1)",
    [id, email, hash, name, role, "t_otp", now, "u_otp_a.png"]);
}
await execute("INSERT INTO signing_authority (user_id,team_id) VALUES ('u_otp_a','t_otp')");
const auth = (id) => ({ Authorization: "Bearer " + signToken(id) });
const json = (id) => ({ ...auth(id), "Content-Type": "application/json" });

// A real, minimal PDF so the bytes coming back can be recognised.
const pdfBytes = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "latin1");

const fd = new FormData();
fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "Board Minutes.pdf");
fd.append("targetTeamId", "t_otp");
fd.append("confidential", "true");
fd.append("marker", JSON.stringify([{ page: 1, x: 40, y: 70, w: 22, h: 6 }]));

let r = await fetch(B + "/api/requests", { method: "POST", headers: auth("u_otp_r"), body: fd });
assert.equal(r.status, 200, "confidential request created");
const id = (await r.json()).request.id;

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);

// ---- THE POINT: the gate is closed again ----
{
  r = await fetch(`${B}/api/requests/${id}/file`, { headers: auth("u_otp_a") });
  ck(r.status === 403, `approver is refused without a code (${r.status})`);
  const body = await r.json().catch(() => ({}));
  // The client needs this flag to show the unlock prompt rather than an error.
  ck(body.needsUnlock === true, "and is told it needs unlocking, not merely denied");

  // The requestor's own document is gated too — this gate is about proving who
  // is at the keyboard, which applies to everyone on the route.
  r = await fetch(`${B}/api/requests/${id}/file`, { headers: auth("u_otp_r") });
  ck(r.status === 403, `the requestor is refused too (${r.status})`);
}

// ---- and the one legal way through it works ----
{
  r = await fetch(`${B}/api/requests/${id}/unlock`, { method: "POST", headers: json("u_otp_a") });
  ck(r.status === 200, `a code can be requested (${r.status})`);

  const rec = await queryOne(
    "SELECT * FROM confidential_unlocks WHERE request_id=? AND user_id='u_otp_a' ORDER BY issued_at DESC LIMIT 1", [id]);
  ck(!!rec, "an unlock row was issued");
  ck(rec && rec.consumed_at === null, "and is not yet consumed");

  // Substitute a hash we know. Everything downstream is the real endpoint.
  await execute("UPDATE confidential_unlocks SET code_hash=? WHERE id=?", [bcrypt.hashSync("123456", 4), rec.id]);

  r = await fetch(`${B}/api/requests/${id}/unlock/verify`, {
    method: "POST", headers: json("u_otp_a"), body: JSON.stringify({ code: "000000" }) });
  ck(r.status === 400, `a wrong code is rejected (${r.status})`);
  const after = await queryOne("SELECT attempts FROM confidential_unlocks WHERE id=?", [rec.id]);
  ck(Number(after.attempts) === 1, "and is counted against the attempt limit");

  // Still shut after a failed attempt.
  r = await fetch(`${B}/api/requests/${id}/file`, { headers: auth("u_otp_a") });
  ck(r.status === 403, `a failed attempt opens nothing (${r.status})`);

  r = await fetch(`${B}/api/requests/${id}/unlock/verify`, {
    method: "POST", headers: json("u_otp_a"), body: JSON.stringify({ code: "123456" }) });
  ck(r.status === 200, `the right code is accepted (${r.status})`);
  const v = await r.json().catch(() => ({}));
  ck(Number(v.windowEndsAt) > Date.now(), "and opens a window that is still open");

  r = await fetch(`${B}/api/requests/${id}/file`, { headers: auth("u_otp_a") });
  ck(r.status === 200, `the document then opens (${r.status})`);
  if (r.status === 200) {
    const body = Buffer.from(await r.arrayBuffer());
    ck(body.subarray(0, 5).toString() === "%PDF-", "and is a real, decrypted PDF");
    ck(!looksEncrypted(body), "not the encrypted envelope");
  }
}

// ---- everything the gate was never responsible for is still in force ----
{
  const onDisk = await fs.readFile(diskPathFor("documents", (await queryOne(
    "SELECT file_path FROM requests WHERE id=?", [id])).file_path));
  ck(looksEncrypted(onDisk), "still encrypted at rest on disk");
  ck(!onDisk.includes(Buffer.from("%PDF-")), "plaintext never touches the disk");

  // An unlocked window is not a download permit, and never was.
  r = await fetch(`${B}/api/requests/${id}/file?download=1`, { headers: auth("u_otp_a") });
  ck(r.status === 403, `an unlocked approver still cannot DOWNLOAD a copy (${r.status})`);

  // The IT Admin is locked out in code, so no code can ever let them in.
  r = await fetch(`${B}/api/requests/${id}/unlock`, { method: "POST", headers: json("u_otp_adm") });
  ck(r.status === 403, `IT Admin cannot even request a code (${r.status})`);
  r = await fetch(`${B}/api/requests/${id}/file`, { headers: auth("u_otp_adm") });
  ck(r.status === 403, `IT Admin is still locked out (${r.status})`);

  const list = await (await fetch(B + "/api/requests", { headers: auth("u_otp_adm") })).json();
  const seen = (list.requests || []).find(x => x.id === id);
  ck(seen && seen.fileName !== "Board Minutes.pdf",
    `IT Admin still sees a redacted name (${seen ? seen.fileName : "not visible"})`);
}

for (const p of pass) console.log("  PASS  " + p);
for (const f of fail) console.log("  FAIL  " + f);
await clean();
console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
