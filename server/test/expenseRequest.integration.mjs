// Does an expense request work end to end against a running server?
//
//   node --env-file=.env test/expenseRequest.integration.mjs
//
// Needs the API running on :5001, started from THIS build.
//
// The unit test proves the workbook is filled correctly. This one proves the
// rest of the claim: that a request with no uploaded file is accepted, that the
// document stored against it is Finance's form rather than an empty shell, and
// that the approver's signature marker points at the box they drew — column C,
// rows 36 and 37, the row their form labels "Huzaifa Bsb".
//
// It signs its own tokens rather than logging in, the way every other
// integration test here does. No password is typed anywhere.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { initDb, execute, query, queryOne } from "../src/db.js";
import { signToken } from "../src/auth.js";
import { readStored } from "../src/filestore.js";

const B = process.env.TEST_BASE_URL || "http://127.0.0.1:5001";
await initDb();

const now = Date.now();
const ids = ["u_exp_r", "u_exp_a"];
const clean = async () => {
  await query("DELETE FROM requests WHERE requestor_id = 'u_exp_r'");
  await query("DELETE FROM signing_authority WHERE team_id = 't_exp'");
  await query(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  await query("DELETE FROM teams WHERE id = 't_exp'");
};
await clean();

// A real PNG, so the signing path has an image to stamp rather than a path that
// happens not to resolve.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8//8/AzZgYsAB" +
  "RiwGABQeAgO9r1G0AAAAAElFTkSuQmCC", "base64");
// Written only when absent. In development the server runs under `node --watch`,
// and rewriting a file inside its tree restarts it — mid-request, which arrives
// here as ECONNRESET and reads as a failure of the thing under test rather than
// of the test's own housekeeping.
const SIG_DIR = path.join(process.cwd(), "uploads", "signatures");
await fs.mkdir(SIG_DIR, { recursive: true });
for (const name of ["u_exp_a.png", "u_exp_r.png"]) {
  const p = path.join(SIG_DIR, name);
  try { await fs.access(p); } catch { await fs.writeFile(p, PNG); }
}

await execute("INSERT INTO teams (id,name,created_at) VALUES ('t_exp','Expense Probe Team',?)", [now]);
const hash = bcrypt.hashSync("x", 4);
for (const [id, email, name, role] of [
  ["u_exp_r", "exp.req@demo.local", "Expense Requestor", "requestor"],
  ["u_exp_a", "exp.app@demo.local", "Expense Approver", "approver"],
]) {
  await execute(
    "INSERT INTO users (id,email,password_hash,name,role,team_id,created_at,active,signature_path,signature_aspect) VALUES (?,?,?,?,?,?,?,1,?,3)",
    [id, email, hash, name, role, "t_exp", now, `${id}.png`]);
}
await execute("INSERT INTO signing_authority (user_id,team_id) VALUES ('u_exp_a','t_exp')");
const auth = (id) => ({ Authorization: "Bearer " + signToken(id) });

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);

// ---- submit an expense: no file, just the form ----
const expense = {
  department: "DAWAT E HADIYAH",
  submissionDate: "2026-09-10",
  prNo: "PR-2026-0417",
  prDate: "2026-09-08",
  requestorIts: "30365742",
  subDepartment: "Information Technology",
  inBudget: "Yes",
  natureOfExpense: "Office Supplies e.g. Stationary or other grocery etc.",
  vendor: "Alvazarat Supplies Pvt Ltd",
  items: [
    { description: "Toner cartridges (HP 26A)", quantity: 4, rate: 3250 },
    { description: "A4 paper, 75gsm", quantity: 12, rate: 1180 },
  ],
};

const fd = new FormData();
fd.append("expense", JSON.stringify(expense));
fd.append("targetTeamId", "t_exp");
fd.append("requestType", "expense");

let r = await fetch(B + "/api/requests", { method: "POST", headers: auth("u_exp_r"), body: fd });
const created = await r.json().catch(() => ({}));
ck(r.status === 200, `an expense submits with no file attached (${r.status} ${created.error || ""})`);
if (r.status !== 200) {
  for (const f of fail) console.log("  FAIL  " + f);
  await clean();
  process.exit(1);
}
const id = created.request.id;

