// HQHB: an approver may add today's date when the requestor placed no date field.
//
//   node test/approver-date.integration.mjs      (from server/, MySQL running)
//
// Verifies: with { addDate: true } and no requestor-placed date field, a date
// field is persisted directly under each signature box at 3/8 of its height
// (single-approver AND workflow paths) and the signed PDF is stamped; without
// addDate nothing is added; a requestor-placed date field is never duplicated;
// and on a WAQF box addDate is ignored. Spawns its own APIs on spare ports.
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import { PDFDocument } from "pdf-lib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..");
config({ path: path.join(SERVER, ".env") });

const PORT = 5000 + 160 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;
const WAQF_PORT = PORT + 5;
const WAQF_BASE = `http://127.0.0.1:${WAQF_PORT}`;
const { initDb, execute, queryOne } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
const { autoDateFieldsBelow } = await import("../src/routes/requests.js");
await initDb();

function startApi(port, env) {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: SERVER, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), SENDGRID_API_KEY: "", STORAGE_BUCKET: "", ...env },
  });
  child.log = ""; child.stdout.on("data", d => (child.log += d)); child.stderr.on("data", d => (child.log += d));
  return child;
}
async function waitFor(base, child) {
  for (let i = 0; i < 180; i++) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {} await new Promise(r => setTimeout(r, 500)); }
  console.log(child.log); throw new Error("API did not start on " + base);
}

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);
const T = Date.now().toString(36), now = Date.now();
const TEAM = `t_ad_${T}`, R = `u_ad_req_${T}`, A = `u_ad_app_${T}`;
const UPLOADS = path.join(SERVER, "uploads");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
const pdfBytes = await (async () => { const d = await PDFDocument.create(); d.addPage([600, 800]); return Buffer.from(await d.save()); })();
const hdr = (id) => ({ Authorization: "Bearer " + signToken(id) });
const j = async r => { try { return await r.json(); } catch { return {}; } };
const near = (a, b, tol = 0.05) => Math.abs(Number(a) - Number(b)) <= tol;
const created = [];

// Create a single-team request (one marker, optional requestor date field) as R.
async function createSingle(base, { dateFields = null } = {}) {
  const fd = new FormData();
  fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "ad.pdf");
  fd.append("targetTeamId", TEAM);
  fd.append("marker", JSON.stringify([{ page: 1, x: 20, y: 30, w: 25, h: 8 }]));
  if (dateFields) fd.append("signerDateFields", JSON.stringify(dateFields));
  const r = await fetch(`${base}/api/requests`, { method: "POST", headers: hdr(R), body: fd });
  const b = await j(r); if (b.request?.id) created.push(b.request.id);
  return { status: r.status, id: b.request?.id };
}
// Create a direct (workflow-style) request naming A, no date field.
async function createDirect(base) {
  const fd = new FormData();
  fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "ad-direct.pdf");
  fd.append("direct", "true");
  fd.append("signers", JSON.stringify([{ userId: A, boxes: [{ page: 1, x: 10, y: 20, w: 30, h: 10 }], dateFields: [] }]));
  const r = await fetch(`${base}/api/requests`, { method: "POST", headers: hdr(R), body: fd });
  const b = await j(r); if (b.request?.id) created.push(b.request.id);
  return { status: r.status, id: b.request?.id };
}
const approve = (base, id, body) =>
  fetch(`${base}/api/requests/${id}/approve`, { method: "POST", headers: { ...hdr(A), "Content-Type": "application/json" }, body: JSON.stringify(body) });

const cleanup = async () => {
  for (const id of created) {
    await execute("DELETE sg FROM request_step_signers sg JOIN request_steps st ON st.id = sg.step_id WHERE st.request_id = ?", [id]).catch(() => {});
    await execute("DELETE FROM request_steps WHERE request_id = ?", [id]).catch(() => {});
    await execute("DELETE FROM requests WHERE id = ?", [id]).catch(() => {});
    for (const f of [path.join(UPLOADS, "documents", `${id}.pdf`), path.join(UPLOADS, "signed", `${id}.signed.pdf`)]) await fs.unlink(f).catch(() => {});
  }
  await execute("DELETE FROM signing_authority WHERE user_id IN (?, ?)", [R, A]).catch(() => {});
  await execute("DELETE FROM users WHERE id IN (?, ?)", [R, A]).catch(() => {});
  await execute("DELETE FROM teams WHERE id = ?", [TEAM]).catch(() => {});
  for (const u of [R, A]) await fs.unlink(path.join(UPLOADS, "signatures", `${u}.png`)).catch(() => {});
};

