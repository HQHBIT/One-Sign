// HQHB: when the last signer of a multi-signer route signs, everyone on the
// route is told — with the signed copy attached (owner, 2026-10-31).
//
//   node test/workflow-complete.integration.mjs      (from server/, MySQL running)
//
// Starts its own HQHB API with email OFF, so every email lands in the `emails`
// log table instead of an inbox — the send path runs, nobody is written to.
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

const PORT = 5000 + 180 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;
const { initDb, execute, queryOne, query } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
const { notifyRouteOfCompletion } = await import("../src/workflowComplete.js");
await initDb();

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);
const T = Date.now().toString(36), now = Date.now();
const R = `u_wc_req_${T}`, A = `u_wc_a_${T}`, B = `u_wc_b_${T}`;
const UPLOADS = path.join(SERVER, "uploads");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
const pdfBytes = await (async () => { const d = await PDFDocument.create(); d.addPage([600, 800]); return Buffer.from(await d.save()); })();
const hdr = (id) => ({ Authorization: "Bearer " + signToken(id) });
const j = async (r) => { try { return await r.json(); } catch { return {}; } };
const created = [];
const emailOf = (id) => `${id}@wc.test`;

async function createDirect(name, signers) {
  const fd = new FormData();
  fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), name);
  fd.append("direct", "true");
  fd.append("signers", JSON.stringify(signers.map((u, i) => ({ userId: u, boxes: [{ page: 1, x: 10, y: 20 + i * 15, w: 30, h: 10 }], dateFields: [] }))));
  const r = await fetch(`${BASE}/api/requests`, { method: "POST", headers: hdr(R), body: fd });
  const b = await j(r); if (b.request?.id) created.push(b.request.id);
  return b.request?.id;
}
const approve = (who, id) => fetch(`${BASE}/api/requests/${id}/approve`, {
  method: "POST", headers: { ...hdr(who), "Content-Type": "application/json" }, body: JSON.stringify({ instant: true }) });
const mailsTo = (who, since) => query("SELECT template, subject, body FROM emails WHERE to_email = ? AND sent_at >= ? ORDER BY sent_at", [emailOf(who), since]);
const settle = () => new Promise((r) => setTimeout(r, 1500));

const cleanup = async () => {
  for (const id of created) {
    await execute("DELETE sg FROM request_step_signers sg JOIN request_steps st ON st.id = sg.step_id WHERE st.request_id = ?", [id]).catch(() => {});
    await execute("DELETE FROM request_steps WHERE request_id = ?", [id]).catch(() => {});
    await execute("DELETE FROM notifications WHERE request_id = ?", [id]).catch(() => {});
    await execute("DELETE FROM requests WHERE id = ?", [id]).catch(() => {});
  }
  await execute("DELETE FROM users WHERE id IN (?, ?, ?)", [R, A, B]).catch(() => {});
  for (const u of [R, A, B]) await fs.unlink(path.join(UPLOADS, "signatures", `${u}.png`)).catch(() => {});
};