// ---- what got stored is Finance's form, filled ----
{
  const row = await queryOne("SELECT * FROM requests WHERE id = ?", [id]);
  ck(row.file_type === "xlsx", `stored as a workbook (${row.file_type})`);
  ck(row.request_type === "expense", `typed as an expense (${row.request_type})`);
  ck(/Expense Submission/.test(row.file_name), `named for what it is (${row.file_name})`);

  const bytes = await readStored("documents", row.file_path);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const ws = wb.getWorksheet("Requisition");
  const val = (a) => { const v = ws.getCell(a).value; return v && typeof v === "object" ? (v.result ?? v.text ?? v) : v; };

  ck(!!ws, "the stored document has Finance's sheet");
  ck((ws.model.merges || []).length === 30, `its 30 merges survived the round trip (${(ws.model.merges || []).length})`);
  ck((wb.model.media?.length || 0) === 2, "both logos survived");
  ck(val("B19") === "Alvazarat Supplies Pvt Ltd", "the vendor is on the form");
  ck(val("A22") === "Toner cartridges (HP 26A)", "the first line item is on the form");
  ck(val("D22") === 13000, `its total is computed, not blank (${val("D22")})`);
  ck(val("D30") === 27160, `the grand total is on the form (${val("D30")})`);
  ck(val("B14") === "Expense Requestor", "the requestor is taken from the session, not the payload");
  ck(val("B36") === "Huzaifa Bsb", "the standing approver Finance printed is still there");

  // ---- and the approver signs in the box, not near it ----
  // Stored as a bare object for a single-marker request and as an array when
  // several boxes were placed. Reading only one shape silently yields an empty
  // marker, which then "passes" as position zero — so both are handled.
  const parsedMarker = JSON.parse(row.marker_json || "{}");
  const marker = Array.isArray(parsedMarker) ? (parsedMarker[0] || {}) : (parsedMarker || {});
  assert.ok(Number.isFinite(Number(marker.x)), "marker_json carried a usable marker");
  const cols = Math.max(ws.columnCount || 0, ws.actualColumnCount || 0, 1);
  const rows = Math.max(ws.rowCount || 0, ws.actualRowCount || 0, 1);
  const pct = (v) => Math.max(0, Math.min(100, Number(v) || 0)) / 100;
  const left = Math.round(pct(marker.x) * cols);
  const top = Math.round(pct(marker.y) * rows) + 1;
  const bottom = Math.round(pct(marker.y + marker.h) * rows);
  ck(left === 2, `the marker sits in column C (index ${left})`);
  ck(top === 36 && bottom === 37, `spanning rows 36-37, the "Huzaifa Bsb" box (${top}-${bottom})`);
}

// ---- approving it puts a signature inside that box ----
{
  r = await fetch(`${B}/api/requests/${id}/approve`, {
    method: "POST",
    headers: { ...auth("u_exp_a"), "Content-Type": "application/json" },
    body: JSON.stringify({ instant: true }),
  });
  ck(r.status === 200, `the approver signs it (${r.status})`);

  const row = await queryOne("SELECT status, signed_file_path FROM requests WHERE id = ?", [id]);
  ck(row.status === "approved", `and it is approved (${row.status})`);
  ck(!!row.signed_file_path, "a signed workbook was produced");

  if (row.signed_file_path) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await readStored("signed", row.signed_file_path));
    const ws = wb.getWorksheet("Requisition");
    const imgs = ws.getImages?.() || [];
    // Two logos were already on the sheet; the signature is the addition, and it
    // has to land on the signature row rather than merely be present.
    const inBox = imgs.filter(im => {
      const tl = im.range?.tl;
      return tl && Math.round(tl.col) === 2 && tl.row >= 34 && tl.row <= 37;
    });
    ck(imgs.length >= 3, `the signed sheet carries the signature as well as the logos (${imgs.length} images)`);
    ck(inBox.length >= 1, `a signature is anchored inside the approver's box (${inBox.length} there)`);
  }
}

for (const p of pass) console.log("  PASS  " + p);
for (const f of fail) console.log("  FAIL  " + f);
await clean();
console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
