// Does the detector find Finance's signature boxes on a printed form?
//
//   node src/lib/expenseSignatureBoxes.test.mjs
//
// The text layer is synthesised rather than taken from a real PDF, deliberately:
// what is under test is the geometry — which column, which row, how tall — and
// synthetic anchors let a wrong answer be stated exactly instead of eyeballed.
// It also means the test runs without a fixture, so it still guards the logic on
// a machine that has never seen the form.
import assert from "node:assert/strict";
import { boxesFromTextItems, itemsFromTextContent } from "./expenseSignatureBoxes.js";

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);

// A signature block laid out the way the form prints it: headers on one row,
// four signatories below at an even pitch, three columns across.
const t = (text, x, y, w = 8, h = 1.6) => ({ text, x, y, w, h });
const page = [
  t("EXPENSE SUBMISSION", 30, 5, 40),
  t("Vendor Name", 5, 20),
  t("Particular", 6, 50, 10),
  t("Name & Designation", 26, 50, 18),
  t("Sign", 54, 50, 5),
  t("Date", 70, 50, 5),
  t("Requestor", 6, 55),
  t("Reviewer", 6, 61),
  t("Approver 1", 6, 67),
  t("Approver 2", 6, 73),
];

const boxes = boxesFromTextItems(page, 1);

ck(boxes.length === 4, `all four signatories found (${boxes.length})`);
ck(boxes.map(b => b.role).join(",") === "requestor,reviewer,approver1,approver2",
  `in printed order (${boxes.map(b => b.role).join(",")})`);
ck(boxes.every(b => b.page === 1), "carrying the page number");

// ---- the column ----
// Edges sit midway between adjacent header centres: Name centre 35, Sign centre
// 56.5, Date centre 72.5 -> left 45.75, right 64.5, minus the inset.
{
  const b = boxes[0];
  ck(b.x > 45 && b.x < 48, `left edge lands between the Name and Sign columns (${b.x})`);
  ck(b.x + b.w > 63 && b.x + b.w < 65, `right edge lands before the Date column (${(b.x + b.w).toFixed(2)})`);
  ck(boxes.every(x => Math.abs(x.x - b.x) < 0.01 && Math.abs(x.w - b.w) < 0.01),
    "every box shares that column");
}

// ---- the rows ----
{
  const tops = boxes.map(b => b.y);
  ck(tops.every((v, i) => i === 0 || v > tops[i - 1]), "boxes descend the page in order");
  ck(boxes.every(b => b.h > 4 && b.h < 6.5), `each is about one signatory tall (${boxes[0].h})`);
  // The last row has no successor, so it reuses the pitch rather than collapsing.
  ck(Math.abs(boxes[3].h - boxes[2].h) < 0.5,
    `the final box is the same height as the others (${boxes[3].h} vs ${boxes[2].h})`);
  // Consecutive boxes must not overlap, or two signatures would sit on each other.
  ck(boxes.every((b, i) => i === 0 || b.y >= boxes[i - 1].y + boxes[i - 1].h - 0.01),
    "no two boxes overlap");
}

// ---- it refuses rather than guesses ----
{
  ck(boxesFromTextItems([t("Requestor", 6, 55), t("Approver 1", 6, 67)], 1).length === 0,
    "no Sign header means no boxes, rather than a column invented from nothing");
  ck(boxesFromTextItems([], 1).length === 0, "an empty page yields nothing");
  ck(boxesFromTextItems(page.filter(i => !/^Reviewer$/.test(i.text)), 1).length === 3,
    "a missing signatory drops that box and keeps the rest");
}

// ---- a word above the header is not a signatory ----
// The form prints "Requestor" in its detail section too; only the one inside the
// signature block counts.
{
  const withDecoy = [t("Requestors Name", 5, 25), t("Requestor", 5, 30), ...page];
  const b = boxesFromTextItems(withDecoy, 1);
  ck(b.length === 4, `a decoy above the header is ignored (${b.length} boxes)`);
  ck(b[0].y > 50, `the Requestor box is taken from the block, not the decoy (y=${b[0].y})`);
}

// ---- the fitted path, using header centres measured off a real printout ----
// Exported from Excel at 98% on A4, these are where the three headers actually
// landed. The fit should recover column C's edges — 58.46 to 73.03 — rather than
// the midpoint of two centres, which sits a few millimetres left of the printed
// rule because the Name column is wider than the Sign column.
{
  const real = [
    t("Name & Designation", 37.69, 63.82, 17.64),
    t("Sign", 63.76, 63.82, 3.93),
    t("Date", 80.68, 63.82, 3.93),
    t("Requestor", 5.69, 66.5, 9.5),
    t("Reviewer", 5.69, 69.8, 9.5),
    t("Approver 1", 5.69, 72.98, 9.54),
    t("Approver 2", 5.69, 76.2, 9.54),
  ];
  const b = boxesFromTextItems(real, 1)[2];   // Approver 1
  ck(!!b && b.x > 59.0 && b.x < 59.7, `fitted left edge sits inside column C (${b && b.x})`);
  ck(!!b && (b.x + b.w) > 71.8 && (b.x + b.w) < 72.5,
    `fitted right edge sits inside column C (${b && (b.x + b.w).toFixed(2)})`);
  // The naive midpoint would have put it at 55.1, well into the Name column.
  ck(!!b && b.x > 57, "the fit is used in preference to the midpoint");
}

// ---- and a page that is NOT this form falls back rather than fitting wrongly ----
// Equal-width columns break the proportion the fit assumes; the Date check
// catches it, so the rough midpoint is used instead of a confident wrong answer.
{
  const evenly = [
    t("Name & Designation", 20, 50, 18),
    t("Sign", 45, 50, 5),
    t("Date", 65, 50, 5),
    t("Approver 1", 5, 56, 9),
    t("Approver 2", 5, 62, 9),
  ];
  const b = boxesFromTextItems(evenly, 1)[0];
  ck(!!b, "a differently proportioned form still yields a box");
  ck(!!b && b.x > 35 && b.x < 45, `and it is the midpoint estimate, not the fit (${b && b.x.toFixed(2)})`);
}

// ---- pdf.js coordinates are flipped, not passed through ----
// pdf.js measures from the bottom-left; markers measure from the top. Getting
// this backwards puts every box on the wrong half of the page.
{
  const items = itemsFromTextContent(
    { items: [{ str: "Sign", width: 40, height: 12, transform: [1, 0, 0, 12, 100, 700] }] },
    { width: 800, height: 1000 });
  const it = items[0];
  ck(Math.abs(it.x - 12.5) < 0.01, `x maps straight across (${it.x})`);
  ck(Math.abs(it.y - 28.8) < 0.01, `y is measured from the top (${it.y})`);
  ck(Math.abs(it.w - 5) < 0.01, `width is a percentage of the page (${it.w})`);
}

for (const p of pass) console.log("  PASS  " + p);
for (const f of fail) console.log("  FAIL  " + f);
console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
