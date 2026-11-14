// Mapping a stage: what it asks, who holds it, and whether they are emailed.
//
//   node test/ea-stage-mapping.integration.mjs      (from server/, MySQL running)
//
// The behaviour that must not regress is at the bottom: an approval stage that
// names NOBODY still stamps on arrival, exactly as every board built before
// approvals could name anyone. If that breaks, live boards stall.
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import { PDFDocument } from "pdf-lib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..");
config({ path: path.join(SERVER, ".env") });

const PORT = 5000 + 250 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;
const { initDb, execute, query, queryOne } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
await initDb();

function startApi(port, env) {
  const c = spawn(process.execPath, ["src/index.js"], { cwd: SERVER, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), SENDGRID_API_KEY: "", STORAGE_BUCKET: "", ...env } });
  c.log = ""; c.stdout.on("data", d => (c.log += d)); c.stderr.on("data", d => (c.log += d));
  return c;
}
async function waitFor(base, child) {
  for (let i = 0; i < 180; i++) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {} await new Promise(r => setTimeout(r, 500)); }
  console.log(child.log); throw new Error("API did not start");
}

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);
const T = Date.now().toString(36);
const now = Date.now();
const EA = `u_sm_ea_${T}`, EXEC = `u_sm_x_${T}`;
const hdr = (id, json = true) => ({ Authorization: "Bearer " + signToken(id), ...(json ? { "Content-Type": "application/json" } : {}) });
const call = (id, m, url, body) => fetch(`${BASE}${url}`, { method: m, headers: hdr(id), body: body === undefined ? undefined : JSON.stringify(body) });
const j = async (r) => { try { return await r.json(); } catch { return {}; } };

const pdf = await (async () => { const d = await PDFDocument.create(); d.addPage([595, 842]); return Buffer.from(await d.save()); })();
const upload = (boardId, title, stageId) => {
  const fd = new FormData();
  fd.append("file", new Blob([pdf], { type: "application/pdf" }), "paper.pdf");
  fd.append("title", title);
  if (stageId) fd.append("stageId", stageId);
  return fetch(`${BASE}/api/ea-flow/boards/${boardId}/documents`, { method: "POST", headers: hdr(EA, false), body: fd });
};
const emailsTo = async (userId) => {
  const u = await queryOne("SELECT email FROM users WHERE id = ?", [userId]);
  const r = await query("SELECT COUNT(*) c FROM emails WHERE to_email = ?", [u.email]);
  return Number(r[0].c);
};

const cleanup = async () => {
  await execute("DELETE FROM ea_boards WHERE owner_id = ?", [EA]).catch(() => {});
  await execute("DELETE FROM executive_assistants WHERE assistant_id = ?", [EA]).catch(() => {});
  await execute("DELETE FROM users WHERE id IN (?,?)", [EA, EXEC]).catch(() => {});
};

