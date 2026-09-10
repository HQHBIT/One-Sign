// Build the committed expense template from the workbook Finance supplied.
//
//   node scripts/build-expense-template.mjs "<source.xlsx>"
//
// The source is NOT in this repository and must not be. It carries two hidden
// sheets — Master, with roughly 140 employees' names, ITS numbers, departments
// and designations, and DOA, the delegation-of-authority matrix. This repository
// is public, so committing the file as supplied would publish staff records.
//
// What is committed is the Requisition sheet alone: the printable form, with its
// merges, fills, borders, column widths, row heights, page setup and both logos
// exactly as Finance drew them. That is the whole point of keeping the workbook
// rather than rebuilding the layout in HTML — the printout is identical because
// it IS their document.
//
// Removing the hidden sheets breaks every lookup that pointed at them, so those
// formulas are cleared here and the fill engine writes real values instead. The
// app already knows the things Master was being asked: it has the users, their
// departments and who signs for them.
import ExcelJS from "exceljs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "assets");
const OUT = path.join(OUT_DIR, "expense-template.xlsx");
const HEADS_OUT = path.join(OUT_DIR, "expense-heads.json");

const SRC = process.argv[2];
if (!SRC) {
  console.error("Usage: node scripts/build-expense-template.mjs \"<source.xlsx>\"");
  process.exit(1);
}

// Formulas that read the hidden sheets. Cleared rather than left to become
// #REF!, because the fill engine supplies each of these from the database.
const LOOKUP_CELLS = [
  "B14", "C14", "D14",   // requestor name      <- Master
  "B15", "C15", "D15",   // sub-department      <- Employees[]
  "B32",                 // requestor, signature table (=B14)
  "B33",                 // requestor designation <- Emp_byName
  "B34", "B35",          // reviewer name + designation <- Emp_byName
  "D51",                 // approval level      <- DOA matrix
];

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(SRC);

// ---- salvage the expense heads before the sheet holding them is removed ----
// A list of spending categories is not personal data, and "Nature of Expenses"
// needs it. The DOA thresholds are deliberately NOT taken: routing belongs to
// the application's own signing authority, not to a frozen copy of a spreadsheet.
const doa = wb.getWorksheet("DOA");
const heads = [];
if (doa) {
  doa.eachRow({ includeEmpty: false }, (row, r) => {
    if (r < 3) return;                       // rows 1-2 are the matrix headings
    const v = row.getCell(1).value;
    const s = typeof v === "object" && v ? (v.result ?? v.text ?? "") : v;
    const name = String(s ?? "").trim();
    if (name) heads.push(name);
  });
}

// ---- remove the sheets carrying personal data ----
for (const name of ["Master", "DOA"]) {
  const ws = wb.getWorksheet(name);
  if (ws) wb.removeWorksheet(ws.id);
}

const ws = wb.getWorksheet("Requisition");
if (!ws) throw new Error("Requisition sheet not found in the source workbook");

// ---- take every formula out, keeping what it had computed ----
//
// Two reasons, and the second one is not optional.
//
// The template uses SHARED formulas: D22 is a master and D23, D25 and the rest
// are clones that only say "same as the cell above". Writing a value into the
// master orphans its clones, and ExcelJS then refuses to save the workbook at
// all — "Shared Formula master must exist above and or left of clone". A form
// nobody can fill is worse than one that computes nothing.
//
// And a formula carries no value of its own. Written without a cached result it
// prints as an empty box in anything that does not recalculate, which includes
// the in-app viewer and most PDF conversions. On an expense form the empty box
// would be the total.
//
// The cached result is kept where the formula was really a caption — F49 and G49
// just echo A30 — and dropped where it was a lookup, since those had resolved to
// "Please mention employee ID in B11" and the engine supplies the real name.
let cleared = 0, keptText = 0;
ws.eachRow({ includeEmpty: false }, (row) => {
  row.eachCell({ includeEmpty: false }, (cell) => {
    const v = cell.value;
    if (!v || typeof v !== "object" || !(v.formula || v.sharedFormula)) return;
    const cached = v.result;
    const usable =
      !LOOKUP_CELLS.includes(cell.address) &&
      cached !== undefined && cached !== null && cached !== "" &&
      !(typeof cached === "object" && cached.error);
    cell.value = usable ? cached : null;
    if (usable) keptText++; else cleared++;
  });
});

// ---- drop validations whose list lives in a removed sheet ----
// A generated document is filled, not typed into, so a dropdown buys nothing —
// and one pointing at a defined name that no longer resolves makes Excel warn
// about the file the moment it opens.
const dv = ws.dataValidations?.model || {};
let removed = 0;
for (const [addr, rule] of Object.entries(dv)) {
  const refs = (rule?.formulae || []).join(" ");
  if (/ExpList|Emp_byName|EmployeeList|Expenses_Head|SDEPTLIST|Master|DOA/i.test(refs)) {
    delete dv[addr];
    removed++;
  }
}

// Defined names resolve into the deleted sheets; leaving them dangling is the
// other half of that same warning.
try { wb.definedNames.model = []; } catch { /* older exceljs shapes */ }

await fs.mkdir(OUT_DIR, { recursive: true });
await wb.xlsx.writeFile(OUT);
await fs.writeFile(HEADS_OUT, JSON.stringify(heads, null, 2) + "\n");

// ---- prove the result, rather than assume it ----
const check = new ExcelJS.Workbook();
await check.xlsx.readFile(OUT);
const cws = check.getWorksheet("Requisition");

const leaks = [];
cws.eachRow({ includeEmpty: false }, (row) => {
  row.eachCell({ includeEmpty: false }, (cell) => {
    const f = typeof cell.value === "object" && cell.value ? cell.value.formula : null;
    if (f && /Master|DOA|Emp_byName|Employees|ExpList|DOAMatrix/i.test(f)) {
      leaks.push(`${cell.address}: ${f}`);
    }
  });
});

console.log(`formulas removed:   ${cleared} (kept ${keptText} cached captions)`);
console.log(`sheets kept:        ${check.worksheets.map(w => w.name).join(", ")}`);
console.log(`merges:             ${(cws.model.merges || []).length}`);
console.log(`images:             ${check.model.media?.length || 0}`);
console.log(`validations removed:${removed}`);
console.log(`expense heads saved:${heads.length} -> ${path.relative(process.cwd(), HEADS_OUT)}`);
console.log(`formulas still reaching a removed sheet: ${leaks.length ? "\n  " + leaks.join("\n  ") : "none"}`);
console.log(`written:            ${path.relative(process.cwd(), OUT)}`);
if (leaks.length) process.exit(1);
