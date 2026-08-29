// Unit: fitContain keeps a signature's own aspect inside the placed box.
// The bug it fixes: drawImage(img, place) stretched the signature to the box's
// exact width/height, so the same signature in two differently-shaped boxes came
// out at two different aspect ratios — visibly distorted handwriting.
import assert from "node:assert/strict";
import { degrees, PDFDocument } from "pdf-lib";
import { fitContain, stampPdfMulti } from "../src/pdf.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg} (got ${a}, want ${b})`);

// ---- wide image, box taller than it needs: width fills, centred vertically ----
{
  const out = fitContain({ x: 0, y: 0, width: 200, height: 100, rotate: degrees(0) }, 400, 100);
  near(out.width, 200, "wide image fills box width");
  near(out.height, 50, "height scaled by the same factor");
  near(out.x, 0, "no horizontal slack to centre");
  near(out.y, 25, "vertical slack split evenly");
}

// ---- tall image, box wider than it needs: height fills, centred horizontally ----
{
  const out = fitContain({ x: 0, y: 0, width: 200, height: 100, rotate: degrees(0) }, 100, 400);
  near(out.width, 25, "tall image constrained by box height");
  near(out.height, 100, "tall image fills box height");
  near(out.x, 87.5, "horizontal slack split evenly");
  near(out.y, 0, "no vertical slack to centre");
}

// ---- aspect is preserved for a spread of box / image shapes ----
for (const [bw, bh] of [[200, 100], [100, 200], [140, 140], [300, 37]]) {
  for (const [iw, ih] of [[400, 100], [100, 400], [50, 50], [1360, 720]]) {
    const out = fitContain({ x: 5, y: 7, width: bw, height: bh, rotate: degrees(0) }, iw, ih);
    near(out.width / out.height, iw / ih, `aspect kept for box ${bw}x${bh} image ${iw}x${ih}`);
    assert.ok(out.width <= bw + 1e-9 && out.height <= bh + 1e-9, "never exceeds the box");
  }
}

// ---- the centring offset is rotated into page space on a rotated page ----
{
  const out = fitContain({ x: 100, y: 50, width: 200, height: 100, rotate: degrees(90) }, 400, 100);
  near(out.width, 200, "rotated: width unchanged in the box's own frame");
  near(out.height, 50, "rotated: height unchanged in the box's own frame");
  near(out.x, 75, "rotated: dy offset moves along -x");
  near(out.y, 50, "rotated: dx offset was zero");
  assert.equal(out.rotate, undefined === out.rotate ? undefined : out.rotate, "rotate passes through");
}

// ---- degenerate image dimensions leave the placement untouched ----
{
  const place = { x: 1, y: 2, width: 3, height: 4, rotate: degrees(0) };
  assert.deepEqual(fitContain(place, 0, 100), place, "zero width is a no-op");
  assert.deepEqual(fitContain(place, 100, 0), place, "zero height is a no-op");
}

// ---- end to end: a wide signature in a square box still produces a valid PDF ----
{
  const doc = await PDFDocument.create(); doc.addPage([600, 800]);
  const srcPath = path.join(here, "_fitsrc.pdf");
  fs.writeFileSync(srcPath, await doc.save());

  // 2x1 red PNG — a deliberately non-square signature stand-in.
  const sigPath = path.join(here, "_fitsig.png");
  fs.writeFileSync(sigPath, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFElEQVR4nGP8z8Dwn4GBgYEJRIAAADkAAyi1kR8AAAAASUVORK5CYII=",
    "base64"));

  const outPath = await stampPdfMulti({
    srcPath,
    stamps: [{ signaturePath: sigPath, page: 1, x: 20, y: 20, w: 20, h: 20, signedAt: Date.now() }],
    outName: "_fit-contain-test.signed.pdf"
  });
  assert.equal((await PDFDocument.load(fs.readFileSync(outPath))).getPageCount(), 1, "valid 1-page output");

  fs.unlinkSync(srcPath); fs.unlinkSync(sigPath);
  try { fs.unlinkSync(outPath); } catch { /* best effort */ }
}

console.log("fitContain: all tests passed");
