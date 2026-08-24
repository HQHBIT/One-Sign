// Unit: signature-box sizing.
// The two defects this replaces, both of which landed on the requestor as
// manual resizing: a percentage box is a different physical size on every paper
// size, and its shape rarely matched the signature going into it, so the
// contain-fitted stamp left slack.
import assert from "node:assert/strict";

const {
  mmToPt, ptToMm, boxPercentFor, boxMillimetres, snapBox,
  SIGNATURE_HEIGHTS_MM, DEFAULT_SIGNATURE_ASPECT, DATE_HEIGHT_MM, DATE_ASPECT,
} = await import("../src/lib/boxSize.js");

const A4     = { w: 595.28, h: 841.89 };
const LETTER = { w: 612, h: 792 };
const A3     = { w: 841.89, h: 1190.55 };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg} (got ${a}, want ~${b})`);

// ---- unit conversion ----
{
  near(mmToPt(25.4), 72, 1e-9, "an inch is 72 points");
  near(ptToMm(72), 25.4, 1e-9, "and back again");
}

// ---- THE fix: the same millimetres on every paper size ----
{
  const mm = SIGNATURE_HEIGHTS_MM.standard;
  for (const [name, page] of [["A4", A4], ["Letter", LETTER], ["A3", A3]]) {
    const box = boxPercentFor({ heightMm: mm, aspect: 3.2, pagePt: page });
    const real = boxMillimetres({ box, pagePt: page });
    near(real.h, mm, 0.01, `${name}: height is ${mm} mm`);
    near(real.w, mm * 3.2, 0.05, `${name}: width follows the aspect`);
  }

  // The old fixed percentage did NOT have this property — that was the bug.
  const oldA4 = boxMillimetres({ box: { w: 22, h: 6 }, pagePt: A4 });
  const oldA3 = boxMillimetres({ box: { w: 22, h: 6 }, pagePt: A3 });
  assert.ok(Math.abs(oldA4.w - oldA3.w) > 15,
    "the old percentage box really was a wildly different size across paper sizes");
}

// ---- the box takes the signature's shape, so a contain-fit leaves no slack ----
{
  for (const aspect of [1.0, 2.0, 3.2, 4.5]) {
    const box = boxPercentFor({ heightMm: 16, aspect, pagePt: A4 });
    const real = boxMillimetres({ box, pagePt: A4 });
    near(real.w / real.h, aspect, 1e-6, `box aspect matches a ${aspect}:1 signature`);

    // contain-fit of a same-aspect image fills the box exactly.
    const scale = Math.min(real.w / (aspect * 10), real.h / 10);
    near((aspect * 10 * scale) / real.w, 1, 1e-9, "fills the full width");
    near((10 * scale) / real.h, 1, 1e-9, "fills the full height");
  }
}

// ---- presets differ in height only, never in shape ----
{
  const boxes = Object.values(SIGNATURE_HEIGHTS_MM)
    .map(mm => boxMillimetres({ box: boxPercentFor({ heightMm: mm, aspect: 3.2, pagePt: A4 }), pagePt: A4 }));
  const aspects = boxes.map(b => b.w / b.h);
  for (const a of aspects) near(a, 3.2, 1e-6, "every preset keeps the signature's shape");
  assert.ok(boxes[0].h < boxes[1].h && boxes[1].h < boxes[2].h, "small < standard < large");
}

// ---- a missing aspect falls back rather than collapsing the box ----
{
  const box = boxPercentFor({ heightMm: 16, aspect: 0, pagePt: A4 });
  const real = boxMillimetres({ box, pagePt: A4 });
  near(real.w / real.h, DEFAULT_SIGNATURE_ASPECT, 1e-6, "unknown aspect uses the default");
  assert.ok(real.w > 0, "and the box still has width");
}

// ---- an unmeasured page yields null rather than a wrong box ----
{
  assert.equal(boxPercentFor({ heightMm: 16, aspect: 3, pagePt: null }), null, "no page, no box");
  assert.equal(boxPercentFor({ heightMm: 16, aspect: 3, pagePt: { w: 0, h: 0 } }), null, "zero page, no box");
  assert.equal(boxMillimetres({ box: { w: 10, h: 5 }, pagePt: null }), null, "no page, no readout");
}

// ---- a box can never exceed the page ----
{
  const huge = boxPercentFor({ heightMm: 5000, aspect: 20, pagePt: A4 });
  assert.ok(huge.w <= 90 && huge.h <= 90, "clamped inside the page");
}

// ---- dragging snaps to whole millimetres and keeps the shape ----
{
  const start = boxPercentFor({ heightMm: 16, aspect: 3.2, pagePt: A4 });
  const dragged = { w: start.w * 1.31, h: start.h * 1.31 };      // ~21mm, untidy
  const snapped = snapBox({ box: dragged, aspect: 3.2, pagePt: A4 });
  const real = boxMillimetres({ box: snapped, pagePt: A4 });
  near(real.h, Math.round(real.h), 1e-6, "height lands on a whole millimetre");
  near(real.w / real.h, 3.2, 1e-6, "and the shape survives the snap");
}

// ---- snapping respects its bounds ----
{
  const tiny = snapBox({ box: { w: 0.1, h: 0.05 }, aspect: 3.2, pagePt: A4, minMm: 6 });
  near(boxMillimetres({ box: tiny, pagePt: A4 }).h, 6, 1e-6, "cannot snap below the minimum");
  const vast = snapBox({ box: { w: 80, h: 80 }, aspect: 3.2, pagePt: A4, maxMm: 60 });
  near(boxMillimetres({ box: vast, pagePt: A4 }).h, 60, 1e-6, "cannot snap above the maximum");
}

// ---- a date box is short and wide, and much shorter than a signature ----
{
  const d = boxMillimetres({ box: boxPercentFor({ heightMm: DATE_HEIGHT_MM, aspect: DATE_ASPECT, pagePt: A4 }), pagePt: A4 });
  near(d.h, DATE_HEIGHT_MM, 0.01, "date box height");
  assert.ok(d.h < SIGNATURE_HEIGHTS_MM.small, "a date is shorter than the smallest signature");
  assert.ok(d.w > d.h * 3, "and considerably wider than it is tall");
}

console.log("boxSize: all tests passed");
