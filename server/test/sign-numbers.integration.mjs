// HQHB Sign Numbers: every signature gets a number, printed under it; the fully
// signed document gains an audit page; the admin register traces it (owner,
// 2026-10-31).
//
//   node test/sign-numbers.integration.mjs      (from server/, MySQL running)
//
// Starts its own HQHB API with email and object storage OFF.
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
process.env.STORAGE_BUCKET = "";   // read signed files from disk, as the API writes them
process.env.ORG_SLUG = "hqhb";

const PORT = 5000 + 190 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;
const { initDb, execute, queryOne, query } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
const { readStored } = await import("../src/filestore.js");
const { backfillRegister, assignSignNo, sha256 } = await import("../src/signRegister.js");
await initDb();

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);
const T = Date.now().toString(36), now = Date.now();
const R = `u_sn_req_${T}`, A = `u_sn_a_${T}`, B = `u_sn_b_${T}`, ADM = `u_sn_adm_${T}`;
const UPLOADS = path.join(SERVER, "uploads");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
const pdfBytes = await (async () => { const d = await PDFDocument.create(); d.addPage([600, 800]); return Buffer.from(await d.save()); })();
const hdr = (id) => ({ Authorization: "Bearer " + signToken(id) });
const j = async (r) => { try { return await r.json(); } catch { return {}; } };
const created = [];
// pdf-lib writes standard-font text as hex strings inside compressed page
// streams — inflate every stream, then look for the text's hex.
const zlib = await import("node:zlib");
function pdfText(bytes) {
  const raw = bytes.toString("latin1");
  let out = raw;
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    try { out += zlib.inflateSync(Buffer.from(raw.slice(start, end), "latin1")).toString("latin1"); } catch { /* not flate */ }
    re.lastIndex = end + "endstream".length;
  }
  return out.toUpperCase();
}
const hasText = (bytes, text) => pdfText(bytes).includes(Buffer.from(text, "latin1").toString("hex").toUpperCase());

async function createDirect(name, signers) {
  const fd = new FormData();
  fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), name);
  fd.append("direct", "true");
  fd.append("signers", JSON.stringify(signers.map((u, i) => ({ userId: u, boxes: [{ page: 1, x: 10, y: 20 + i * 20, w: 30, h: 10 }], dateFields: [] }))));
  const r = await fetch(`${BASE}/api/requests`, { method: "POST", headers: hdr(R), body: fd });
  const b = await j(r); if (b.request?.id) created.push(b.request.id);
  return b.request?.id;
}
const approve = (who, id) => fetch(`${BASE}/api/requests/${id}/approve`, {
  method: "POST", headers: { ...hdr(who), "Content-Type": "application/json", "User-Agent": "sign-numbers-test" }, body: JSON.stringify({ instant: true }) });
const register = (id) => query("SELECT * FROM sign_register WHERE request_id = ? ORDER BY seq", [id]);
const signedBytes = async (id) => readStored("signed", (await queryOne("SELECT signed_file_path FROM requests WHERE id = ?", [id])).signed_file_path);

const cleanup = async () => {
  for (const id of created) {
    await execute("DELETE FROM sign_register WHERE request_id = ?", [id]).catch(() => {});
    await execute("DELETE sg FROM request_step_signers sg JOIN request_steps st ON st.id = sg.step_id WHERE st.request_id = ?", [id]).catch(() => {});
    await execute("DELETE FROM request_steps WHERE request_id = ?", [id]).catch(() => {});
    await execute("DELETE FROM notifications WHERE request_id = ?", [id]).catch(() => {});
    await execute("DELETE FROM requests WHERE id = ?", [id]).catch(() => {});
  }
  await execute("DELETE FROM users WHERE id IN (?, ?, ?, ?)", [R, A, B, ADM]).catch(() => {});
  for (const u of [R, A, B]) await fs.unlink(path.join(UPLOADS, "signatures", `${u}.png`)).catch(() => {});
};

