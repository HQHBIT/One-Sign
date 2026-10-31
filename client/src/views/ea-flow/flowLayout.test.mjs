// node --test client/src/views/ea-flow/flowLayout.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { flowRows, perRowFor } from "./flowLayout.js";

test("seven stages, three to a row, snake down the page", () => {
  assert.deepEqual(flowRows(7, 3), [
    { reversed: false, slots: [0, 1, 2], downAt: 2 },
    { reversed: true, slots: [5, 4, 3], downAt: 0 },
    { reversed: false, slots: [6, null, null], downAt: null },
  ]);
});

test("a short reversed row starts under the arrow, on the right", () => {
  assert.deepEqual(flowRows(4, 3)[1], { reversed: true, slots: [null, null, 3], downAt: null });
});

test("every stage appears exactly once, in order along the path", () => {
  for (const per of [1, 2, 3]) {
    for (let count = 0; count <= 10; count++) {
      const rows = flowRows(count, per);
      const path = rows.flatMap((r) => (r.reversed ? [...r.slots].reverse() : r.slots)).filter((x) => x !== null);
      assert.deepEqual(path, [...Array(count).keys()], `count ${count}, ${per} per row`);
      // The down arrow sits under the row's last stage, and the next row's first
      // stage is directly beneath it.
      rows.forEach((r, i) => {
        if (r.downAt === null) return assert.equal(i, rows.length - 1);
        const lastOfRow = Math.max(...r.slots.filter((x) => x !== null));
        assert.equal(r.slots[r.downAt], lastOfRow);
        assert.equal(rows[i + 1].slots[r.downAt], lastOfRow + 1);
      });
    }
  }
});

test("one per row on a phone is a straight column", () => {
  assert.deepEqual(flowRows(3, 1).map((r) => r.slots), [[0], [1], [2]]);
  assert.deepEqual(flowRows(3, 1).map((r) => r.downAt), [0, 0, null]);
});

test("rows per width", () => {
  assert.equal(perRowFor(1280), 3);
  assert.equal(perRowFor(800), 2);
  assert.equal(perRowFor(390), 1);
});