let api = null;
try {
  await cleanup();
  const hash = bcrypt.hashSync("x", 4);
  await execute("INSERT INTO users (id,email,password_hash,name,role,team_id,created_at,active,org_id) VALUES (?,?,?,?,'executive_assistant',NULL,?,1,'hqhb')", [EA, `${EA}@sm.test`, hash, "Mapping Assistant", now]);
  await execute("INSERT INTO users (id,email,password_hash,name,role,team_id,created_at,active,org_id) VALUES (?,?,?,?,'executive',NULL,?,1,'hqhb')", [EXEC, `${EXEC}@sm.test`, hash, "Shabbar BS", now]);
  await execute("INSERT INTO executive_assistants (id,executive_id,assistant_id,can_approve,signature_source,created_at,created_by) VALUES (?,?,?,0,'executive',?,?)", [`ea_${T}`, EXEC, EA, now, EA]);

  api = startApi(PORT, { ORG_SLUG: "hqhb" });
  await waitFor(BASE, api);

  const board = (await j(await call(EA, "POST", "/api/ea-flow/boards", { name: `Mapping ${T}` }))).board;
  const addStage = (body) => call(EA, "POST", `/api/ea-flow/boards/${board.id}/stages`, body);

  // ---- the mapping itself ----
  const bad = await addStage({ name: "Nameless review", kind: "review" });
  ck(bad.status === 400, `a review stage must name somebody (got ${bad.status})`);

  const rev = (await j(await addStage({ name: "Shabbar reads", kind: "review", signerId: EXEC }))).stage;
  ck(rev?.kind === "review" && rev?.holder?.id === EXEC, "a review stage names its holder");
  ck(rev?.notifyHolder === true, "email is on unless it is turned off");
  ck(rev?.waitsForHolder === true, "a review stage says it holds the card");

  const quiet = (await j(await addStage({ name: "Quietly approved", kind: "approval", signerId: EXEC, notifyHolder: false }))).stage;
  ck(quiet?.kind === "approval" && quiet?.holder?.id === EXEC, "an approval stage can name a holder");
  ck(quiet?.notifyHolder === false, "the email switch is stored off");

  const auto = (await j(await addStage({ name: "Auto approved", kind: "approval" }))).stage;
  ck(auto?.kind === "approval" && !auto?.holder, "an approval stage may still name nobody");
  ck(auto?.waitsForHolder === false, "an unheld approval does not hold the card");

  // Somewhere to move TO. There is no GET /boards/:id — the list carries the
  // stages — and the destination must not be the stage the card is already on.
  const done = (await j(await addStage({ name: "Done", kind: "plain" }))).stage;
  const boards = (await j(await call(EA, "GET", "/api/ea-flow/boards"))).boards || [];
  const mine = boards.find((b) => b.id === board.id);
  ck(!!mine && mine.stages.length === 4, `the board lists its four stages (got ${mine?.stages?.length})`);
  const first = done;

  // ---- a review holds the card, and emails ----
  const before = await emailsTo(EXEC);
  const d1 = (await j(await upload(board.id, "For reading", rev.id))).document;
  ck(!!d1, "a document can be filed straight into a review stage");
  const after = await emailsTo(EXEC);
  ck(after === before + 1, `the holder is emailed (${before} → ${after})`);

  const blocked = await call(EA, "POST", `/api/ea-flow/documents/${d1.id}/move`, { toStageId: first.id });
  ck(blocked.status === 409, `the card cannot leave until the holder answers (got ${blocked.status})`);

  const notice = await queryOne("SELECT id FROM ea_cc_notices WHERE document_id = ? AND user_id = ?", [d1.id, EXEC]);
  ck(!!notice, "the ask is recorded as a notice the holder can see");

  const so = await call(EXEC, "POST", `/api/ea-cc/${d1.id}/signoff`, {});
  const soBody = await j(so);
  ck(so.status === 200 && soBody.stamped === false, "the holder signs off, and a review stamps nothing");

  const moved = await call(EA, "POST", `/api/ea-flow/documents/${d1.id}/move`, { toStageId: first.id });
  ck(moved.status === 200, `once answered the card moves (got ${moved.status})`);

  // ---- the switch really does silence the email ----
  const b2 = await emailsTo(EXEC);
  const d2 = (await j(await upload(board.id, "Quiet one", quiet.id))).document;
  const a2 = await emailsTo(EXEC);
  ck(a2 === b2, `with the switch off nobody is emailed (${b2} → ${a2})`);
  const stillAsked = await queryOne("SELECT id FROM ea_cc_notices WHERE document_id = ? AND user_id = ?", [d2.id, EXEC]);
  ck(!!stillAsked, "but the ask is still recorded — the switch governs only the email");

  // a held approval stamps when the holder answers, not on arrival
  const early = await queryOne("SELECT approved_at FROM ea_approvals WHERE document_id = ? AND stage_id = ?", [d2.id, quiet.id]);
  ck(!early, "a held approval does NOT stamp on arrival");
  const so2 = await j(await call(EXEC, "POST", `/api/ea-cc/${d2.id}/signoff`, {}));
  ck(so2.stamped === true, "it stamps when the holder approves");
  const late = await queryOne("SELECT approved_at FROM ea_approvals WHERE document_id = ? AND stage_id = ?", [d2.id, quiet.id]);
  ck(!!late, "and the stamp is on the record");

  // ---- THE REGRESSION GUARD ----
  const d3 = (await j(await upload(board.id, "Straight through", auto.id))).document;
  const stamped = await queryOne("SELECT approved_at FROM ea_approvals WHERE document_id = ? AND stage_id = ?", [d3.id, auto.id]);
  ck(!!stamped, "an approval naming NOBODY still stamps on arrival, as it always has");
  const free = await call(EA, "POST", `/api/ea-flow/documents/${d3.id}/move`, { toStageId: first.id });
  ck(free.status === 200, `and such a card is free to move (got ${free.status})`);
} finally {
  api?.kill();
  await cleanup();
}

for (const p of pass) console.log("PASS  " + p);
for (const f of fail) console.log("FAIL  " + f);
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
