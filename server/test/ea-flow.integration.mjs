// The executive assistant's document flow (HQHB): boards of stages, documents
// moved through them with a timestamped trail, signature stages that raise an
// ordinary request, and a dashboard computed from the trail.
//
//   node test/ea-flow.integration.mjs      (from server/, MySQL running)
//
// Starts its own API on a spare port with email and storage off and ORG_SLUG
// forced to hqhb; a second, short-lived API with ORG_SLUG=waqf proves the
// feature is absent there.
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import { PDFDocument } from "pdf-lib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..");
config({ path: path.join(SERVER, ".env") });

const PORT = 5000 + 100 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;

const { initDb, execute, queryOne, query } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
await initDb();

function startApi(port, orgSlug) {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: SERVER,
    env: { ...process.env, PORT: String(port), SENDGRID_API_KEY: "", STORAGE_BUCKET: "", ORG_SLUG: orgSlug },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.log = "";
  child.stdout.on("data", (d) => { child.log += d; });
  child.stderr.on("data", (d) => { child.log += d; });
  return child;
}
async function waitFor(base, child) {
  for (let i = 0; i < 180; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(child.log); throw new Error("API did not start on " + base);
}
const api = startApi(PORT, "hqhb");
await waitFor(BASE, api);

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);
const T = Date.now().toString(36);
const now = Date.now();
const EA = `u_ef_ea_${T}`, EXEC = `u_ef_exec_${T}`, OTHER_EA = `u_ef_oea_${T}`, REQR = `u_ef_req_${T}`, UNLINKED = `u_ef_unl_${T}`;
const hdr = (id, json = true) => ({ Authorization: "Bearer " + signToken(id), ...(json ? { "Content-Type": "application/json" } : {}) });
const call = (id, method, url, body) => fetch(`${BASE}${url}`, { method, headers: hdr(id), body: body === undefined ? undefined : JSON.stringify(body) });
const j = async (r) => { try { return await r.json(); } catch { return {}; } };

const pdfBytes = await (async () => { const d = await PDFDocument.create(); d.addPage([595, 842]); return Buffer.from(await d.save()); })();
const uploadDoc = (id, boardId, title, note = "") => {
  const fd = new FormData();
  fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "Board paper.pdf");
  fd.append("title", title); if (note) fd.append("note", note);
  return fetch(`${BASE}/api/ea-flow/boards/${boardId}/documents`, { method: "POST", headers: hdr(id, false), body: fd });
};

const cleanup = async () => {
  await execute("DELETE FROM ea_boards WHERE owner_id IN (?, ?)", [EA, OTHER_EA]);
  await execute("DELETE FROM requests WHERE requestor_id = ?", [EA]);
  await execute("DELETE FROM executive_assistants WHERE assistant_id IN (?, ?)", [EA, OTHER_EA]);
  await execute("DELETE FROM users WHERE id IN (?, ?, ?, ?, ?)", [EA, EXEC, OTHER_EA, REQR, UNLINKED]);
};

