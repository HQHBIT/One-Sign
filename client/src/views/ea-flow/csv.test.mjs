// The dashboard export. This is the artefact that gets sent upward, so the
// things worth asserting are the ones nobody notices until a spreadsheet is
// already in someone else's inbox: a name with a comma in it, a reader who has
// not opened the document, a stage that was skipped.
//
//   node --test client/src/views/ea-flow/csv.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { buildFlowCsv } from "./csv.js";

const stages = [
  { id: "s1", name: "In", kind: "plain" },
  { id: "s2", name: "Signs", kind: "signature" },
  { id: "s3", name: "Concern", kind: "cc" },
  { id: "s4", name: "Done", kind: "plain" },
];

const doc = {
  title: "Board paper",
  fileName: "paper.pdf",
  createdAt: 1700000000000,
  currentStageId: "s4",
  enteredStageAt: 1700000600000,
  completedAt: null,
  totalMs: 3600000,
  stages: [
    { stageId: "s1", ms: 600000, skipped: false },
    { stageId: "s2", ms: 0, skipped: true },
    { stageId: "s3", ms: 1200000, skipped: false },
    { stageId: "s4", ms: 0, skipped: false },
  ],
  cc: [
    { stageId: "s3", name: "Ali Khan", notifiedAt: 1700001000000, viewedAt: 1700002000000 },
    { stageId: "s3", name: "Sara, the second", notifiedAt: 1700001000000, viewedAt: null },
  ],
};

// A CSV row is not simply "split on comma": a quoted field may contain commas
// and newlines, which is exactly what the CC column does.
function parse(csv) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r" && csv[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

test("a CC stage gets its own column, named after the stage", () => {
  const [head] = parse(buildFlowCsv({ stages, documents: [doc] }));
  assert.ok(head.includes("Copied to Concern"), head.join(" | "));
  // One column per CC stage, not one for all of them, and not for the others.
  assert.equal(head.filter((h) => h.startsWith("Copied to ")).length, 1);
  assert.ok(!head.includes("Copied to Signs"));
});

test("every person copied appears, with whether they opened it", () => {
  const [head, row] = parse(buildFlowCsv({ stages, documents: [doc] }));
  const cell = row[head.indexOf("Copied to Concern")];
  assert.match(cell, /Ali Khan — opened /);
  assert.match(cell, /Sara, the second — not opened/);
  // One per line, so the cell stays readable however many are copied.
  assert.equal(cell.split("\n").length, 2);
});

test("a name containing a comma does not split the row", () => {
  const rows = parse(buildFlowCsv({ stages, documents: [doc] }));
  // The header decides the width; a comma inside a quoted field must not add a
  // column, which is the classic way an export silently corrupts itself.
  assert.equal(rows[1].length, rows[0].length);
});

test("skipped stages are named, and unvisited ones are not", () => {
  const [head, row] = parse(buildFlowCsv({ stages, documents: [doc] }));
  // s2 was skipped; s4 simply has no time on it yet. Only the first is a
  // decision anyone made.
  assert.equal(row[head.indexOf("Stages skipped")], "Signs");
});

test("a board with no CC stage gains no CC column", () => {
  const plain = stages.filter((s) => s.kind !== "cc");
  const [head] = parse(buildFlowCsv({
    stages: plain,
    documents: [{ ...doc, cc: [], stages: doc.stages.filter((s) => s.stageId !== "s3") }],
  }));
  assert.equal(head.filter((h) => h.startsWith("Copied to ")).length, 0);
  assert.ok(head.includes("Stages skipped"));
});

test("a document nobody has been copied on leaves the cell empty, not 'undefined'", () => {
  const [head, row] = parse(buildFlowCsv({ stages, documents: [{ ...doc, cc: [] }] }));
  assert.equal(row[head.indexOf("Copied to Concern")], "");
});
