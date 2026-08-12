// ============================================================
//   Live updates (SSE) — the doorbell rings when something changes.
//   Needs the API on :5001.  Run: node server/test/events.integration.mjs
// ============================================================
import { config } from "dotenv"; config({ path: "server/.env" });
import fs from "fs/promises"; import path from "path";
import bcrypt from "bcryptjs";
import { PDFDocument } from "pdf-lib";
const { initDb, query, execute } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
await initDb();

const B = "http://127.0.0.1:5001";
const fail = []; const ck = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fail.push(m); };
const SIGS = "server/uploads/signatures";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const doc = await PDFDocument.create(); doc.addPage([595, 842]);
const pdf = Buffer.from(await doc.save());

const clean = async () => {
  for (const r of await query("SELECT id FROM requests WHERE requestor_id = 'u_ev_r'")) {
    await execute("DELETE FROM notifications WHERE request_id=?", [r.id]);
    await execute("DELETE FROM requests WHERE id=?", [r.id]);
  }
  await execute("DELETE FROM user_signatures WHERE user_id IN ('u_ev_r','u_ev_a')");
  await execute("DELETE FROM users WHERE id IN ('u_ev_r','u_ev_a')");
};
await clean();
const now = Date.now();
for (const [id, name, role] of [["u_ev_r", "Ev Raiser", "requestor"], ["u_ev_a", "Ev Approver", "approver"]]) {
  await fs.writeFile(path.join(SIGS, id + ".png"), PNG);
  await execute(
    "INSERT INTO users (id,email,password_hash,name,role,created_at,active,signature_path,signature_aspect) VALUES (?,?,?,?,?,?,1,?,1)",
    [id, id + "@hqhb.in", bcrypt.hashSync("x", 4), name, role, now, id + ".png"]);
}

// ---------- 1. a ticket opens the stream; garbage does not ----------
const bad = await fetch(B + "/api/events?ticket=garbage");
ck(bad.status === 401, "a junk ticket is refused (" + bad.status + ")");

const tRes = await fetch(B + "/api/events/ticket", { method: "POST", headers: { Authorization: "Bearer " + signToken("u_ev_a") } });
const { ticket } = await tRes.json();
ck(tRes.status === 200 && !!ticket, "the approver gets a stream ticket");

const stream = await fetch(B + "/api/events?ticket=" + encodeURIComponent(ticket));
ck(stream.status === 200 && (stream.headers.get("content-type") || "").includes("text/event-stream"), "the stream opens as text/event-stream");
ck(stream.headers.get("x-accel-buffering") === "no", "nginx buffering is disabled per-response");

const reader = stream.body.getReader();
const dec = new TextDecoder();
let buf = "";
const readUntil = async (needle, ms) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (buf.includes(needle)) return true;
    const race = await Promise.race([
      reader.read(),
      new Promise(res => setTimeout(() => res({ timeout: true }), Math.max(50, deadline - Date.now()))),
    ]);
    if (race.timeout) break;
    if (race.done) break;
    buf += dec.decode(race.value, { stream: true });
  }
  return buf.includes(needle);
};
ck(await readUntil("data: hello", 5000), "the stream greets on connect");

// ---------- 2. creating a request rings the approver's doorbell ----------
const fd = new FormData();
fd.append("file", new Blob([pdf], { type: "application/pdf" }), "Live Update.pdf");
fd.append("direct", "true");
fd.append("signers", JSON.stringify([{ userId: "u_ev_a", boxes: [{ page: 1, x: 40, y: 70, w: 22, h: 6 }], dateFields: [] }]));
const c = await fetch(B + "/api/requests", { method: "POST", headers: { Authorization: "Bearer " + signToken("u_ev_r") }, body: fd });
ck(c.status === 200, "request created (" + c.status + ")");
ck(await readUntil("data: changed", 10000),
   "*** the approver's stream received 'changed' without any polling ***");

reader.cancel().catch(() => {});
console.log(fail.length ? `\n${fail.length} check(s) failed` : "\nLIVE UPDATES E2E PASSED");
await clean();
for (const u of ["u_ev_r", "u_ev_a"]) await fs.unlink(path.join(SIGS, u + ".png")).catch(() => {});
process.exit(fail.length ? 1 : 0);
