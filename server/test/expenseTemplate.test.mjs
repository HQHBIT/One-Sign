// Does a filled expense form still look like Finance's document?
//
//   node test/expenseTemplate.test.mjs
//
// No database, no server. What is under test is fidelity: values landing in the
// right cells matters, but the reason the workbook is filled rather than rebuilt
// is that the printout must be indistinguishable from the original. So the
// geometry is asserted too — merges, logos, column widths, row heights, page
// setup — because those are what "exactly the same" actually means, and a
// library upgrade could quietly drop any of them while every value still passed.
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { fillExpenseForm, totalsFor, signBoxFor, SIGNATORIES, CELLS, MAX_ITEMS } from "../src/expense-template.js";

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);

const items = [
  { description: "Toner cartridges (HP 26A)", quantity: 4, rate: 3250 },
  { description: "A4 paper, 75gsm (box of 5 reams)", quantity: 12, rate: 1180 },
  { description: "Whiteboard markers", quantity: 24, rate: 45.5 },
];

const bytes = await fillExpenseForm({
  department: "DAWAT E HADIYAH",
  submissionDate: "2026-09-10",
  prNo: "PR-2026-0417",
  prDate: "2026-09-08",
  requestorIts: "30365742",
  requestorName: "M. Murtaza Kotwala",
  subDepartment: "Information Technology",
  inBudget: "Yes",
  natureOfExpense: "Office Supplies e.g. Stationary or other grocery etc.",
  vendor: "Alvazarat Supplies Pvt Ltd",
  items,
  signatories: {
    requestor: { name: "M. Murtaza Kotwala", designation: "Analyst", date: "2026-09-10" },
  },
});

ck(Buffer.isBuffer(bytes) && bytes.length > 10000, `produced a workbook (${bytes.length} bytes)`);

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(bytes);
const ws = wb.getWorksheet("Requisition");
const val = (a) => {
  const v = ws.getCell(a).value;
  return v && typeof v === "object" ? (v.result ?? v.text ?? v) : v;
};

// ---- the document is still Finance's document ----
{
  ck(wb.worksheets.length === 1, `only the form ships — no hidden employee data (${wb.worksheets.length} sheet)`);
  ck((ws.model.merges || []).length === 30, `all 30 merges survive (${(ws.model.merges || []).length})`);
  ck((wb.model.media?.length || 0) === 2, "both logos survive");
  ck(Math.round(ws.getColumn(1).width) === 31, `column A keeps its width (${ws.getColumn(1).width})`);
  ck(ws.getRow(10).height === 28, `row 10 keeps its height (${ws.getRow(10).height})`);
  const ps = ws.pageSetup || {};
  ck(ps.orientation === "portrait" && ps.scale === 98, `page setup intact (${ps.orientation} @ ${ps.scale}%)`);
  ck(!!ws.getCell("A9").style?.border?.top, "the header rule is still drawn");
  ck(!!ws.getCell("A9").style?.fill, "the header band is still filled");
}

// ---- and nothing reaches for a sheet that no longer exists ----
{
  const dangling = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const f = typeof cell.value === "object" && cell.value ? cell.value.formula : null;
      if (f && /Master|DOA|Emp_byName|Employees|ExpList|DOAMatrix/i.test(f)) dangling.push(cell.address);
    });
  });
  ck(dangling.length === 0, `no formula points at a removed sheet (${dangling.join(",") || "none"})`);
}

// ---- the values ----
{
  ck(val(CELLS.requestorName) === "M. Murtaza Kotwala", "requestor name is written, not looked up");
  ck(val(CELLS.subDepartment) === "Information Technology", "sub-department is written");
  ck(val(CELLS.vendor) === "Alvazarat Supplies Pvt Ltd", "vendor is written");
  ck(val("A22") === "Toner cartridges (HP 26A)", "first line item lands on page 1");
  ck(val("A24") === "Whiteboard markers", "third line item lands on page 1");
}

// ---- totals are NUMBERS, not formulas ----
// A formula with no cached result prints as an empty box, which on an expense
// form is the one thing nobody would notice until it was signed.
{
  const { grand } = totalsFor(items);
  ck(val("D22") === 13000, `line total computed (${val("D22")})`);
  ck(val("D24") === 1092, `a fractional rate still totals correctly (${val("D24")})`);
  ck(typeof ws.getCell("D22").value === "number", "line total is a number, not a formula");
  ck(val(CELLS.grandTotalPage1) === grand, `grand total on page 1 (${val(CELLS.grandTotalPage1)})`);
  ck(val(CELLS.grandTotalPage2) === grand, "and the same figure on page 2");
}

// ---- the signature boxes ----
{
  const merges = ws.model.merges || [];
  for (const [role, cells] of Object.entries(SIGNATORIES)) {
    ck(merges.includes(cells.sign), `${role}: sign box ${cells.sign} is a two-row merged cell`);
  }
  ck(val("B36") === "Huzaifa Bsb", "the standing approver Finance printed is preserved");
  ck(val("B37") === "Finance HOD", "with their designation");
  ck(val("B32") === "M. Murtaza Kotwala", "and a supplied signatory overwrites their row");

  const box = signBoxFor("approver1");
  ck(box.topLeft === "C36" && box.bottomRight === "C37",
    `approver 1 stamps into ${box.topLeft}:${box.bottomRight}`);
}

// ---- refuses more than the form can hold ----
{
  let threw = "";
  try {
    await fillExpenseForm({ items: Array.from({ length: MAX_ITEMS + 1 }, () => ({ quantity: 1, rate: 1 })) });
  } catch (e) { threw = e.message; }
  ck(/holds \d+ line items/.test(threw), `too many items is refused, not silently truncated (${threw || "no error"})`);
}

for (const p of pass) console.log("  PASS  " + p);
for (const f of fail) console.log("  FAIL  " + f);
console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
