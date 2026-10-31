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
// An Approver signs a direct request exactly as an Executive does, so a
// signature stage must be able to name one; GONE is deactivated and must not be
// offered, however senior the role.
const APPROVER = `u_ef_apr_${T}`, GONE = `u_ef_gone_${T}`;
const hdr = (id, json = true) => ({ Authorization: "Bearer " + signToken(id), ...(json ? { "Content-Type": "application/json" } : {}) });
const call = (id, method, url, body) => fetch(`${BASE}${url}`, { method, headers: hdr(id), body: body === undefined ? undefined : JSON.stringify(body) });
const j = async (r) => { try { return await r.json(); } catch { return {}; } };

const pdfBytes = await (async () => { const d = await PDFDocument.create(); d.addPage([595, 842]); return Buffer.from(await d.save()); })();
const uploadDoc = (id, boardId, title, note = "", { stageId, boxes } = {}) => {
  const fd = new FormData();
  fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "Board paper.pdf");
  fd.append("title", title); if (note) fd.append("note", note);
  // Filing straight into a stage other than the first; boxes come as JSON on a
  // multipart body, the way the browser sends them.
  if (stageId) fd.append("stageId", stageId);
  if (boxes) fd.append("boxes", JSON.stringify(boxes));
  return fetch(`${BASE}/api/ea-flow/boards/${boardId}/documents`, { method: "POST", headers: hdr(id, false), body: fd });
};

const cleanup = async () => {
  await execute("DELETE FROM ea_boards WHERE owner_id IN (?, ?)", [EA, OTHER_EA]);
  await execute("DELETE FROM requests WHERE requestor_id = ?", [EA]);
  await execute("DELETE FROM executive_assistants WHERE assistant_id IN (?, ?)", [EA, OTHER_EA]);
  await execute("DELETE FROM users WHERE id IN (?, ?, ?, ?, ?, ?, ?)", [EA, EXEC, OTHER_EA, REQR, UNLINKED, APPROVER, GONE]);
};

