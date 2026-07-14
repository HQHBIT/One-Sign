import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { bakeOrientationPlan } from "./pdf-rotation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIGNED_DIR = path.join(__dirname, "..", "uploads", "signed");

export async function stampPdf({ srcPath, signaturePath, marker, outName }) {
  return stampPdfMulti({
    srcPath,
    stamps: [{
      signaturePath,
      page: marker.page || 1,
      x: marker.x, y: marker.y, w: marker.w, h: marker.h,
      signerName: marker.signerName,
      signedAt: marker.signedAt
    }],
    outName
  });
}

// Stamps signatures onto a PDF using MediaBox-space coordinates. The applicant's
// orientation choice is already baked into the PDF on submit (see bakeOrientation),
// so every page has /Rotate = 0 and the signature is drawn flat in MediaBox y-up.
export async function stampPdfMulti({ srcPath, stamps, outName }) {
  const pdfBytes = await fs.readFile(srcPath);
  const pdf = await PDFDocument.load(pdfBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const cache = new Map();
  async function embed(p) {
    if (cache.has(p)) return cache.get(p);
    const bytes = await fs.readFile(p);
    let img;
    try { img = await pdf.embedPng(bytes); }
    catch { img = await pdf.embedJpg(bytes); }
    cache.set(p, img);
    return img;
  }

  for (const s of stamps) {
    const pageIdx = Math.max(0, (s.page || 1) - 1);
    if (pageIdx >= pdf.getPageCount()) continue;
    const page = pdf.getPage(pageIdx);
    const { width: pw, height: ph } = page.getSize();

    const boxW = (s.w / 100) * pw;
    const boxH = (s.h / 100) * ph;
    const boxX = (s.x / 100) * pw;
    const boxYTop = (s.y / 100) * ph;
    const boxY = ph - boxYTop - boxH;

    // A date stamp draws the signer's signing date as text in the placed box.
    if (s.type === "date") {
      drawDateInBox(page, font, String(s.text || ""), boxX, boxY, boxW, boxH);
      continue;
    }

    // Signature fills the exact rectangle the requestor placed — no caption line.
    // The signing date, when wanted, is stamped separately in its own date box.
    const sigImg = await embed(s.signaturePath);
    page.drawImage(sigImg, { x: boxX, y: boxY, width: boxW, height: boxH });
  }

  const out = await pdf.save();
  await fs.mkdir(SIGNED_DIR, { recursive: true });
  const outPath = path.join(SIGNED_DIR, outName);
  await fs.writeFile(outPath, out);
  return outPath;
}


// Draws a date string centred in the placed box, auto-shrinking to fit the width.
// Shared by stampPdfMulti (a signer's signing date) and applySelfMarks (the
// requestor's own date). Coords are MediaBox y-up; box origin is bottom-left.
function drawDateInBox(page, font, text, boxX, boxY, boxW, boxH) {
  if (!text) return;
  let size = Math.min(boxH * 0.72, 24);
  const maxW = boxW * 0.96;
  while (size > 4 && font.widthOfTextAtSize(text, size) > maxW) size -= 0.5;
  const tw = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: boxX + Math.max(0, (boxW - tw) / 2),
    y: boxY + (boxH - size) / 2 + size * 0.12,
    size, font, color: rgb(0.1, 0.12, 0.2)
  });
}


// Rebuilds the PDF so every page matches the target orientation. Pages already in
// that orientation are embedded and drawn unchanged. Pages in the other orientation
// are embedded and drawn rotated 90° CW onto a new page with swapped MediaBox dims.
// Result: all pages have /Rotate = 0 and display in the target orientation natively.
// Returns the new bytes and a parallel array indicating which pages were rotated
// (0 = unchanged, 90 = rotated CW).
export async function bakeOrientation(srcBytes, targetOrientation) {
  const src = await PDFDocument.load(srcBytes);
  const srcPages = src.getPages();

  // pdf-lib's embedPage throws MissingPageContentsEmbeddingError for pages that
  // have no /Contents stream (blank pages created without any drawing operations).
  // Drawing an empty string forces the Contents stream into existence without
  // adding any visible content.
  for (const p of srcPages) {
    if (!p.node.Contents()) p.drawText("");
  }

  // Visible dims account for any pre-existing /Rotate on the source page.
  const pageDims = srcPages.map(p => {
    const { width, height } = p.getSize();
    const rot = ((p.getRotation().angle % 360) + 360) % 360;
    const sideways = rot === 90 || rot === 270;
    return sideways ? { width: height, height: width } : { width, height };
  });
  const plan = bakeOrientationPlan(pageDims, targetOrientation);

  const out = await PDFDocument.create();
  for (let i = 0; i < srcPages.length; i++) {
    const { width: visW, height: visH } = pageDims[i];
    const extraRot = plan[i]; // 0 or 90

    const pageW = extraRot === 90 ? visH : visW;
    const pageH = extraRot === 90 ? visW : visH;
    const newPage = out.addPage([pageW, pageH]);
    newPage.setRotation(degrees(0));

    const embedded = await out.embedPage(srcPages[i]);
    drawEmbeddedRotated(newPage, embedded, extraRot, visW, visH);
  }

  const bakedBytes = await out.save();
  return { bakedBytes, pageRotations: plan };
}