let api = null;
try {
  await fs.mkdir(path.join(UPLOADS, "signatures"), { recursive: true });
  for (const u of [R, A, B]) await fs.writeFile(path.join(UPLOADS, "signatures", `${u}.png`), PNG);
  for (const [id, name, role] of [[R, "WC Requestor", "requestor"], [A, "WC First Signer", "approver"], [B, "WC Last Signer", "approver"]]) {
    await execute("INSERT INTO users (id, email, password_hash, name, role, team_id, signature_path, signature_aspect, created_at, active, org_id) VALUES (?,?,?,?,?,NULL,?,1,?,1,'hqhb')",
      [id, emailOf(id), bcrypt.hashSync("x", 4), name, role, `${id}.png`, now]);
  }
  api = spawn(process.execPath, ["src/index.js"], {
    cwd: SERVER, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(PORT), SENDGRID_API_KEY: "", STORAGE_BUCKET: "", ORG_SLUG: "hqhb" },
  });
  api.log = ""; api.stdout.on("data", (d) => (api.log += d)); api.stderr.on("data", (d) => (api.log += d));
  for (let i = 0; ; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} if (i > 240) throw new Error("API did not start"); await new Promise((r) => setTimeout(r, 500)); }

  // ---- a two-signer route ----
  const t0 = Date.now();
  const id = await createDirect("Route test.pdf", [A, B]);
  ck(!!id, "a request is sent to two signers in turn");
  let r = await approve(A, id);
  ck(r.status === 200, `the first signer signs (${r.status})`);
  await settle();
  ck((await mailsTo(A, t0)).every((m) => m.template !== "workflow_complete"), "nobody is told it is complete while the second signer is still to sign");
  r = await approve(B, id);
  ck(r.status === 200 && (await j(r)).request?.status === "approved", `the last signer signs and it is approved (${r.status})`);
  await settle();
  for (const [who, label] of [[A, "the first signer"], [B, "the last signer"]]) {
    const done = (await mailsTo(who, t0)).filter((m) => m.template === "workflow_complete");
    ck(done.length === 1 && /Fully signed: Route test\.pdf/.test(done[0].subject) && /signed copy is attached/i.test(done[0].body),
      `${label} gets one "Fully signed" email, saying the signed copy is attached (${done.length})`);
  }
  ck((await mailsTo(R, t0)).some((m) => m.template === "approved") && !(await mailsTo(R, t0)).some((m) => m.template === "workflow_complete"),
    "the requestor gets their usual Approved email, not a second one");
  const inApp = await queryOne("SELECT title FROM notifications WHERE user_id = ? AND request_id = ? AND type = 'workflow_complete'", [A, id]);
  ck(/Fully signed/.test(inApp?.title || ""), `…and an in-app notification (${inApp?.title})`);
  ck(!!(await queryOne("SELECT route_notified_at FROM requests WHERE id = ?", [id]))?.route_notified_at, "the send is recorded");
  const again = await notifyRouteOfCompletion(id);
  ck(again.skipped === "already sent", `it is never sent twice (${again.skipped})`);

  // ---- a single signer: nothing extra ----
  const t1 = Date.now();
  const single = await createDirect("Single.pdf", [A]);
  await approve(A, single); await settle();
  ck(!(await mailsTo(A, t1)).some((m) => m.template === "workflow_complete"), "a single-signer request sends no route email (the signer already has it)");

  // ---- confidential: told, but neither named nor attached ----
  const t2 = Date.now();
  const conf = await createDirect("Secret board paper.pdf", [A, B]);
  await execute("UPDATE requests SET confidential = 1 WHERE id = ?", [conf]);
  const viaApi = await notifyRouteOfCompletion(conf);
  ck(viaApi.skipped === "not finalised", "nothing is sent before it is fully signed");
  await execute("UPDATE requests SET status = 'approved' WHERE id = ?", [conf]);
  const confRes = await notifyRouteOfCompletion(conf);
  await settle();
  const confMail = (await mailsTo(B, t2)).find((m) => /workflow_complete/.test(m.template));
  ck(confRes.attached === false && confMail?.template === "confidential_workflow_complete" && !/Secret board paper/.test(`${confMail?.subject} ${confMail?.body}`),
    `a confidential document: the redacted email, no attachment, not named (${confMail?.template})`);

  // ---- WAQF: not this feature ----
  process.env.ORG_SLUG = "waqf";
  ck((await notifyRouteOfCompletion(id)).skipped === "not HQHB", "on a WAQF box it does nothing");
  delete process.env.ORG_SLUG;
} catch (e) {
  fail.push(`the run stopped early: ${e?.message || e}`);
} finally {
  for (const p of pass) console.log("  PASS  " + p);
  for (const f of fail) console.log("  FAIL  " + f);
  await cleanup().catch((e) => console.log("cleanup:", e.message));
  if (api) api.kill();
  console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
  if (fail.length && api) console.log(api.log.split("\n").filter((l) => /error|route-complete/i.test(l)).slice(-12).join("\n"));
  process.exit(fail.length ? 1 : 0);
}
