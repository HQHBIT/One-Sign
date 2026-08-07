// Verifies the whose-turn rules against a REAL hydrated API payload, not a fixture.
// Reproduces the reported case: 1st signer signs, request moves to the 2nd signer,
// and must leave the 1st signer's pending list.
import { config } from "dotenv"; config({ path: "server/.env" });
import fs from "fs/promises"; import path from "path"; import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import { PDFDocument } from "pdf-lib";
const { initDb, query, queryOne, execute } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
const { isMyTurn, nextPendingSigner } = await import("../../client/src/lib/turn.js");
await initDb();

const B = "http://localhost:5001";
const fail = []; const ck = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fail.push(m); };
const __dir = path.dirname(fileURLToPath(import.meta.url));
const SIGS = path.join(__dir, "..", "uploads", "signatures");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
await fs.mkdir(SIGS, { recursive: true });

const pdfDoc = await PDFDocument.create(); pdfDoc.addPage([595, 842]);
const pdfBytes = Buffer.from(await pdfDoc.save());

const clean = async () => {
  for (const r of await query("SELECT id FROM requests WHERE file_name = 'turn-test.pdf'")) {
    await execute("DELETE FROM notifications WHERE request_id=?", [r.id]);
    await execute("DELETE FROM requests WHERE id=?", [r.id]);
  }
  await execute("DELETE FROM signing_authority WHERE team_id = 't_turn'");
  await execute("DELETE FROM users WHERE id IN ('u_t1','u_t2','u_tr')");
  await execute("DELETE FROM teams WHERE id = 't_turn'");
};
await clean();

const now = Date.now();
await execute("INSERT INTO teams (id,name,created_at) VALUES ('t_turn','Turn Team',?)", [now]);
for (const [id, name] of [["u_t1", "First Signer"], ["u_t2", "Second Signer"], ["u_tr", "The Raiser"]]) {
  await fs.writeFile(path.join(SIGS, id + ".png"), PNG);
  await execute(
    "INSERT INTO users (id,email,password_hash,name,role,team_id,created_at,active,signature_path,signature_aspect) VALUES (?,?,?,?,'executive','t_turn',?,1,?,1)",
    [id, id + ".turn@hqhb.in", bcrypt.hashSync("x", 4), name, now, id + ".png"]);
}
await execute("INSERT INTO signing_authority (user_id, team_id) VALUES ('u_t1','t_turn')");
await execute("INSERT INTO signing_authority (user_id, team_id) VALUES ('u_t2','t_turn')");
const T = (id) => signToken(id);

// Two signers, one step, explicit sequence — exactly the screenshot's shape.
const fd = new FormData();
fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "turn-test.pdf");
fd.append("workflow", JSON.stringify([{ teamId: "t_turn", signers: [
  { userId: "u_t1", boxes: [{ page: 1, x: 20, y: 60, w: 22, h: 6 }], dateFields: [] },
  { userId: "u_t2", boxes: [{ page: 1, x: 60, y: 60, w: 22, h: 6 }], dateFields: [] }] }]));
const c = await fetch(B + "/api/requests", { method: "POST", headers: { Authorization: "Bearer " + T("u_tr") }, body: fd });
ck(c.status === 200, "created two-signer workflow (" + c.status + ")");
const id = (await c.json()).request.id;

// How the CLIENT sees it, straight from the API.
const listAs = async (uid) => {
  const r = await fetch(B + "/api/requests", { headers: { Authorization: "Bearer " + T(uid) } });
  return (await r.json()).requests;
};
const findIt = (rows) => rows.find(r => r.id === id);
const authority = ["t_turn"];

// --- before anyone signs ---
let mine1 = findIt(await listAs("u_t1")), mine2 = findIt(await listAs("u_t2"));
ck(!!mine1 && !!mine2, "both signers can see the request");
ck(nextPendingSigner(mine1)?.userName === "First Signer", "API says it waits on the 1st signer");
ck(isMyTurn(mine1, "u_t1", authority) === true, "before signing: 1st signer's turn");
ck(isMyTurn(mine2, "u_t2", authority) === false, "before signing: NOT the 2nd signer's turn");

// --- 1st signer approves ---
const a = await fetch(B + "/api/requests/" + id + "/approve", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + T("u_t1") },
  body: JSON.stringify({ instant: true }) });
ck(a.status === 200, "1st signer approved (" + a.status + ")");

mine1 = findIt(await listAs("u_t1")); mine2 = findIt(await listAs("u_t2"));
ck(mine1?.status === "pending", "request is still open overall");
ck(nextPendingSigner(mine1)?.userName === "Second Signer", "API now says it waits on the 2nd signer");
ck(isMyTurn(mine1, "u_t1", authority) === false,
   "*** THE BUG: after signing, it is NO LONGER in the 1st signer's pending list ***");
ck(isMyTurn(mine2, "u_t2", authority) === true, "after signing: it IS the 2nd signer's turn");

// --- 2nd signer approves: done for everyone ---
const a2 = await fetch(B + "/api/requests/" + id + "/approve", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + T("u_t2") },
  body: JSON.stringify({ instant: true }) });
ck(a2.status === 200, "2nd signer approved (" + a2.status + ")");
mine1 = findIt(await listAs("u_t1")); mine2 = findIt(await listAs("u_t2"));
ck(mine1?.status === "approved", "request is finalised");
ck(isMyTurn(mine1, "u_t1", authority) === false && isMyTurn(mine2, "u_t2", authority) === false,
   "finalised: pending for nobody");

console.log(fail.length ? `\n${fail.length} check(s) failed` : "\nLIVE-DATA TURN CHECK PASSED");
await clean();
for (const u of ["u_t1", "u_t2", "u_tr"]) await fs.unlink(path.join(SIGS, u + ".png")).catch(() => {});
process.exit(fail.length ? 1 : 0);