let api = null;
try {
  await fs.mkdir(path.join(UPLOADS, "signatures"), { recursive: true });
  for (const u of [R, A, B]) await fs.writeFile(path.join(UPLOADS, "signatures", `${u}.png`), PNG);
  for (const [id, name, role] of [[R, "SN Requestor", "requestor"], [A, "SN First Executive", "approver"], [B, "SN Second Executive", "approver"], [ADM, "SN Admin", "admin"]]) {
    await execute("INSERT INTO users (id, email, password_hash, name, role, team_id, signature_path, signature_aspect, created_at, active, org_id) VALUES (?,?,?,?,?,NULL,?,1,?,1,'hqhb')",
      [id, `${id}@sn.test`, bcrypt.hashSync("x", 4), name, role, role === "admin" ? null : `${id}.png`, now]);
  }
  api = spawn(process.execPath, ["src/index.js"], {
    cwd: SERVER, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(PORT), SENDGRID_API_KEY: "", STORAGE_BUCKET: "", ORG_SLUG: "hqhb" },
  });
  api.log = ""; api.stdout.on("data", (d) => (api.log += d)); api.stderr.on("data", (d) => (api.log += d));
  for (let i = 0; ; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} if (i > 240) throw new Error("API did not start"); await new Promise((r) => setTimeout(r, 500)); }

  // ---- two executives sign, in turn ----
  const id = await createDirect("Board resolution.pdf", [A, B]);
  let r = await approve(A, id);
  ck(r.status === 200, `the first executive signs (${r.status})`);
  let reg = await register(id);
  const noA = reg[0]?.sign_no;
  ck(reg.length === 1 && /^SF-\d{4}-\d{6}$/.test(noA || "") && reg[0].signer_id === A,
    `the signature gets a Sign Number in the register (${noA})`);
  ck(reg[0]?.user_agent === "sign-numbers-test" && !!reg[0]?.ip && reg[0]?.source === "live", "…with the browser, the address and 'recorded live'");
  let bytes = await signedBytes(id);
  ck(hasText(bytes, noA), "the number is printed on the signed PDF");
  ck((await PDFDocument.load(bytes)).getPageCount() === 1, "no audit page yet — someone still has to sign");

  r = await approve(B, id);
  ck(r.status === 200 && (await j(r)).request?.status === "approved", `the second executive signs; it is approved (${r.status})`);
  reg = await register(id);
  const noB = reg[1]?.sign_no;
  ck(reg.length === 2 && reg[0].sign_no === noA && noB && noB !== noA && reg[1].seq > reg[0].seq,
    `the second signature gets the next number, and the first keeps its own (${noA}, ${noB})`);
  bytes = await signedBytes(id);
  ck(hasText(bytes, noA) && hasText(bytes, noB), "both numbers are on the final PDF — the rebuild reprinted the first");
  ck((await PDFDocument.load(bytes)).getPageCount() === 2, "a fully signed document gains one audit page");
  ck(hasText(bytes, "Signature Audit Report") && hasText(bytes, id), "…the audit page names itself and carries the document ID");
  ck(reg[1].doc_sha256 === sha256(bytes), "the register holds the fingerprint of the final signed file");

  // ---- a single signer: numbered, and complete at once ----
  const single = await createDirect("Leave form.pdf", [A]);
  await approve(A, single);
  const sreg = await register(single);
  const sbytes = await signedBytes(single);
  ck(sreg.length === 1 && hasText(sbytes, sreg[0].sign_no) && (await PDFDocument.load(sbytes)).getPageCount() === 2,
    "a one-signature document is numbered and gets its audit page straight away");

  // ---- the admin register ----
  r = await fetch(`${BASE}/api/admin/sign-register?q=${encodeURIComponent(noA)}`, { headers: hdr(ADM) });
  let b = await j(r);
  ck(r.status === 200 && b.total === 1 && b.signatures[0].signNo === noA && b.signatures[0].signerName === "SN First Executive",
    `IT finds a signature by its Sign Number (${r.status}, ${b.total})`);
  r = await fetch(`${BASE}/api/admin/sign-register/${noB}`, { headers: hdr(ADM) });
  b = await j(r);
  ck(r.status === 200 && b.signature?.signNo === noB && b.document?.length === 2 && b.signature.docSha256,
    "…and its full trace, with every other signature on the same document");
  r = await fetch(`${BASE}/api/admin/sign-register?q=SN%20Second`, { headers: hdr(ADM) });
  ck((await j(r)).signatures?.some((s) => s.signNo === noB), "…or by the signer's name");
  r = await fetch(`${BASE}/api/admin/sign-register`, { headers: hdr(R) });
  ck(r.status === 403, `only administrators see the register (${r.status})`);
  await execute("UPDATE requests SET confidential = 1 WHERE id = ?", [id]);
  b = await j(await fetch(`${BASE}/api/admin/sign-register?q=Board%20resolution`, { headers: hdr(ADM) }));
  const b2 = await j(await fetch(`${BASE}/api/admin/sign-register/${noA}`, { headers: hdr(ADM) }));
  ck(b.total === 0 && b2.signature?.documentName === "Confidential document",
    "a confidential document is never named in the register, nor findable by its name");
  await execute("UPDATE requests SET confidential = 0 WHERE id = ?", [id]);

  // ---- signatures made before Sign Numbers: registered, PDF untouched ----
  const before = await signedBytes(single);
  await execute("DELETE FROM sign_register WHERE request_id = ?", [single]);
  const bf = await backfillRegister();
  const breg = await register(single);
  ck(bf.added >= 1 && breg.length === 1 && breg[0].source === "backfill", `an earlier signature is registered from the records (${bf.added} added)`);
  ck(Buffer.compare(before, await signedBytes(single)) === 0, "…and its PDF is left exactly as it was");
  ck((await backfillRegister()).added === 0, "running it again adds nothing");

  // ---- the register outlives the document ----
  const keep = (await register(single))[0]?.sign_no;
  await execute("DELETE sg FROM request_step_signers sg JOIN request_steps st ON st.id = sg.step_id WHERE st.request_id = ?", [single]);
  await execute("DELETE FROM request_steps WHERE request_id = ?", [single]);
  await execute("DELETE FROM requests WHERE id = ?", [single]);
  b = await j(await fetch(`${BASE}/api/admin/sign-register/${keep}`, { headers: hdr(ADM) }));
  ck(b.signature?.documentName === "Leave form.pdf" && b.signature?.requestedBy === "SN Requestor" && b.signature?.documentStatus === "deleted",
    `a deleted document's signatures stay in the register, still naming it (${b.signature?.documentName}, ${b.signature?.documentStatus})`);

  // ---- WAQF: not this feature ----
  process.env.ORG_SLUG = "waqf";
  ck((await assignSignNo({ requestId: id, signerRef: "x", signerId: A, signedAt: Date.now() })) === null, "on WAQF no number is given");
  process.env.ORG_SLUG = "hqhb";
} catch (e) {
  fail.push(`the run stopped early: ${e?.message || e}`);
} finally {
  for (const p of pass) console.log("  PASS  " + p);
  for (const f of fail) console.log("  FAIL  " + f);
  await cleanup().catch((e) => console.log("cleanup:", e.message));
  if (api) api.kill();
  console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
  if (fail.length && api) console.log(api.log.split("\n").filter((l) => /error|sign-register|stamp/i.test(l)).slice(-12).join("\n"));
  process.exit(fail.length ? 1 : 0);
}