let hqhb = null, waqf = null;
try {
  await cleanup();
  // ---- pure helper ----
  const auto = autoDateFieldsBelow([{ page: 1, x: 20, y: 30, w: 25, h: 8 }]);
  ck(auto.length === 1 && near(auto[0].h, 3) && near(auto[0].y, 38.4) && auto[0].x === 20 && auto[0].w === 25,
    `helper: date box sits just under the signature at 3/8 of its height (${JSON.stringify(auto[0])})`);
  const edge = autoDateFieldsBelow([{ page: 1, x: 5, y: 95, w: 20, h: 4 }]);
  ck(edge[0].y + edge[0].h <= 100 && edge[0].y < 95, `helper: a signature at the page bottom gets its date ABOVE instead (y=${edge[0].y.toFixed(2)})`);

  // ---- fixtures: an HQHB team, a requestor, an approver with signing authority + a signature ----
  await fs.mkdir(path.join(UPLOADS, "signatures"), { recursive: true });
  for (const u of [R, A]) await fs.writeFile(path.join(UPLOADS, "signatures", `${u}.png`), PNG);
  await execute("INSERT INTO teams (id, name, created_at, org_id) VALUES (?, ?, ?, 'hqhb')", [TEAM, `Approver Date Team ${T}`, now]);
  await execute("INSERT INTO users (id, email, password_hash, name, role, team_id, signature_path, signature_aspect, created_at, active, org_id) VALUES (?,?,?,?,?,?,?,1,?,1,'hqhb')",
    [R, `${R}@ad.test`, bcrypt.hashSync("x", 4), "AD Requestor", "requestor", TEAM, `${R}.png`, now]);
  await execute("INSERT INTO users (id, email, password_hash, name, role, team_id, signature_path, signature_aspect, created_at, active, org_id) VALUES (?,?,?,?,?,?,?,1,?,1,'hqhb')",
    [A, `${A}@ad.test`, bcrypt.hashSync("x", 4), "AD Approver", "approver", null, `${A}.png`, now]);
  await execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?, ?)", [A, TEAM]);

  hqhb = startApi(PORT, { ORG_SLUG: "hqhb" }); await waitFor(BASE, hqhb);
  waqf = startApi(WAQF_PORT, { ORG_SLUG: "waqf" }); await waitFor(WAQF_BASE, waqf);

  // ---- single-approver: addDate adds + persists one date under the marker ----
  let c = await createSingle(BASE);
  ck(c.status === 200 && !!c.id, `create single-team request without a date field (${c.status})`);
  let r = await approve(BASE, c.id, { instant: true, addDate: true });
  ck(r.status === 200, `approver signs with addDate (${r.status} ${(await j(r)).error || ""})`);
  let row = await queryOne("SELECT signer_date_fields_json AS d, signed_file_path AS s FROM requests WHERE id = ?", [c.id]);
  let d = []; try { d = JSON.parse(row?.d || "[]"); } catch {}
  ck(d.length === 1 && near(d[0].h, 3) && near(d[0].y, 38.4) && d[0].x === 20,
    `a date field was persisted under the signature, 3/8 of its height (${JSON.stringify(d[0])})`);
  const signed = await fs.readFile(path.join(UPLOADS, "signed", `${c.id}.signed.pdf`)).catch(() => null);
  ck(!!signed && signed.length > pdfBytes.length + 100 && (await PDFDocument.load(signed)).getPageCount() === 1, "the signed PDF exists and is stamped");

  // ---- single-approver: without addDate nothing is added ----
  c = await createSingle(BASE);
  r = await approve(BASE, c.id, { instant: true });
  row = await queryOne("SELECT signer_date_fields_json AS d FROM requests WHERE id = ?", [c.id]);
  ck(r.status === 200 && !row?.d, `without addDate no date field is added (${r.status}, stored=${row?.d})`);

  // ---- single-approver: a requestor-placed date field is respected, not duplicated ----
  c = await createSingle(BASE, { dateFields: [{ page: 1, x: 20, y: 50, w: 20, h: 5 }] });
  r = await approve(BASE, c.id, { instant: true, addDate: true });
  row = await queryOne("SELECT signer_date_fields_json AS d FROM requests WHERE id = ?", [c.id]);
  d = []; try { d = JSON.parse(row?.d || "[]"); } catch {}
  ck(r.status === 200 && d.length === 1 && d[0].y === 50, `a requestor-placed date field wins — addDate does not add a second (${JSON.stringify(d)})`);

  // ---- workflow/direct path: addDate persists onto the signer row ----
  c = await createDirect(BASE);
  ck(c.status === 200 && !!c.id, `create direct request without a date field (${c.status})`);
  r = await approve(BASE, c.id, { instant: true, addDate: true });
  const sg = await queryOne("SELECT sg.date_fields_json AS d, sg.status FROM request_step_signers sg JOIN request_steps st ON st.id = sg.step_id WHERE st.request_id = ?", [c.id]);
  d = []; try { d = JSON.parse(sg?.d || "[]"); } catch {}
  ck(r.status === 200 && sg?.status === "signed" && d.length === 1 && near(d[0].h, 3.75) && near(d[0].y, 30.4) && d[0].x === 10,
    `workflow signer: a date field was persisted under the box (${r.status}, ${JSON.stringify(d[0])})`);

  // ---- WAQF box: addDate is ignored ----
  c = await createSingle(WAQF_BASE);
  r = await approve(WAQF_BASE, c.id, { instant: true, addDate: true });
  row = await queryOne("SELECT signer_date_fields_json AS d FROM requests WHERE id = ?", [c.id]);
  ck(r.status === 200 && !row?.d, `on a WAQF box addDate is ignored — HQHB only (${r.status}, stored=${row?.d})`);
} catch (e) {
  fail.push(`the run stopped early: ${e?.message || e}`);
} finally {
  for (const p of pass) console.log("  PASS  " + p);
  for (const f of fail) console.log("  FAIL  " + f);
  await cleanup().catch(e => console.log("cleanup:", e.message));
  if (hqhb) hqhb.kill(); if (waqf) waqf.kill();
  console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
  if (fail.length && hqhb) console.log(hqhb.log.split("\n").filter(l => /error|Error/.test(l)).slice(-12).join("\n"));
  process.exit(fail.length ? 1 : 0);
}