// Rotate EVERY page clockwise by an explicit number of quarter-turns (0-3) — this
// is the requestor's rotate-control choice, distinct from bakeOrientation's
// portrait/landscape targeting. Returns the new bytes plus a per-page rotation
// array (all the same total angle) so the markers can be remapped to match.
export async function bakeUniformRotation(srcBytes, quarterTurns) {
  const turns = ((((quarterTurns | 0) % 4) + 4) % 4);
  const pageCount = (await PDFDocument.load(srcBytes)).getPageCount();
  if (turns === 0) return { bakedBytes: srcBytes, pageRotations: Array(pageCount).fill(0) };
  let bytes = srcBytes;
  for (let t = 0; t < turns; t++) bytes = await rotateAll90CW(bytes);
  return { bakedBytes: bytes, pageRotations: Array(pageCount).fill(turns * 90) };
}

// One 90° CW rebuild of every page (same technique as bakeOrientation, applied
// unconditionally). New pages carry /Rotate = 0 with swapped MediaBox dims.
async function rotateAll90CW(srcBytes) {
  const src = await PDFDocument.load(srcBytes);
  const srcPages = src.getPages();
  for (const p of srcPages) { if (!p.node.Contents()) p.drawText(""); }
  const out = await PDFDocument.create();
  for (let i = 0; i < srcPages.length; i++) {
    const { width, height } = srcPages[i].getSize();
    const rot = ((srcPages[i].getRotation().angle % 360) + 360) % 360;
    const sideways = rot === 90 || rot === 270;
    const visW = sideways ? height : width;
    const visH = sideways ? width : height;
    const newPage = out.addPage([visH, visW]); // 90° swaps width/height
    newPage.setRotation(degrees(0));
    const embedded = await out.embedPage(srcPages[i]);
    drawEmbeddedRotated(newPage, embedded, 90, visW, visH);
  }
  return await out.save();
}

// pdf-lib's drawPage anchor (x, y) is the rotation center; the embedded page is
// translated to (x, y) and then rotated by `rotate` (CCW-positive). For 90° CW
// we use degrees(-90) and anchor at (0, visW) so the four source corners map
// exactly onto the new (visH × visW) page:
//   source (0,    0)    → (0,    visW)
//   source (visW, 0)    → (0,    0)
//   source (visW, visH) → (visH, 0)
//   source (0,    visH) → (visH, visW)
function drawEmbeddedRotated(page, embedded, rotation, visW, visH) {
  if (rotation === 0) {
    page.drawPage(embedded, { x: 0, y: 0, width: visW, height: visH });
  } else {
    page.drawPage(embedded, {
      x: 0,
      y: visW,
      width: visW,
      height: visH,
      rotate: degrees(-90)
    });
  }
}

export async function writeXlsxSignatureManifest({ srcPath, signaturePath, marker, outName }) {
  await fs.mkdir(SIGNED_DIR, { recursive: true });
  const manifest = {
    signedAt: Date.now(),
    marker,
    signatureFile: path.basename(signaturePath),
    originalFile: path.basename(srcPath)
  };
  const outPath = path.join(SIGNED_DIR, outName.replace(/\.xlsx?$/i, "") + ".signed.json");
  await fs.writeFile(outPath, JSON.stringify(manifest, null, 2));
  return outPath;
}

// Stamps the REQUESTOR's own signature image(s) and/or date text(s) onto a PDF at
// creation time, so the document goes out already self-signed / dated before it is
// routed for approval. Works on raw bytes and returns new bytes (no disk write).
// Coordinates are percentages of the page (same convention as stampPdfMulti).
//   marks: [{ type: 'signature'|'date', signaturePath?, text?, page, x, y, w, h }]
export async function applySelfMarks(pdfBytes, marks) {
  const pdf = await PDFDocument.load(pdfBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const cache = new Map();
  async function embed(p) {
    if (cache.has(p)) return cache.get(p);
    const bytes = await fs.readFile(p);
    let img;
    try { img = await pdf.embedPng(bytes); } catch { img = await pdf.embedJpg(bytes); }
    cache.set(p, img);
    return img;
  }

  for (const m of marks) {
    const pageIdx = Math.max(0, (m.page || 1) - 1);
    if (pageIdx >= pdf.getPageCount()) continue;
    const page = pdf.getPage(pageIdx);
    const { width: pw, height: ph } = page.getSize();
    const boxW = (m.w / 100) * pw;
    const boxH = (m.h / 100) * ph;
    const boxX = (m.x / 100) * pw;
    const boxY = ph - ((m.y / 100) * ph) - boxH;

    if (m.type === "date") {
      drawDateInBox(page, font, String(m.text || ""), boxX, boxY, boxW, boxH);
    } else if (m.signaturePath) {
      const img = await embed(m.signaturePath);
      page.drawImage(img, { x: boxX, y: boxY, width: boxW, height: boxH });
    }
  }

  return await pdf.save();
}
