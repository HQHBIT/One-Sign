// ============================================================
//   Excel signing — end-to-end across every path that can stamp a workbook:
//     A single approver · B multi-step workflow · C send-to-a-person
//     D batch approve   · E placement/legibility · F "Sign your documents"
//     G requestor pre-signs their own upload
//   Needs the API running on :5001 (npm run dev:server).
// ============================================================
import { config } from "dotenv"; config({ path: "server/.env" });
import { diskPathFor } from "../src/filestore.js";
import fs from "fs/promises"; import path from "path"; import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
const { initDb, query, queryOne, execute } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
await initDb();
const B = "http://localhost:5001";
const fail = []; const ck = (c, m) => { if (!c) fail.push(m); };
const __dir = path.dirname(fileURLToPath(import.meta.url));
const SIGS = path.join(__dir, "..", "uploads", "signatures");
const SIGNED = path.join(__dir, "..", "uploads", "signed");
const DOCS = path.join(__dir, "..", "uploads", "documents");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
await fs.mkdir(SIGS, { recursive: true });

// a realistic workbook with content that must survive signing
const mk = new ExcelJS.Workbook();
const sh = mk.addWorksheet("Leave Form");
sh.addRow(["Employee", "Taha Chunawala"]);
sh.addRow(["Leave type", "Annual"]);
sh.addRow(["From", "07-08-2026"]);
sh.addRow([]);
sh.addRow(["Approver signature", ""]);
const xlsxBytes = await mk.xlsx.writeBuffer();

const clean = async () => {
  const rs = await query("SELECT id, file_path, signed_file_path FROM requests WHERE file_name = 'leave-form.xlsx'");
  for (const r of rs) {
    await execute("DELETE FROM notifications WHERE request_id=?", [r.id]);
    await execute("DELETE FROM requests WHERE id=?", [r.id]);
    if (r.file_path) await fs.unlink(diskPathFor("documents", r.file_path)).catch(() => {});
    if (r.signed_file_path) await fs.unlink(diskPathFor("signed", r.signed_file_path)).catch(() => {});
  }
  await execute("DELETE FROM signing_authority WHERE team_id = 't_xlzz'");
  await execute("DELETE FROM users WHERE id IN ('u_xa','u_xb','u_xr')");
  await execute("DELETE FROM teams WHERE id = 't_xlzz'");
};
await clean();

const now = Date.now();
await execute("INSERT INTO teams (id,name,created_at) VALUES ('t_xlzz','XL Team',?)", [now]);
for (const [id, name] of [["u_xa", "Ex Ay"], ["u_xb", "Ex Bee"], ["u_xr", "Ex Raiser"]]) {
  await fs.writeFile(path.join(SIGS, id + ".png"), PNG);
  await execute(
    "INSERT INTO users (id,email,password_hash,name,role,team_id,created_at,active,signature_path,signature_aspect) VALUES (?,?,?,?,'requestor','t_xlzz',?,1,?,1)",
    [id, id + ".xlzz@hqhb.in", bcrypt.hashSync("x", 4), name, now, id + ".png"]);
}
await execute("INSERT INTO signing_authority (user_id, team_id) VALUES ('u_xa','t_xlzz')");
const T = (id) => signToken(id);

