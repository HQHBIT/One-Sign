// Does a confidential document open WITHOUT the emailed unlock code?
//
// This exists because the code was suspended at the owner's request while
// executives could not open confidential documents at all. It proves the two
// things that matter about that change: the document really does open, and the
// protections that were NOT suspended really are still in force.
//
//   node --env-file=.env test/confidential-no-otp.integration.mjs
//
// Needs the API running on :5001.
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
const ids = ["u_no_r", "u_no_a", "u_no_adm"];
const clean = async () => {
  await query("DELETE FROM requests WHERE requestor_id IN ('u_no_r')");
  await query("DELETE FROM signing_authority WHERE team_id='t_nootp'");
  await query(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  await query("DELETE FROM teams WHERE id='t_nootp'");
};
await clean();

await execute("INSERT INTO teams (id,name,created_at) VALUES ('t_nootp','No-OTP Team',?)", [now]);
const hash = bcrypt.hashSync("x", 4);
for (const [id, email, name, role] of [
  ["u_no_r", "nootp.req@demo.local", "Requestor", "requestor"],
  ["u_no_a", "nootp.app@demo.local", "Approver", "approver"],
  ["u_no_adm", "nootp.adm@demo.local", "IT Admin", "admin"],
]) {
  await execute(
    "INSERT INTO users (id,email,password_hash,name,role,team_id,created_at,active,signature_path,signature_aspect) VALUES (?,?,?,?,?,?,?,1,?,1)",
    [id, email, hash, name, role, "t_nootp", now, "u_no_a.png"]);
}
await execute("INSERT INTO signing_authority (user_id,team_id) VALUES ('u_no_a','t_nootp')");
const auth = (id) => ({ Authorization: "Bearer " + signToken(id) });

// A real, minimal PDF so the bytes coming back can be recognised.
const pdfBytes = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "latin1");

const fd = new FormData();
fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "Board Minutes.pdf");
fd.append("targetTeamId", "t_nootp");
fd.append("confidential", "true");
fd.append("marker", JSON.stringify([{ page: 1, x: 40, y: 70, w: 22, h: 6 }]));

let r = await fetch(B + "/api/requests", { method: "POST", headers: auth("u_no_r"), body: fd });
assert.equal(r.status, 200, "confidential request created");
const id = (await r.json()).request.id;

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);

// ---- THE POINT: it opens with no unlock code at all ----
{
  r = await fetch(`${B}/api/requests/${id}/file`, { headers: auth("u_no_a") });
  ck(r.status === 200, `approver opens it with NO unlock code (${r.status})`);
  if (r.status === 200) {
    const body = Buffer.from(await r.arrayBuffer());
    ck(body.subarray(0, 5).toString() === "%PDF-", "and receives a real, decrypted PDF");
    ck(!looksEncrypted(body), "not the encrypted envelope");
  }
  const unlocks = await queryOne(
    "SELECT COUNT(*) AS n FROM confidential_unlocks WHERE request_id = ?", [id]);
  ck(Number(unlocks.n) === 0, "no unlock was issued or consumed to get there");
}

// ---- and everything that was NOT suspended is still in force ----
{
  const onDisk = await fs.readFile(diskPathFor("documents", (await queryOne(
    "SELECT file_path FROM requests WHERE id=?", [id])).file_path));
  ck(looksEncrypted(onDisk), "still encrypted at rest on disk");
  ck(!onDisk.includes(Buffer.from("%PDF-")), "plaintext never touches the disk");

  r = await fetch(`${B}/api/requests/${id}/file`, { headers: auth("u_no_adm") });
  ck(r.status === 403, `IT Admin is still locked out (${r.status})`);

  r = await fetch(`${B}/api/requests/${id}/file?download=1`, { headers: auth("u_no_a") });
  ck(r.status === 403, `approver still cannot DOWNLOAD a copy (${r.status})`);

  const list = await (await fetch(B + "/api/requests", { headers: auth("u_no_adm") })).json();
  const seen = (list.requests || []).find(x => x.id === id);
  ck(seen && seen.fileName !== "Board Minutes.pdf",
    `IT Admin still sees a redacted name (${seen ? seen.fileName : "not visible"})`);

  const stranger = await fetch(`${B}/api/requests/${id}/file`, { headers: auth("u_no_r") });
  ck(stranger.status === 200, "the requestor can still read their own document");
}

for (const p of pass) console.log("  PASS  " + p);
for (const f of fail) console.log("  FAIL  " + f);
await clean();
console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
