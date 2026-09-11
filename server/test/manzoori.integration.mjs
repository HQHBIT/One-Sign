// Sending a signed document on for Manzoori, and what the approver then sees.
//
//   MANZOORI_ENABLED=true node --env-file=.env test/manzoori.integration.mjs
//
// Needs the API running on :5001, started from THIS build with the feature on.
//
// The sanction itself happens outside SignFlow, so there is little to test about
// the sending — and a great deal to test about the rules around it. A record
// that a document went for Manzoori is read by the person who signed it as a
// fact; it must not be possible to create one for a document nobody has signed,
// to create two, or to create one for somebody else's document.
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { initDb, execute, query, queryOne } from "../src/db.js";
import { signToken } from "../src/auth.js";

const B = process.env.TEST_BASE_URL || "http://127.0.0.1:5001";
await initDb();

const now = Date.now();
const ids = ["u_mz_r", "u_mz_a", "u_mz_o"];
const clean = async () => {
  await query("DELETE FROM requests WHERE requestor_id IN ('u_mz_r','u_mz_o')");
  await query("DELETE FROM signing_authority WHERE team_id = 't_mz'");
  await query(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  await query("DELETE FROM teams WHERE id = 't_mz'");
};
await clean();

await execute("INSERT INTO teams (id,name,created_at) VALUES ('t_mz','Manzoori Probe',?)", [now]);
const hash = bcrypt.hashSync("x", 4);
for (const [id, email, name, role] of [
  ["u_mz_r", "mz.masool@demo.local", "Masool", "requestor"],
  ["u_mz_a", "mz.hod@demo.local", "Head of Department", "approver"],
  ["u_mz_o", "mz.other@demo.local", "Another Masool", "requestor"],
]) {
  await execute(
    "INSERT INTO users (id,email,password_hash,name,role,team_id,created_at,active,signature_path,signature_aspect) VALUES (?,?,?,?,?,?,?,1,?,3)",
    [id, email, hash, name, role, "t_mz", now, "u_mz_a.png"]);
}
await execute("INSERT INTO signing_authority (user_id,team_id) VALUES ('u_mz_a','t_mz')");
const auth = (id) => ({ Authorization: "Bearer " + signToken(id) });
const json = (id) => ({ ...auth(id), "Content-Type": "application/json" });

const pdfBytes = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "latin1");

async function raise(who = "u_mz_r", fileName = "Jamiat letter.pdf") {
  const fd = new FormData();
  fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), fileName);
  fd.append("targetTeamId", "t_mz");
  fd.append("marker", JSON.stringify([{ page: 1, x: 40, y: 70, w: 22, h: 6 }]));
  const r = await fetch(B + "/api/requests", { method: "POST", headers: auth(who), body: fd });
  assert.equal(r.status, 200, `raised ${fileName}`);
  return (await r.json()).request.id;
}

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);

const send = (id, who, body) =>
  fetch(`${B}/api/requests/${id}/manzoori`, { method: "POST", headers: json(who), body: JSON.stringify(body || {}) });

// ---- it cannot be sent before the HOD has signed it ----
const waiting = await raise();
{
  const r = await send(waiting, "u_mz_r");
  ck(r.status === 400, `an unsigned document cannot go for Manzoori (${r.status})`);
  const row = await queryOne("SELECT manzoori_sent_at FROM requests WHERE id = ?", [waiting]);
  ck(row.manzoori_sent_at === null, "and nothing is recorded against it");
}

// ---- signed, then sent ----
const signed = await raise("u_mz_r", "Sanction request.pdf");
await execute("UPDATE requests SET status='approved', approver_id='u_mz_a', approved_at=? WHERE id=?", [Date.now(), signed]);
{
  const r = await send(signed, "u_mz_r", { note: "Handed to the Jamiat office" });
  ck(r.status === 200, `the requestor sends it on (${r.status})`);

  const row = await queryOne("SELECT * FROM requests WHERE id = ?", [signed]);
  ck(!!row.manzoori_sent_at, "the sending is recorded");
  ck(row.manzoori_sent_by === "u_mz_r", "against the person who sent it");
  ck(row.manzoori_note === "Handed to the Jamiat office", "with what they wrote");
  ck(row.status === "approved", "and the document's own status is untouched");
}

// ---- the rules around it ----
{
  const again = await send(signed, "u_mz_r");
  ck(again.status === 400, `it cannot be sent twice (${again.status})`);

  const other = await raise("u_mz_r", "Someone elses.pdf");
  await execute("UPDATE requests SET status='approved', approver_id='u_mz_a' WHERE id=?", [other]);
  const trespass = await send(other, "u_mz_o");
  ck(trespass.status === 403, `another Masool cannot send a document they did not raise (${trespass.status})`);
  ck((await queryOne("SELECT manzoori_sent_at FROM requests WHERE id=?", [other])).manzoori_sent_at === null,
    "and nothing is recorded when they try");
}

// ---- the approver can see it, which is the point ----
{
  const list = await (await fetch(B + "/api/requests", { headers: auth("u_mz_a") })).json();
  const seen = (list.requests || []).find((x) => x.id === signed);
  ck(!!seen, "the document reaches the approver who signed it");
  ck(seen && !!seen.manzooriSentAt, "carrying the fact that it went for Manzoori");
  ck(seen && seen.manzooriSentByName === "Masool", `and who sent it (${seen && seen.manzooriSentByName})`);
  const stillWaiting = (list.requests || []).find((x) => x.id === waiting);
  ck(!stillWaiting?.manzooriSentAt, "while one that has not gone shows nothing");
}

// ---- undo, for the wrong document ----
{
  const r = await fetch(`${B}/api/requests/${signed}/manzoori`, { method: "DELETE", headers: auth("u_mz_r") });
  ck(r.status === 200, `the sender can undo it (${r.status})`);
  const row = await queryOne("SELECT manzoori_sent_at, manzoori_note FROM requests WHERE id=?", [signed]);
  ck(row.manzoori_sent_at === null && row.manzoori_note === null, "and the record is fully cleared");

  const notMine = await fetch(`${B}/api/requests/${signed}/manzoori`, { method: "DELETE", headers: auth("u_mz_o") });
  ck(notMine.status === 400 || notMine.status === 403, `someone else cannot undo it (${notMine.status})`);
}

for (const p of pass) console.log("  PASS  " + p);
for (const f of fail) console.log("  FAIL  " + f);
await clean();
console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
