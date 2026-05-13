import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { bakeOrientation } from "../src/pdf.js";

async function makePdf(pages) {
  const pdf = await PDFDocument.create();
  for (const { w, h } of pages) pdf.addPage([w, h]);
  return await pdf.save();
}

test("bakeOrientation passes through a portrait PDF unchanged when target is portrait", async () => {
  const src = await makePdf([{ w: 600, h: 800 }]);
  const { bakedBytes, pageRotations } = await bakeOrientation(src, "portrait");
  const out = await PDFDocument.load(bakedBytes);
  assert.equal(out.getPageCount(), 1);
  const { width, height } = out.getPage(0).getSize();
  assert.equal(width, 600);
  assert.equal(height, 800);
  assert.deepEqual(pageRotations, [0]);
});

test("bakeOrientation rotates a portrait page to landscape (dims swap, /Rotate cleared)", async () => {
  const src = await makePdf([{ w: 600, h: 800 }]);
  const { bakedBytes, pageRotations } = await bakeOrientation(src, "landscape");
  const out = await PDFDocument.load(bakedBytes);
  const page = out.getPage(0);
  const { width, height } = page.getSize();
  assert.equal(width, 800);
  assert.equal(height, 600);
  assert.equal(page.getRotation().angle, 0);
  assert.deepEqual(pageRotations, [90]);
});

test("bakeOrientation handles mixed-orientation PDFs per-page", async () => {
  const src = await makePdf([
    { w: 600, h: 800 }, // portrait
    { w: 800, h: 600 }, // landscape
    { w: 600, h: 800 }  // portrait
  ]);
  const { bakedBytes, pageRotations } = await bakeOrientation(src, "portrait");
  const out = await PDFDocument.load(bakedBytes);
  assert.equal(out.getPageCount(), 3);
  for (let i = 0; i < 3; i++) {
    const { width, height } = out.getPage(i).getSize();
    assert.ok(height >= width, `page ${i} should be portrait`);
    assert.equal(out.getPage(i).getRotation().angle, 0);
  }
  assert.deepEqual(pageRotations, [0, 90, 0]);
});
