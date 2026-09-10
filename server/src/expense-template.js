// ============================================================
//   EXPENSE SUBMISSION — filling Finance's own form
//   ------------------------------------------------------------
//   The printout has to be indistinguishable from the workbook Finance issued.
//   The reliable way to achieve that is not to reproduce the layout but to fill
//   it: the committed template IS their Requisition sheet, merges, fills,
//   borders, column widths, row heights, page setup and both logos included. A
//   rebuild in HTML could only ever approximate it, and would drift the first
//   time Finance moved a row.
//
//   VALUES, NOT FORMULAS. The source workbook computed its totals with formulas
//   and its names with VLOOKUPs into a hidden employee sheet. Those lookups are
//   gone with the sheet (see scripts/build-expense-template.mjs — it carried
//   staff records this repository must not publish), and the arithmetic is done
//   here instead. Writing a formula without a cached result leaves the cell
//   blank in anything that does not recalculate, which includes the in-app
//   viewer and most PDF conversions — so a printed form would show empty totals.
//
//   The signature boxes are NOT filled here. They already exist in the template
//   as cells merged across two rows, which is the spacing Finance drew, and
//   xlsx-sign.js stamps into that rectangle later.
// ============================================================
import ExcelJS from "exceljs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_PATH = path.join(__dirname, "..", "assets", "expense-template.xlsx");

const SHEET = "Requisition";

// Where each field lives. Named rather than scattered through the code so that
// a change to Finance's layout is a change to this table and nothing else.
export const CELLS = Object.freeze({
  department:      "B10",
  submissionDate:  "B11",
  prNo:            "B12",
  prDate:          "D12",
  requestorIts:    "B13",
  requestorName:   "B14",
  subDepartment:   "B15",
  inBudget:        "B16",
  projectId:       "B17",
  natureOfExpense: "B18",
  vendor:          "B19",
  grandTotalPage1: "D30",
  grandTotalPage2: "I49",
  budgetedTo:      "B47",
  budgetedAmount:  "B48",
  budgetedBalance: "B49",
});

// The two item tables. Page 1 carries eight lines; anything beyond continues on
// page 2, which the form itself says to print "only if the requirement list
// exceeds one page".
const PAGE1_ITEMS = { firstRow: 22, lastRow: 29, cols: { desc: "A", qty: "B", rate: "C", total: "D" } };
const PAGE2_ITEMS = { firstRow: 11, lastRow: 48, cols: { desc: "F", qty: "G", rate: "H", total: "I" } };
export const MAX_ITEMS =
  (PAGE1_ITEMS.lastRow - PAGE1_ITEMS.firstRow + 1) + (PAGE2_ITEMS.lastRow - PAGE2_ITEMS.firstRow + 1);

// The signature block. Each signatory occupies two rows: name on the first,
// designation on the second. `sign` is merged across both, and that merged
// rectangle is the box a signature is stamped into — already the right size,
// because it is the size Finance drew.
export const SIGNATORIES = Object.freeze({
  requestor: { name: "B32", designation: "B33", sign: "C32:C33", date: "D32:D33" },
  reviewer:  { name: "B34", designation: "B35", sign: "C34:C35", date: "D34:D35" },
  approver1: { name: "B36", designation: "B37", sign: "C36:C37", date: "D36:D37" },
  approver2: { name: "B38", designation: "B39", sign: "C38:C39", date: "D38:D39" },
});

const money = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
};

/**
 * Line totals and the grand total, computed rather than left to a formula.
 * Exported so a caller can show the same numbers on screen as the form prints,
 * without opening the workbook to find out what they are.
 */
export function totalsFor(items = []) {
  const lines = items.map((it) => {
    const qty = Number(it?.quantity);
    const rate = Number(it?.rate);
    const q = Number.isFinite(qty) ? qty : 0;
    const r = Number.isFinite(rate) ? rate : 0;
    return money(q * r);
  });
  return { lines, grand: money(lines.reduce((a, b) => a + b, 0)) };
}

/** Write only when there is something to write — a blank must not overwrite
 *  a value the template itself supplies, such as the standing approvers. */
function put(ws, addr, value) {
  if (value === undefined || value === null || value === "") return;
  ws.getCell(addr).value = value;
}

/**
 * Fill the expense form and return the .xlsx bytes.
 *
 * Signature images are applied afterwards by the signing path; this produces the
 * document they are stamped onto.
 *
 * @param {object} data
 * @returns {Promise<Buffer>}
 */
export async function fillExpenseForm(data = {}) {
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length > MAX_ITEMS) {
    throw new Error(`This form holds ${MAX_ITEMS} line items; ${items.length} were supplied`);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);
  const ws = wb.getWorksheet(SHEET);
  if (!ws) throw new Error(`Template is missing its ${SHEET} sheet`);

  for (const [field, addr] of Object.entries(CELLS)) {
    if (field.startsWith("grandTotal")) continue;   // computed below
    put(ws, addr, data[field]);
  }

  const { lines, grand } = totalsFor(items);
  const write = (table, from, count) => {
    for (let i = 0; i < count; i++) {
      const it = items[from + i];
      const row = table.firstRow + i;
      put(ws, `${table.cols.desc}${row}`, it.description);
      put(ws, `${table.cols.qty}${row}`, Number(it.quantity) || null);
      put(ws, `${table.cols.rate}${row}`, money(it.rate));
      ws.getCell(`${table.cols.total}${row}`).value = lines[from + i];
    }
  };
  const onPage1 = Math.min(items.length, PAGE1_ITEMS.lastRow - PAGE1_ITEMS.firstRow + 1);
  write(PAGE1_ITEMS, 0, onPage1);
  write(PAGE2_ITEMS, onPage1, items.length - onPage1);

  // Both totals, because the form prints the figure on each page and the second
  // one was the formula the first referred to.
  ws.getCell(CELLS.grandTotalPage1).value = grand;
  ws.getCell(CELLS.grandTotalPage2).value = grand;

  const who = data.signatories || {};
  for (const [role, cells] of Object.entries(SIGNATORIES)) {
    const person = who[role];
    if (!person) continue;               // leave the template's standing approver
    put(ws, cells.name, person.name);
    put(ws, cells.designation, person.designation);
    put(ws, cells.date.split(":")[0], person.date);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Where a signature belongs, as a cell rectangle.
 *
 * xlsx-sign.js anchors an image to a rectangle rather than to pixels, so the
 * stamp lands inside the box at whatever size Finance's row heights make it —
 * which is what "the box space is already created" means in practice.
 */
export function signBoxFor(role) {
  const s = SIGNATORIES[role];
  if (!s) throw new Error(`Unknown signatory: ${role}`);
  const [tl, br] = s.sign.split(":");
  return { sheet: SHEET, topLeft: tl, bottomRight: br };
}