let waqf = null;
try {
  await cleanup();
  const hash = bcrypt.hashSync("x", 4);
  for (const [id, role, name] of [[EA, "executive_assistant", "Flow Assistant"], [EXEC, "executive", "The Executive"], [OTHER_EA, "executive_assistant", "Other Assistant"], [REQR, "requestor", "A Requestor"], [UNLINKED, "executive", "Unlinked Executive"]]) {
    await execute("INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, active, org_id) VALUES (?, ?, ?, ?, ?, NULL, ?, 1, 'hqhb')", [id, `${id}@flow.test`, hash, name, role, now]);
  }
  await execute("INSERT INTO executive_assistants (id, executive_id, assistant_id, can_approve, signature_source, created_at, created_by) VALUES (?, ?, ?, 0, 'executive', ?, ?)", [`ea_${T}`, EXEC, EA, now, EA]);

  // ---- access ----
  ck((await fetch(`${BASE}/api/ea-flow/boards`)).status === 401, "no session → 401");
  ck((await call(REQR, "GET", "/api/ea-flow/boards")).status === 403, "a requestor → 403");
  let r = await call(EA, "GET", "/api/ea-flow/boards"); let b = await j(r);
  ck(r.status === 200 && Array.isArray(b.boards) && b.boards.length === 0, `a new assistant has no boards (${r.status})`);

  // ---- boards ----
  r = await call(EA, "POST", "/api/ea-flow/boards", { name: "  CEO   papers " }); b = await j(r);
  const BOARD = b.board?.id;
  ck(r.status === 200 && b.board?.name === "CEO papers", "board created with a tidied name");
  ck((await call(EA, "POST", "/api/ea-flow/boards", { name: "ceo papers" })).status === 409, "a second board with the same name is refused");
  ck((await call(EA, "POST", "/api/ea-flow/boards", { name: "" })).status === 400, "a blank name is refused");
  ck((await call(EA, "PUT", `/api/ea-flow/boards/${BOARD}`, { name: "CEO papers 2026" })).status === 200, "board renamed");

  // ---- stages ----
  const addStage = (body) => call(EA, "POST", `/api/ea-flow/boards/${BOARD}/stages`, body);
  r = await addStage({ name: "Received" }); const S_IN = (await j(r)).stage?.id;
  ck(r.status === 200 && !!S_IN, "stage added");
  r = await addStage({ name: "CEO signature", requiresSignature: true, signerId: UNLINKED });
  ck(r.status === 400, `a signature stage naming an executive not linked to this assistant is refused (${r.status})`);
  r = await addStage({ name: "CEO signature", requiresSignature: true, signerId: EXEC }); const S_SIG = (await j(r)).stage?.id;
  ck(r.status === 200 && !!S_SIG, "signature stage added naming the linked executive");
  r = await addStage({ name: "Filed" }); const S_OUT = (await j(r)).stage?.id;
  ck((await addStage({ name: "received" })).status === 409, "duplicate stage name refused");
  r = await call(EA, "PUT", `/api/ea-flow/boards/${BOARD}/stages/order`, { stageIds: [S_IN, S_OUT] });
  ck(r.status === 400, "reordering with a missing stage is refused");
  r = await call(EA, "PUT", `/api/ea-flow/boards/${BOARD}/stages/order`, { stageIds: [S_OUT, S_SIG, S_IN] });
  r = await call(EA, "GET", "/api/ea-flow/boards"); b = await j(r);
  ck(b.boards[0].stages.map((s) => s.id).join() === [S_OUT, S_SIG, S_IN].join(), "stages reordered");
  await call(EA, "PUT", `/api/ea-flow/boards/${BOARD}/stages/order`, { stageIds: [S_IN, S_SIG, S_OUT] });
  b = await j(await call(EA, "GET", "/api/ea-flow/boards"));
  ck(b.boards[0].stages[1].requiresSignature === true && b.boards[0].stages[1].signer?.id === EXEC, "the signature stage reports its executive");

  // ---- documents ----
  r = await uploadDoc(EA, BOARD, "Board paper Q3", "for the CEO"); b = await j(r);
  const DOC = b.document?.id;
  ck(r.status === 200 && b.document?.stageId === S_IN && !!b.document?.enteredStageAt, `a document lands in the first stage (${r.status})`);
  const m0 = await query("SELECT * FROM ea_movements WHERE document_id = ? ORDER BY moved_at", [DOC]);
  ck(m0.length === 1 && m0[0].from_stage_id === null && m0[0].to_stage_id === S_IN && m0[0].moved_by === EA, "intake is the first movement (from nowhere)");
  ck((await call(EA, "DELETE", `/api/ea-flow/stages/${S_IN}`)).status === 409, "a stage holding a document cannot be deleted");
  ck((await call(EA, "DELETE", `/api/ea-flow/boards/${BOARD}`)).status === 409, "a board holding a document cannot be deleted");
  r = await fetch(`${BASE}/api/ea-flow/documents/${DOC}/file`, { headers: hdr(EA, false) });
  ck(r.status === 200 && r.headers.get("content-type")?.includes("pdf") && (await r.arrayBuffer()).byteLength === pdfBytes.length, "the original bytes are served");

  // ---- into a signature stage ----
  r = await call(EA, "POST", `/api/ea-flow/documents/${DOC}/move`, { toStageId: S_SIG });
  ck(r.status === 400, `entering a signature stage without a box is refused (${r.status})`);
  await new Promise((res) => setTimeout(res, 30));
  r = await call(EA, "POST", `/api/ea-flow/documents/${DOC}/move`, { toStageId: S_SIG, boxes: [{ page: 1, x: 10, y: 80, w: 25, h: 8 }] }); b = await j(r);
  ck(r.status === 200 && b.document?.stageId === S_SIG, `entering the signature stage with a box moves the card (${r.status} ${b.error || ""})`);
  const reqRow = await queryOne("SELECT * FROM requests WHERE id = (SELECT request_id FROM ea_documents WHERE id = ?)", [DOC]);
  ck(!!reqRow && reqRow.status === "pending" && reqRow.requestor_id === EA, "…and raises a pending request from the assistant");
  const signer = reqRow && await queryOne("SELECT sg.user_id FROM request_step_signers sg JOIN request_steps st ON st.id = sg.step_id WHERE st.request_id = ?", [reqRow.id]);
  ck(signer?.user_id === EXEC, "…addressed to the stage's executive");
  ck(b.document?.request?.status === "pending" && b.document?.request?.signerName === "The Executive", "the card shows who it is waiting for");
  r = await call(EA, "POST", `/api/ea-flow/documents/${DOC}/move`, { toStageId: S_OUT });
  ck(r.status === 409, `leaving before the signature is refused (${r.status})`);
  ck((await call(EA, "DELETE", `/api/ea-flow/documents/${DOC}`)).status === 409, "deleting while a signature is pending is refused");

  // the executive signs (simulated: status + signed copy on disk, as the signing path would write)
  const signedName = `${reqRow.id}.signed.pdf`;
  fs.mkdirSync(path.join(SERVER, "uploads", "signed"), { recursive: true });
  const signedBytes = Buffer.concat([pdfBytes, Buffer.from("\n% signed copy\n")]);
  fs.writeFileSync(path.join(SERVER, "uploads", "signed", signedName), signedBytes);
  await execute("UPDATE requests SET status = 'approved', approver_id = ?, approved_at = ?, finalized_at = ?, signed_file_path = ? WHERE id = ?", [EXEC, Date.now(), Date.now(), signedName, reqRow.id]);
  b = await j(await call(EA, "GET", `/api/ea-flow/boards/${BOARD}/documents`));
  const card = b.documents?.find((d) => d.id === DOC);
  ck(card?.request?.status === "approved" && card?.currentFile === "signed", "once signed, the card says so and the signed copy is current");
  r = await fetch(`${BASE}/api/ea-flow/documents/${DOC}/file`, { headers: hdr(EA, false) });
  ck((await r.arrayBuffer()).byteLength === signedBytes.length, "the signed bytes are what is served now");
  await new Promise((res) => setTimeout(res, 30));
  r = await call(EA, "POST", `/api/ea-flow/documents/${DOC}/move`, { toStageId: S_OUT }); b = await j(r);
  ck(r.status === 200 && b.document?.stageId === S_OUT && !!b.document?.completedAt, `after signing the card moves on and is complete in the last stage (${r.status})`);
  const trail = await query("SELECT * FROM ea_movements WHERE document_id = ? ORDER BY moved_at", [DOC]);
  ck(trail.length === 3 && trail[1].request_id === reqRow.id && trail.every((m) => m.moved_by === EA), "three timestamped movements, the signature one linked to its request");

  // ---- dashboard ----
  r = await call(EA, "GET", `/api/ea-flow/boards/${BOARD}/dashboard`); b = await j(r);
  const row = b.documents?.find((d) => d.id === DOC);
  const sum = row ? row.stages.reduce((n, s) => n + s.ms, 0) : -1;
  ck(r.status === 200 && row && row.stages.length === 3 && Math.abs(sum - row.totalMs) < 5, `dashboard: per-stage times add up to the total (${r.status})`);
  ck(row?.stages[0].ms > 0 && row?.stages[1].ms > 0 && row?.stages[2].ms === 0, "time was spent in the first two stages, none in the final one");
  ck(b.stages?.find((s) => s.id === S_OUT)?.count === 1 && b.stages?.find((s) => s.id === S_IN)?.count === 0, "stage counts reflect where cards are now");

  // ---- isolation ----
  ck((await call(OTHER_EA, "GET", `/api/ea-flow/boards/${BOARD}/documents`)).status === 404, "another assistant cannot see this board");
  ck((await call(OTHER_EA, "POST", `/api/ea-flow/boards/${BOARD}/stages`, { name: "Mine" })).status === 404, "…nor add a stage to it");
  ck((await call(OTHER_EA, "POST", `/api/ea-flow/documents/${DOC}/move`, { toStageId: S_IN })).status === 404, "…nor move its documents");
  ck((await fetch(`${BASE}/api/ea-flow/documents/${DOC}/file`, { headers: hdr(OTHER_EA, false) })).status === 404, "…nor read its files");
  b = await j(await call(OTHER_EA, "GET", "/api/ea-flow/boards"));
  ck(b.boards?.length === 0, "and sees none of it in their own list");

  // ---- delete paths ----
  ck((await call(EA, "DELETE", `/api/ea-flow/documents/${DOC}`)).status === 200, "a finished document can be removed");
  ck((await call(EA, "DELETE", `/api/ea-flow/stages/${S_SIG}`)).status === 200, "an empty stage can be deleted");
  ck((await call(EA, "DELETE", `/api/ea-flow/boards/${BOARD}`)).status === 200, "an empty board can be deleted");

  // ---- not on a WAQF box ----
  waqf = startApi(PORT + 10, "waqf");
  await waitFor(`http://127.0.0.1:${PORT + 10}`, waqf);
  r = await fetch(`http://127.0.0.1:${PORT + 10}/api/ea-flow/boards`, { headers: hdr(EA) });
  ck(r.status === 404, `the feature does not exist on a WAQF deployment (${r.status})`);
} catch (e) {
  fail.push(`the run stopped early: ${e?.message || e}`);
} finally {
  for (const p of pass) console.log("  PASS  " + p);
  for (const f of fail) console.log("  FAIL  " + f);
  await cleanup().catch((e) => console.log("cleanup:", e.message));
  api.kill(); if (waqf) waqf.kill();
  console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
  if (fail.length) console.log(api.log.split("\n").filter((l) => /error|ea-flow/i.test(l)).slice(-12).join("\n"));
  process.exit(fail.length ? 1 : 0);
}
