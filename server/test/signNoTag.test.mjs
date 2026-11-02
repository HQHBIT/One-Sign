// Unit: the Sign Number tag printed on the page is small, and says only the
// number. It began life as "SF-2026-000123 · Signed via SignFlow · 31 Oct 2026,
// 2:05 pm IST" in a box a third of the page wide, which got in the document's
// way (owner, 2026-11-02). Everything that line used to say still exists — on
// the audit page and in the admin register — but the page itself only needs to
// point at the entry.
//
//   node --test server/test/signNoTag.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { StandardFonts, PDFDocument } from "pdf-lib";
import { signNoText, signNoBox } from "../src/pdf.js";

const SIG = { page: 1, x: 20, y: 60, w: 25, h: 8 };

test("the tag is the Sign Number and nothing else", () => {
  assert.equal(signNoText("SF-2026-000123"), "SF-2026-000123");
  // The things that used to crowd the page are gone from it.
  assert.ok(!signNoText("SF-2026-000123").includes("SignFlow"));
  assert.ok(!/\d{1,2}:\d{2}/.test(signNoText("SF-2026-000123")));
});

test("a missing number prints nothing rather than 'undefined'", () => {
  assert.equal(signNoText(undefined), "");
  assert.equal(signNoText(null), "");
});

test("the box hugs the signature instead of spanning the page", () => {
  const box = signNoBox(SIG);
  // The old box was at least 34% of the page wide. This one is a tag.
  assert.ok(box.w <= 25, `width ${box.w} should not spread across the page`);
  assert.ok(box.h <= 1.6, `height ${box.h} should stay small`);
  // Centred under the signature, and on its page.
  assert.equal(box.page, 1);
  const tagMid = box.x + box.w / 2, sigMid = SIG.x + SIG.w / 2;
  assert.ok(Math.abs(tagMid - sigMid) < 0.001, "tag should sit centred under the signature");
  assert.ok(box.y >= SIG.y + SIG.h, "tag should sit below the signature, not over it");
});

test("a narrow signature still gets a box the number fits in", async () => {
  // The box is in page-percent, so a tiny signature would otherwise shrink the
  // text away. 13% of A4 is ~77pt; the number needs ~45pt at 6pt Helvetica.
  const box = signNoBox({ ...SIG, w: 6 });
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const widthPt = font.widthOfTextAtSize("SF-2026-000123", 6);
  const boxPt = (box.w / 100) * 595.28 * 0.96;   // drawTextInBox uses 96% of the box
  assert.ok(boxPt >= widthPt, `box ${boxPt.toFixed(1)}pt must fit the number's ${widthPt.toFixed(1)}pt`);
});

test("a date stamped under the signature pushes the tag below it", () => {
  const date = { type: "date", page: 1, x: 22, y: 68.2, w: 12, h: 2 };
  const box = signNoBox(SIG, [date]);
  const without = signNoBox(SIG, []);
  // Below the date's TEXT, which stops short of its box's bottom edge — the
  // tag used to clear the whole box and so sat a line too low. What matters is
  // that the date still pushes it down at all.
  assert.ok(box.y > without.y, "the tag must move down for the date, not ignore it");
  assert.ok(box.y < date.y + date.h, "…but only as far as the date's glyphs, not its box");
});

test("no room below the signature puts the tag above it", () => {
  const low = { page: 1, x: 20, y: 98.6, w: 25, h: 1 };
  const box = signNoBox(low);
  assert.ok(box.y + box.h <= low.y, "the tag should move above rather than run off the page");
});

// ---- how far below the signature it sits (owner, 2026-11-02) ----
// "the space is too much, it should be right below the signature". Both boxes
// above the tag are BOUNDING boxes with their content centred inside, so
// anchoring to their bottom edges left a gap as tall as the leftover slack. On
// the owner's document that pushed the tag down into the page footer.
const PW = 595.28, PH = 841.89;
const pctOf = (pt) => (pt / PH) * 100;
const ptOf = (pct) => (pct / 100) * PH;

// Where the tag's text actually starts, mirroring drawTextInBox's centring.
const textTop = (box) => {
  const h = ptOf(box.h);
  const size = Math.min(h * 0.72, 6);
  const baseline = (h - size) / 2 + size * 0.12;
  return box.y + box.h - pctOf(baseline + size * 0.72);
};
// Where a contain-fitted signature's ink actually stops.
const inkBottom = (sig, aspect) => {
  const boxW = (sig.w / 100) * PW, boxH = ptOf(sig.h);
  return sig.y + sig.h - pctOf((boxH - Math.min(boxH, boxW / aspect)) / 2);
};

const WIDE = { page: 1, x: 12, y: 60, w: 24, h: 7 };   // a short signature in a tall box
const ASPECT = 3.4;
const opts = { pageW: PW, pageH: PH, signatureAspect: ASPECT };

test("the tag sits just under the signature's ink, not under its box", () => {
  const box = signNoBox(WIDE, [], opts);
  const gap = ptOf(textTop(box) - inkBottom(WIDE, ASPECT));
  assert.ok(gap > 0, `the tag must not land on the signature (gap ${gap.toFixed(1)}pt)`);
  assert.ok(gap < 6, `the tag should be right below the ink, not a line away (gap ${gap.toFixed(1)}pt)`);
});

test("a date in between is cleared by the same small gap, measured off its glyphs", () => {
  const date = { type: "date", page: 1, x: 14, y: 67.2, w: 14, h: 2.4 };
  const box = signNoBox(WIDE, [date], opts);
  const dH = ptOf(date.h), size = Math.min(dH * 0.72, 24);
  const dateInk = date.y + date.h - pctOf((dH - size) / 2 + size * 0.12);
  const gap = ptOf(textTop(box) - dateInk);
  assert.ok(gap > 0 && gap < 6, `the tag should follow the date closely (gap ${gap.toFixed(1)}pt)`);
});

test("the tag's own height no longer grows with the signature", () => {
  // It used to be signature height × 0.2, so a tall signature bought itself a
  // taller box — and the text is centred in it, so that was pure gap.
  const short = signNoBox({ ...WIDE, h: 3 }, [], opts);
  const tall = signNoBox({ ...WIDE, h: 12 }, [], opts);
  assert.equal(short.h.toFixed(3), tall.h.toFixed(3));
  // Still tall enough that the 6pt number is not shrunk (drawTextInBox sizes
  // text at 72% of the box height).
  assert.ok(ptOf(short.h) * 0.72 >= 6, `box of ${ptOf(short.h).toFixed(1)}pt would shrink the number`);
});

test("a rotated page keeps the behaviour it had, rather than a wrong correction", () => {
  // The slack runs down the BOX's own frame, which no longer points down the
  // page once it is rotated — so the correction is deliberately not applied.
  const upright = signNoBox(WIDE, [], opts);
  const turned = signNoBox(WIDE, [], { ...opts, rotation: 90 });
  assert.ok(turned.y > upright.y, "a rotated page falls back to the box bottom");
  assert.equal(turned.y.toFixed(3), (WIDE.y + WIDE.h + pctOf(1.2)).toFixed(3));
});

test("with no aspect to go on, it falls back rather than guessing", () => {
  const box = signNoBox(WIDE, [], { pageW: PW, pageH: PH });
  assert.equal(box.y.toFixed(3), (WIDE.y + WIDE.h + pctOf(1.2)).toFixed(3));
});