async function imagesIn(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(diskPathFor("signed", file));
  const ws = wb.worksheets[0];
  return { images: ws.getImages().length, sheet: ws.name };
}
const upload = (extra) => {
  const fd = new FormData();
  fd.append("file", new Blob([xlsxBytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "leave-form.xlsx");
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
};
const post = (body, tok) => fetch(B + "/api/requests", { method: "POST", headers: { Authorization: "Bearer " + tok }, body });
const approve = (id, tok, instant) => fetch(B + "/api/requests/" + id + "/approve", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
  body: JSON.stringify(instant ? { instant: true } : {}) });

// ---------- A. SINGLE APPROVER ----------
let c = await post(upload({ targetTeamId: "t_xlzz", marker: JSON.stringify([{ page: 1, x: 40, y: 70, w: 22, h: 6 }]) }), T("u_xr"));
ck(c.status === 200, "A create " + c.status + ": " + (c.status !== 200 ? (await c.text()).slice(0, 140) : ""));
let id = c.status === 200 ? (await c.json()).request.id : null;
let a = await approve(id, T("u_xa"), true);
ck(a.status === 200, "A approve " + a.status + ": " + (a.status !== 200 ? (await a.text()).slice(0, 140) : ""));
let row = await queryOne("SELECT signed_file_path FROM requests WHERE id=?", [id]);
ck(/\.signed\.xlsx$/.test(row?.signed_file_path || ""), "A signed file should be .xlsx, got " + row?.signed_file_path);
let info = await imagesIn(row.signed_file_path);
ck(info.images === 1, "A: expected 1 embedded signature, got " + info.images);
console.log("A single-approver ->", row.signed_file_path, JSON.stringify(info));

// ---------- B. MULTI-STEP WORKFLOW, two sequenced signers ----------
c = await post(upload({ workflow: JSON.stringify([{ teamId: "t_xlzz", signers: [
  { userId: "u_xa", boxes: [{ page: 1, x: 20, y: 60, w: 22, h: 6 }], dateFields: [] },
  { userId: "u_xb", boxes: [{ page: 1, x: 60, y: 60, w: 22, h: 6 }], dateFields: [] }] }]) }), T("u_xr"));
ck(c.status === 200, "B create " + c.status + ": " + (c.status !== 200 ? (await c.text()).slice(0, 160) : ""));
id = c.status === 200 ? (await c.json()).request.id : null;
a = await approve(id, T("u_xa"), false);
ck(a.status === 200, "B signer1 " + a.status + ": " + (a.status !== 200 ? (await a.text()).slice(0, 160) : ""));
row = await queryOne("SELECT signed_file_path, status FROM requests WHERE id=?", [id]);
info = await imagesIn(row.signed_file_path);
ck(info.images === 1, "B after signer1: expected 1 image, got " + info.images);
a = await approve(id, T("u_xb"), true);
ck(a.status === 200, "B signer2 " + a.status + ": " + (a.status !== 200 ? (await a.text()).slice(0, 160) : ""));
row = await queryOne("SELECT signed_file_path, status FROM requests WHERE id=?", [id]);
info = await imagesIn(row.signed_file_path);
ck(info.images === 2, "B after signer2: expected 2 images, got " + info.images);
ck(row.status === "approved", "B final status " + row.status);
console.log("B multi-step      ->", row.signed_file_path, JSON.stringify(info));

// ---------- C. SEND TO A SPECIFIC PERSON ----------
c = await post(upload({ direct: "true", signers: JSON.stringify([{ userId: "u_xb", boxes: [{ page: 1, x: 30, y: 80, w: 22, h: 6 }], dateFields: [] }]) }), T("u_xr"));
ck(c.status === 200, "C create " + c.status + ": " + (c.status !== 200 ? (await c.text()).slice(0, 160) : ""));
id = c.status === 200 ? (await c.json()).request.id : null;
a = await approve(id, T("u_xb"), true);
ck(a.status === 200, "C approve " + a.status + ": " + (a.status !== 200 ? (await a.text()).slice(0, 160) : ""));
row = await queryOne("SELECT signed_file_path FROM requests WHERE id=?", [id]);
info = await imagesIn(row.signed_file_path);
ck(info.images === 1, "C: expected 1 embedded signature, got " + info.images);
ck(info.sheet === "Leave Form", "C: wrong sheet targeted (" + info.sheet + ")");
console.log("C direct          ->", row.signed_file_path, JSON.stringify(info));

// original content must survive the stamping
const wb2 = new ExcelJS.Workbook();
await wb2.xlsx.readFile(diskPathFor("signed", row.signed_file_path));
ck(wb2.worksheets[0].getCell("B1").value === "Taha Chunawala", "original cell content lost");
ck(wb2.worksheets[0].getCell("A5").value === "Approver signature", "original labels lost");

// ---------- D. BATCH APPROVE of a workflow xlsx (separate stamping path) ----------
await execute("UPDATE users SET role = 'approver' WHERE id = 'u_xa'");
c = await post(upload({ workflow: JSON.stringify([{ teamId: "t_xlzz", signers: [
  { userId: "u_xa", boxes: [{ page: 1, x: 25, y: 40, w: 22, h: 6 }], dateFields: [] }] }]) }), T("u_xr"));
ck(c.status === 200, "D create " + c.status);
id = c.status === 200 ? (await c.json()).request.id : null;
a = await fetch(B + "/api/requests/batch-approve", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + T("u_xa") },
  body: JSON.stringify({ ids: [id], instant: true }) });
const bres = a.status === 200 ? await a.json() : null;
ck(a.status === 200 && bres?.approved?.includes(id),
   "D batch approve " + a.status + " " + JSON.stringify(bres)?.slice(0, 160));
row = await queryOne("SELECT signed_file_path FROM requests WHERE id=?", [id]);
ck(/\.signed\.xlsx$/.test(row?.signed_file_path || ""), "D signed file should be .xlsx, got " + row?.signed_file_path);
info = row?.signed_file_path ? await imagesIn(row.signed_file_path) : { images: 0 };
ck(info.images === 1, "D batch: expected 1 embedded signature, got " + info.images);
console.log("D batch-approve   ->", row?.signed_file_path, JSON.stringify(info));