let waqf = null;
try {
  await cleanup();
  const hash = bcrypt.hashSync("x", 4);
  for (const [id, role, name] of [[EA, "executive_assistant", "Flow Assistant"], [EXEC, "executive", "The Executive"], [OTHER_EA, "executive_assistant", "Other Assistant"], [REQR, "requestor", "A Requestor"], [UNLINKED, "executive", "Unlinked Executive"], [APPROVER, "approver", "An Approver"]]) {
    await execute("INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, active, org_id) VALUES (?, ?, ?, ?, ?, NULL, ?, 1, 'hqhb')", [id, `${id}@flow.test`, hash, name, role, now]);
  }
  await execute("INSERT INTO users (id, email, password_hash, name, role, team_id, created_at, active, org_id) VALUES (?, ?, ?, ?, 'executive', NULL, ?, 0, 'hqhb')", [GONE, `${GONE}@flow.test`, hash, "Departed Executive", now]);
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
  b = await j(await call(EA, "GET", "/api/ea-flow/executives"));
  ck(b.executives?.some((x) => x.id === UNLINKED) && b.executives?.some((x) => x.id === EXEC) && !b.executives?.some((x) => x.id === REQR), "every active executive is offered, linked or not; non-signers are not");
  // 2026-10-31 (owner): the list is the Executive Management only — "not all
  // the staff". It briefly offered every Approver too (PR #46).
  ck(!b.executives?.some((x) => x.id === APPROVER), "an approver is NOT offered — only the Executive Management");
  ck(!/@/.test(JSON.stringify(b)), "…and the list carries no email addresses");
  ck(!b.executives?.some((x) => x.id === GONE), "a deactivated signatory is never offered");
  r = await addStage({ name: "Approver signs", requiresSignature: true, signerId: APPROVER });
  ck(r.status === 400, `a NEW signature stage naming an approver is refused (${r.status})`);
  // A stage set up before the list was narrowed keeps its Approver signer.
  r = await addStage({ name: "Set up earlier", requiresSignature: true, signerId: EXEC });
  const EARLIER = (await j(r)).stage?.id;
  await execute("UPDATE ea_stages SET signer_id = ? WHERE id = ?", [APPROVER, EARLIER]);
  r = await call(EA, "PUT", `/api/ea-flow/stages/${EARLIER}`, { name: "Set up earlier (renamed)", kind: "signature", signerId: APPROVER });
  ck(r.status === 200, `…but a stage that ALREADY names an approver can still be edited and kept (${r.status})`);
  await call(EA, "DELETE", `/api/ea-flow/stages/${EARLIER}`);
  r = await addStage({ name: "Also signs", requiresSignature: true, signerId: GONE });
  ck(r.status === 400, `a signature stage naming a deactivated user is refused (${r.status})`);
  r = await addStage({ name: "Also signs", requiresSignature: true, signerId: REQR });
  ck(r.status === 400, `a signature stage naming someone who never signs is refused (${r.status})`);
  r = await addStage({ name: "Also signs", requiresSignature: true, signerId: UNLINKED });
  ck(r.status === 200, `a signature stage may name an executive the assistant is not linked to (${r.status})`);
  await call(EA, "DELETE", `/api/ea-flow/stages/${(await j(r)).stage?.id}`);
  r = await addStage({ name: "CEO signature", requiresSignature: true, signerId: EXEC }); const S_SIG = (await j(r)).stage?.id;
  ck(r.status === 200 && !!S_SIG, "signature stage added naming the executive");
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

  // ============================================================
  //   filing into a stage · CC stages · skipped stages
  //   Its own board, so the deletions above stay clean.
  // ============================================================
  r = await call(EA, "POST", "/api/ea-flow/boards", { name: "Kinds board" }); const B2 = (await j(r)).board?.id;
  const add2 = (body) => call(EA, "POST", `/api/ea-flow/boards/${B2}/stages`, body);
  const T_IN = (await j(await add2({ name: "In" }))).stage?.id;
  const T_SIG = (await j(await add2({ name: "Signs", kind: "signature", signerId: EXEC }))).stage?.id;
  r = await add2({ name: "Concern" });
  ck(r.status === 200, "a stage can still be added the old way, with no kind");
  await call(EA, "DELETE", `/api/ea-flow/stages/${(await j(r)).stage?.id}`);
  r = await add2({ name: "CC", kind: "cc" });
  ck(r.status === 400, `a CC stage with nobody named is refused (${r.status})`);
  ck((await add2({ name: "CC", kind: "cc", ccUserIds: [REQR] })).status === 400,
    "a CC stage naming someone who never signs is refused");
  // TWO people. A paper is routinely shown to several at once, and each of them
  // is a separate answer to "did they read it".
  r = await add2({ name: "CC", kind: "cc", ccUserIds: [EXEC, UNLINKED, EXEC] }); const T_CC = (await j(r)).stage?.id;
  const ccStage = async () => (await j(await call(EA, "GET", "/api/ea-flow/boards")))
    .boards.find((x) => x.id === B2)?.stages.find((s) => s.id === T_CC);
  let st = await ccStage();
  ck(r.status === 200 && st?.kind === "cc", "a CC stage reports its kind");
  ck(st?.ccPeople?.length === 2, `…and copies everyone named, with the duplicate collapsed (${st?.ccPeople?.length})`);
  ck(!!st?.signer?.id, "…and still reports one signer, so a client from before this names somebody rather than nobody");
  // The list is replaced on edit, not added to — "who is copied" is one
  // statement of fact, not an accumulation.
  await call(EA, "PUT", `/api/ea-flow/stages/${T_CC}`, { name: "CC", kind: "cc", ccUserIds: [EXEC] });
  st = await ccStage();
  ck(st?.ccPeople?.length === 1 && st.ccPeople[0].id === EXEC, "editing the list replaces it");
  await call(EA, "PUT", `/api/ea-flow/stages/${T_CC}`, { name: "CC", kind: "cc", ccUserIds: [EXEC, UNLINKED] });
  ck((await ccStage())?.ccPeople?.length === 2, "…and both are there when both are chosen");
  // The single-person shape an older client sends still works.
  r = await add2({ name: "CC old", kind: "cc", signerId: UNLINKED });
  ck(r.status === 200 && (await j(r)).stage?.ccPeople?.length === 1, "a CC stage made the old way, with one signerId, still works");
  await call(EA, "DELETE", `/api/ea-flow/stages/${(await j(r)).stage?.id}`);
  const T_END = (await j(await add2({ name: "Done" }))).stage?.id;

  // ---- a document filed straight into a stage ----
  r = await uploadDoc(EA, B2, "Filed late", "", { stageId: T_END }); b = await j(r);
  const D_LATE = b.document?.id;
  ck(r.status === 200 && b.document?.stageId === T_END, `a document can be filed straight into a later stage (${r.status})`);
  const lateTrail = await query("SELECT * FROM ea_movements WHERE document_id = ?", [D_LATE]);
  ck(lateTrail.length === 1 && lateTrail[0].from_stage_id === null && !lateTrail[0].skipped_stage_ids,
    "…and skips nothing on the way in — a card being created has passed over nothing");

  r = await uploadDoc(EA, B2, "Straight to signing", "", { stageId: T_SIG });
  ck(r.status === 400, `filing into a signature stage without a box is refused (${r.status})`);
  ck((await query("SELECT * FROM ea_documents WHERE board_id = ? AND title = ?", [B2, "Straight to signing"])).length === 0,
    "…and leaves no half-made card behind");
  r = await uploadDoc(EA, B2, "Straight to signing", "", { stageId: T_SIG, boxes: [{ page: 1, x: 10, y: 70, w: 25, h: 8 }] });
  b = await j(r); const D_SIG = b.document?.id;
  ck(r.status === 200 && b.document?.stageId === T_SIG, `filing into a signature stage with a box works (${r.status} ${b.error || ""})`);
  const rq2 = await queryOne("SELECT * FROM requests WHERE id = (SELECT request_id FROM ea_documents WHERE id = ?)", [D_SIG]);
  ck(!!rq2 && rq2.status === "pending", "…and raises the request there and then, so nobody has to remember to ask");

  // ---- signature boxes placed in advance ----
  // The order of asking is unchanged; all that moves earlier is WHERE each
  // signature goes, so the whole page can be laid out in one sitting.
  r = await uploadDoc(EA, B2, "Laid out first", "", { stageId: T_IN }); const D_PLAN = (await j(r)).document?.id;
  await new Promise((res) => setTimeout(res, 30));
  ck((await call(EA, "POST", `/api/ea-flow/documents/${D_PLAN}/move`, { toStageId: T_SIG })).status === 400,
    "with nothing planned, a card still cannot enter a signature stage without a box");

  // A plan for a stage that asks nobody to sign is refused rather than quietly
  // dropped — silently ignoring half a plan is how boxes go missing.
  r = await call(EA, "PUT", `/api/ea-flow/documents/${D_PLAN}/planned-boxes`,
    { boxesByStage: { [T_IN]: [{ page: 1, x: 12, y: 60, w: 25, h: 8 }] } });
  ck(r.status === 400, `a box planned for a stage that never signs is refused (${r.status})`);
  r = await call(EA, "PUT", `/api/ea-flow/documents/${D_PLAN}/planned-boxes`,
    { boxesByStage: { [S_SIG]: [{ page: 1, x: 12, y: 60, w: 25, h: 8 }] } });
  ck(r.status === 400, `…as is one for a stage on somebody else's board (${r.status})`);
  r = await call(EA, "PUT", `/api/ea-flow/documents/${D_PLAN}/planned-boxes`,
    { boxesByStage: { [T_SIG]: [{ page: 1, x: 12, y: 60, w: "25", h: 8 }] } });
  ck(r.status === 400, `…and so is a box with a side that is not a number (${r.status})`);

  r = await call(EA, "PUT", `/api/ea-flow/documents/${D_PLAN}/planned-boxes`,
    { boxesByStage: { [T_SIG]: [{ page: 1, x: 12, y: 60, w: 25, h: 8 }] } });
  b = await j(r);
  ck(r.status === 200 && b.document?.plannedBoxes?.[T_SIG]?.length === 1,
    `a layout can be saved ahead of the card arriving (${r.status} ${b.error || ""})`);

  // The whole point: the card reaches the stage and the request goes out with
  // the box already on it, nobody being asked to place one a second time.
  r = await call(EA, "POST", `/api/ea-flow/documents/${D_PLAN}/move`, { toStageId: T_SIG });
  b = await j(r);
  ck(r.status === 200 && b.document?.stageId === T_SIG,
    `a planned stage admits the card with no box supplied (${r.status} ${b.error || ""})`);
  const planSg = await queryOne(`SELECT s.* FROM request_step_signers s
      JOIN request_steps st ON st.id = s.step_id
      WHERE st.request_id = (SELECT request_id FROM ea_documents WHERE id = ?)`, [D_PLAN]);
  ck(planSg?.user_id === EXEC && Math.abs(Number(planSg?.marker_x) - 12) < 1,
    `…and the request carries the box that was planned, not a new one (${planSg?.marker_x})`);

  // A box handed over at the moment of the move still wins — the plan is a
  // fallback, not a lock on where the signature may go.
  r = await uploadDoc(EA, B2, "Laid out then moved", "", { stageId: T_IN }); const D_OVER = (await j(r)).document?.id;
  await call(EA, "PUT", `/api/ea-flow/documents/${D_OVER}/planned-boxes`,
    { boxesByStage: { [T_SIG]: [{ page: 1, x: 12, y: 60, w: 25, h: 8 }] } });
  await new Promise((res) => setTimeout(res, 30));
  r = await call(EA, "POST", `/api/ea-flow/documents/${D_OVER}/move`,
    { toStageId: T_SIG, boxes: [{ page: 1, x: 44, y: 20, w: 25, h: 8 }] });
  const overSg = await queryOne(`SELECT s.* FROM request_step_signers s
      JOIN request_steps st ON st.id = s.step_id
      WHERE st.request_id = (SELECT request_id FROM ea_documents WHERE id = ?)`, [D_OVER]);
  ck(r.status === 200 && Math.abs(Number(overSg?.marker_x) - 44) < 1,
    `a box placed at the moment of the move overrides the plan (${overSg?.marker_x})`);

  // Clearing the layout puts the board back exactly where it was.
  r = await call(EA, "PUT", `/api/ea-flow/documents/${D_OVER}/planned-boxes`, { boxesByStage: {} });
  b = await j(r);
  const cleared = await queryOne("SELECT planned_boxes_json FROM ea_documents WHERE id = ?", [D_OVER]);
  ck(r.status === 200 && cleared?.planned_boxes_json === null && !Object.keys(b.document?.plannedBoxes || {}).length,
    "a layout can be cleared, leaving no empty plan behind");

  // ---- a CC stage tells someone and lets go ----
  r = await uploadDoc(EA, B2, "To be read", "", { stageId: T_IN }); const D_CC = (await j(r)).document?.id;
  await new Promise((res) => setTimeout(res, 30));
  r = await call(EA, "POST", `/api/ea-flow/documents/${D_CC}/move`, { toStageId: T_CC }); b = await j(r);
  ck(r.status === 200, `a card enters a CC stage with no signature box (${r.status} ${b.error || ""})`);
  const notices = await query("SELECT * FROM ea_cc_notices WHERE document_id = ? AND stage_id = ? ORDER BY user_id", [D_CC, T_CC]);
  ck(notices.length === 2 && notices.every((n) => !n.viewed_at), `a notice is recorded for EACH person copied, all unread (${notices.length})`);
  ck(notices.some((n) => n.user_id === EXEC) && notices.some((n) => n.user_id === UNLINKED), "…one per person on the stage");
  ck(b.document?.cc?.notified === 2 && b.document?.cc?.viewed === 0 && b.document?.cc?.people?.length === 2,
    `…and the card says how many have it and how many have opened it (${b.document?.cc?.viewed} of ${b.document?.cc?.notified})`);
  ck(!(await queryOne("SELECT request_id FROM ea_documents WHERE id = ?", [D_CC]))?.request_id, "…and nobody is asked to sign anything");

  // ---- the person CC'd can read it, and only them ----
  b = await j(await call(EXEC, "GET", "/api/ea-cc"));
  ck(b.documents?.some((d) => d.id === D_CC), "the person CC'd sees it in their own list");
  // Each person copied gets their OWN access and their own read state — one of
  // them opening it must not mark it read for everybody.
  ck((await j(await call(UNLINKED, "GET", "/api/ea-cc"))).documents?.some((d) => d.id === D_CC),
    "…and so does the second person copied");
  ck((await j(await call(REQR, "GET", "/api/ea-cc"))).documents?.length === 0, "someone never CC'd sees nothing");
  ck((await fetch(`${BASE}/api/ea-cc/${D_CC}/file`, { headers: hdr(REQR, false) })).status === 404, "…and cannot read the file");
  r = await fetch(`${BASE}/api/ea-cc/${D_CC}/file`, { headers: hdr(EXEC, false) });
  ck(r.status === 200 && (await r.arrayBuffer()).byteLength === pdfBytes.length, `the person CC'd reads the document (${r.status})`);
  const seen = await queryOne("SELECT viewed_at FROM ea_cc_notices WHERE document_id = ? AND user_id = ?", [D_CC, EXEC]);
  ck(!!seen?.viewed_at, "…and opening it is what records that they saw it");
  // The crux of copying several people: one reading it says nothing about the
  // others. A shared flag here would quietly report the whole stage as read.
  const other = await queryOne("SELECT viewed_at FROM ea_cc_notices WHERE document_id = ? AND user_id = ?", [D_CC, UNLINKED]);
  ck(!other?.viewed_at, "…and says nothing about whether anyone else has");

  // ---- reminding whoever has not opened it ----
  // EXEC has read it; UNLINKED has not. A reminder must reach exactly one of
  // them: writing to the person who already read it is how a reminder turns
  // into noise that gets filtered.
  r = await call(EA, "POST", `/api/ea-flow/documents/${D_CC}/cc-remind`);
  b = await j(r);
  ck(r.status === 200 && b.reminded === 1, `a reminder goes only to the people who have not opened it (${r.status}, ${b.reminded})`);
  const remindRows = await query("SELECT user_id, reminded_at, reminder_count FROM ea_cc_notices WHERE document_id = ? AND stage_id = ?", [D_CC, T_CC]);
  const remExec = remindRows.find((x) => x.user_id === EXEC);
  const remOther = remindRows.find((x) => x.user_id === UNLINKED);
  ck(!remExec?.reminded_at && Number(remExec?.reminder_count) === 0, "…the one who read it is left alone");
  ck(!!remOther?.reminded_at && Number(remOther?.reminder_count) === 1, "…and the one who has not is recorded as reminded");
  ck(b.document?.cc?.remindableAt > Date.now(), "…and the card says when the next one is allowed");
  // Same 24 hours as a request reminder, refused the same way.
  r = await call(EA, "POST", `/api/ea-flow/documents/${D_CC}/cc-remind`);
  ck(r.status === 429, `a second reminder inside the cooldown is refused (${r.status})`);

  // A CC stage is not a gate: the card leaves whenever the assistant says so.
  await new Promise((res) => setTimeout(res, 30));
  r = await call(EA, "POST", `/api/ea-flow/documents/${D_CC}/move`, { toStageId: T_END });
  ck(r.status === 200, `a CC stage never holds the card (${r.status})`);
  // Off the stage, there is nobody to nudge about it any more.
  r = await call(EA, "POST", `/api/ea-flow/documents/${D_CC}/cc-remind`);
  ck(r.status === 400, `a card that has left the CC stage cannot be reminded (${r.status})`);
  // And a document on a stage where everyone HAS read it has nobody to nudge.
  r = await call(EA, "POST", `/api/ea-flow/documents/${D_LATE}/cc-remind`);
  ck(r.status === 400, `a document nobody owes a read is refused (${r.status})`);

  // ---- sent for review by hand, with no CC stage involved ----
  // D_LATE sits on a PLAIN stage. The point of this is that one paper can be
  // shared for reading without reshaping the board to allow it.
  r = await call(EA, "POST", `/api/ea-flow/documents/${D_LATE}/review`, { userIds: [] });
  ck(r.status === 400, `sending for review with nobody chosen is refused (${r.status})`);
  ck((await call(EA, "POST", `/api/ea-flow/documents/${D_LATE}/review`, { userIds: [REQR] })).status === 400,
    "…and so is naming someone who never signs");
  r = await call(EA, "POST", `/api/ea-flow/documents/${D_LATE}/review`, { userIds: [EXEC, UNLINKED] });
  b = await j(r);
  ck(r.status === 200 && b.sent === 2, `a document on a plain stage can be sent for review (${r.status}, ${b.sent})`);
  ck(b.document?.review?.notified === 2 && b.document?.review?.viewed === 0, "…and the card reports who owes it a read");
  ck(b.document?.cc === null, "…without pretending its stage has become a CC stage");
  const adhoc = await query("SELECT * FROM ea_cc_notices WHERE document_id = ? AND source = 'adhoc'", [D_LATE]);
  ck(adhoc.length === 2 && adhoc.every((n) => n.stage_id === null),
    "…recorded against the DOCUMENT, not a stage, so it survives the card moving");

  // The reader should not have to care which route asked them.
  b = await j(await call(EXEC, "GET", "/api/ea-cc"));
  const forInfo = (b.documents || []).find((x) => x.id === D_LATE);
  ck(!!forInfo, "the person it was sent to sees it in their own list");
  ck(forInfo?.stageName === "Sent for review", `…labelled as a review, not as a step it never had (${forInfo?.stageName})`);
  r = await fetch(`${BASE}/api/ea-cc/${D_LATE}/file`, { headers: hdr(EXEC, false) });
  ck(r.status === 200, `…and can read it (${r.status})`);
  ck((await fetch(`${BASE}/api/ea-cc/${D_LATE}/file`, { headers: hdr(OTHER_EA, false) })).status === 404,
    "…while someone it was not sent to still cannot");

  // Sending to the same person again re-asks rather than piling up a row.
  r = await call(EA, "POST", `/api/ea-flow/documents/${D_LATE}/review`, { userIds: [EXEC] });
  const again = await query("SELECT * FROM ea_cc_notices WHERE document_id = ? AND source = 'adhoc' AND user_id = ?", [D_LATE, EXEC]);
  ck(r.status === 200 && again.length === 1 && !again[0].viewed_at,
    "sending to the same person again re-asks, and does not duplicate the notice");

  // The same button chases a review as chases a CC stage.
  r = await call(EA, "POST", `/api/ea-flow/documents/${D_LATE}/cc-remind`);
  ck(r.status === 200, `a document sent for review can be chased too (${r.status})`);

  // ---- stages jumped over ----
  r = await uploadDoc(EA, B2, "Goes straight through", "", { stageId: T_IN }); const D_SKIP = (await j(r)).document?.id;
  await new Promise((res) => setTimeout(res, 30));
  r = await call(EA, "POST", `/api/ea-flow/documents/${D_SKIP}/move`, { toStageId: T_END });
  ck(r.status === 200, `a card may jump past the stages between (${r.status})`);
  const jump = await queryOne("SELECT skipped_stage_ids FROM ea_movements WHERE document_id = ? ORDER BY moved_at DESC LIMIT 1", [D_SKIP]);
  const jumped = jump?.skipped_stage_ids ? JSON.parse(jump.skipped_stage_ids) : [];
  ck(jumped.includes(T_SIG) && jumped.includes(T_CC) && !jumped.includes(T_END),
    `the stages passed over are recorded, and the destination is not one of them (${jumped.length})`);
  await new Promise((res) => setTimeout(res, 30));
  r = await call(EA, "POST", `/api/ea-flow/documents/${D_SKIP}/move`, { toStageId: T_IN });
  const back = await queryOne("SELECT skipped_stage_ids FROM ea_movements WHERE document_id = ? ORDER BY moved_at DESC LIMIT 1", [D_SKIP]);
  ck(r.status === 200 && !back?.skipped_stage_ids, "going back skips nothing — that is revisiting, not skipping");

  // ---- the dashboard reports both ----
  b = await j(await call(EA, "GET", `/api/ea-flow/boards/${B2}/dashboard`));
  const sSig = b.stages?.find((s) => s.id === T_SIG);
  const sCc = b.stages?.find((s) => s.id === T_CC);
  // TWO documents went around the signature stage — the CC'd one jumped it on
  // its way to the CC stage, and the other jumped everything — while only the
  // second went around the CC stage. Counting per stage rather than per move is
  // what makes those two numbers differ.
  ck(sSig?.skippedCount === 2, `the report counts both documents that went around the signature stage (${sSig?.skippedCount})`);
  ck(sCc?.skippedCount === 1, `…and only the one that went around the CC stage (${sCc?.skippedCount})`);
  // Still 2, not 4: the two people D_LATE was sent to for review are NOT
  // counted as the CC stage having copied them. Mixing the two would overstate
  // how well the stage itself works.
  ck(sCc?.kind === "cc" && sCc?.ccNotified === 2 && sCc?.ccViewed === 1,
    `…and how many of the CC'd people actually opened it (${sCc?.ccViewed} of ${sCc?.ccNotified})`);
  const rowSkip = b.documents?.find((d) => d.id === D_SKIP);
  ck(rowSkip?.stages.find((s) => s.stageId === T_SIG)?.skipped === true, "a skipped stage is marked on the document's own row");
  const rowCc = b.documents?.find((d) => d.id === D_CC);
  ck(rowCc?.cc?.length === 2 && rowCc.cc.filter((c) => c.viewedAt).length === 1 && rowCc.cc.every((c) => c.name),
    "and the CC'd document carries each person, named, with who has read it");

  // ---- a card already IN a stage that is then set to "Signs" (owner, 2026-10-31) ----
  // Entering a stage was the only trigger, so this card sat there and nobody
  // was ever asked to sign it.
  const lateStage = await j(await call(EA, "POST", `/api/ea-flow/boards/${B2}/stages`, { name: `Switched later ${T}`, kind: "plain" }));
  const S_LATE = lateStage.stage?.id;
  const D_FIRST = (await j(await uploadDoc(EA, B2, "Sat there first", "", { stageId: S_LATE }))).document?.id;
  r = await call(EA, "PUT", `/api/ea-flow/stages/${S_LATE}`, { name: `Switched later ${T}`, kind: "signature", signerId: EXEC });
  ck(r.status === 200, `the stage it sits in is switched to Signs (${r.status})`);
  let lateCard = (await j(await call(EA, "GET", `/api/ea-flow/boards/${B2}/documents`))).documents?.find((d) => d.id === D_FIRST);
  ck(lateCard?.notSent === true && !lateCard?.request && !lateCard?.waitingForSignature, "the card says it has NOT been sent — rather than looking as if it had");
  r = await call(EA, "POST", `/api/ea-flow/documents/${D_FIRST}/send`, {});
  ck(r.status === 400, `send with no box placed asks for the box first (${r.status})`);
  r = await call(EA, "POST", `/api/ea-flow/documents/${D_FIRST}/send`, { boxes: [{ page: 1, x: 10, y: 70, w: 25, h: 8 }] });
  lateCard = (await j(r)).document;
  ck(r.status === 200 && lateCard?.waitingForSignature === true && lateCard?.notSent === false, `send puts it with the executive and the card now waits (${r.status})`);
  const sentReq = (await queryOne("SELECT request_id FROM ea_documents WHERE id = ?", [D_FIRST]))?.request_id;
  ck(!!(await queryOne(
    `SELECT 1 AS ok FROM request_step_signers sg JOIN request_steps st ON st.id = sg.step_id JOIN requests r ON r.id = st.request_id
      WHERE st.request_id = ? AND sg.user_id = ? AND r.status = 'pending'`, [sentReq, EXEC])),
    "…as an ordinary pending request in the executive's own queue");
  r = await call(EA, "POST", `/api/ea-flow/documents/${D_FIRST}/send`, { boxes: [{ page: 1, x: 10, y: 70, w: 25, h: 8 }] });
  ck(r.status === 409, `sending it twice is refused (${r.status})`);

  // ---- an assistant can OPEN what their executive was sent (owner, 2026-10-31) ----
  // The executive tab listed these documents and then refused to open them.
  // OTHER_EA did not raise this request, so only the link can let them in.
  r = await fetch(`${BASE}/api/requests/${sentReq}/file`, { headers: hdr(OTHER_EA) });
  ck(r.status === 403, `an assistant NOT linked to the executive cannot open it (${r.status})`);
  await execute("INSERT INTO executive_assistants (id, executive_id, assistant_id, can_approve, signature_source, created_at, created_by) VALUES (?, ?, ?, 0, 'executive', ?, ?)", [`ea2_${T}`, EXEC, OTHER_EA, Date.now(), OTHER_EA]);
  r = await fetch(`${BASE}/api/requests/${sentReq}/file`, { headers: hdr(OTHER_EA) });
  ck(r.status === 200, `a linked assistant with view access opens the executive's pending document (${r.status})`);
  await execute("UPDATE executive_assistants SET can_view = 0, can_dashboard = 0 WHERE id = ?", [`ea2_${T}`]);
  r = await fetch(`${BASE}/api/requests/${sentReq}/file`, { headers: hdr(OTHER_EA) });
  ck(r.status === 403, `…and not once that access is withdrawn (${r.status})`);
  await execute("UPDATE requests SET confidential = 1 WHERE id = ?", [sentReq]);
  await execute("UPDATE executive_assistants SET can_view = 1, can_dashboard = 1 WHERE id = ?", [`ea2_${T}`]);
  r = await fetch(`${BASE}/api/requests/${sentReq}/file`, { headers: hdr(OTHER_EA) });
  ck(r.status === 403, `a confidential document stays closed to an assistant, whatever their access (${r.status})`);
  await execute("UPDATE requests SET confidential = 0 WHERE id = ?", [sentReq]);

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
