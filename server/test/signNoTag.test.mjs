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
  assert.ok(box.y >= date.y + date.h, "the tag must clear the date, not land on it");
});

test("no room below the signature puts the tag above it", () => {
  const low = { page: 1, x: 20, y: 98.6, w: 25, h: 1 };
  const box = signNoBox(low);
  assert.ok(box.y + box.h <= low.y, "the tag should move above rather than run off the page");
});