// ---------- E. PLACEMENT on a realistic sheet: right cell, legible size ----------
const { stampXlsx } = await import("../src/xlsx-sign.js");
const big = new ExcelJS.Workbook(); const bs = big.addWorksheet("Form");
for (let r = 1; r <= 30; r++) bs.addRow(Array.from({ length: 10 }, (_, i) => "c" + i));
const bigSrc = path.join(DOCS, "_xlplace.xlsx");
await big.xlsx.writeFile(bigSrc);
const outP = await stampXlsx({ srcPath: bigSrc, outName: "_xlplace",
  stamps: [{ signaturePath: path.join(SIGS, "u_xa.png"), x: 50, y: 50, w: 22, h: 6 }] });
const rb = new ExcelJS.Workbook(); await rb.xlsx.readFile(outP);
const im = rb.worksheets[0].getImages()[0];
ck(!!im, "E: no image embedded");
// 50% of 10 cols / 30 rows -> col 5, row 15 (0-based)
ck(im && im.range.tl.nativeCol === 5, "E: expected tl col 5, got " + im?.range?.tl?.nativeCol);
ck(im && im.range.tl.nativeRow === 15, "E: expected tl row 15, got " + im?.range?.tl?.nativeRow);
// 22% of 10 cols = 2.2 cols ~ 142px wide; 6% of 30 rows = 1.8 rows ~ 36px tall
const wPx = (im.range.br.nativeCol - im.range.tl.nativeCol) * 64;
ck(wPx >= 120, "E: signature too narrow (" + Math.round(wPx) + "px)");
console.log("E placement       -> tl", im.range.tl.nativeCol + "," + im.range.tl.nativeRow,
            "br", im.range.br.nativeCol + "," + im.range.br.nativeRow, "~" + Math.round(wPx) + "px wide");
await fs.unlink(bigSrc).catch(() => {}); await fs.unlink(outP).catch(() => {});

// ---------- F. SIGN YOUR DOCUMENTS (self-sign, stateless) ----------
const sfd = new FormData();
sfd.append("file", new Blob([xlsxBytes]), "leave-form.xlsx");
sfd.append("marks", JSON.stringify([{ type: "signature", page: 1, x: 30, y: 60, w: 22, h: 6 }]));
a = await fetch(B + "/api/requests/self-sign", { method: "POST", headers: { Authorization: "Bearer " + T("u_xb") }, body: sfd });
ck(a.status === 200, "F self-sign " + a.status + ": " + (a.status !== 200 ? (await a.clone().text()).slice(0, 160) : ""));
ck((a.headers.get("content-disposition") || "").includes(".signed.xlsx"), "F wrong filename: " + a.headers.get("content-disposition"));
if (a.status === 200) {
  const back = Buffer.from(await a.arrayBuffer());
  const sw = new ExcelJS.Workbook(); await sw.xlsx.load(back);
  const n = sw.worksheets[0].getImages().length;
  ck(n === 1, "F self-sign: expected 1 embedded signature, got " + n);
  ck(sw.worksheets[0].getCell("B1").value === "Taha Chunawala", "F self-sign: original content lost");
  console.log("F self-sign       -> " + back.length + " bytes, images=" + n);
}

// ---------- G. REQUESTOR PRE-SIGNS their own xlsx upload ----------
c = await post(upload({
  targetTeamId: "t_xlzz",
  marker: JSON.stringify([{ page: 1, x: 40, y: 70, w: 22, h: 6 }]),
  selfMarks: JSON.stringify([{ type: "signature", page: 1, x: 10, y: 10, w: 22, h: 6 }])
}), T("u_xr"));
ck(c.status === 200, "G create " + c.status + ": " + (c.status !== 200 ? (await c.text()).slice(0, 160) : ""));
id = c.status === 200 ? (await c.json()).request.id : null;
if (id) {
  // The requestor's mark is baked into the STORED upload, before any approval.
  const up = await queryOne("SELECT file_path FROM requests WHERE id=?", [id]);
  const uw = new ExcelJS.Workbook(); await uw.xlsx.readFile(diskPathFor("documents", up.file_path));
  ck(uw.worksheets[0].getImages().length === 1, "G: requestor's own signature not baked into the upload");
  a = await approve(id, T("u_xa"), true);
  ck(a.status === 200, "G approve " + a.status);
  row = await queryOne("SELECT signed_file_path FROM requests WHERE id=?", [id]);
  info = await imagesIn(row.signed_file_path);
  ck(info.images === 2, "G: expected requestor + approver signatures (2), got " + info.images);
  console.log("G self-mark+sign  ->", row.signed_file_path, JSON.stringify(info));
}

console.log(fail.length ? "FAIL (" + fail.length + "):\n - " + fail.join("\n - ") : "EXCEL SIGNING E2E PASSED - all paths");
await clean();
for (const id2 of ["u_xa", "u_xb", "u_xr"]) await fs.unlink(path.join(SIGS, id2 + ".png")).catch(() => {});
process.exit(fail.length ? 1 : 0);
