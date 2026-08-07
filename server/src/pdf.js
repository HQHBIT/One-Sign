import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { bakeOrientationPlan } from "./pdf-rotation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIGNED_DIR = path.join(__dirname, "..", "uploads", "signed");

// Given a page's clockwise display rotation (from /Rotate) and a marker box in the
// app's %-convention (top-down, relative to the UNROTATED MediaBox), return pdf-lib
// draw params (x, y, width, height in points; y-up bottom-left; + a rotate angle)
// that place content filling that box and UPRIGHT on the displayed (rotated) page.
// For a /Rotate=0 page this is exactly the flat mapping used everywhere before.
export function placeInRotatedPage(page, box) {
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const { width: pw, height: ph } = page.getSize();
  const bw = (box.w / 100) * pw;
  const bh = (box.h / 100) * ph;
  const bx = (box.x / 100) * pw;
  const by = ph - (box.y / 100) * ph - bh;
  switch (rot) {
    case 90:  return { x: bx + bw, y: by,      width: bh, height: bw, rotate: degrees(90) };
    case 180: return { x: bx + bw, y: by + bh, width: bw, height: bh, rotate: degrees(180) };
    case 270: return { x: bx,      y: by + bh, width: bh, height: bw, rotate: degrees(270) };
    default:  return { x: bx,      y: by,      width: bw, height: bh, rotate: degrees(0) };
  }
}

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

// Stamps signatures onto a PDF using the app's %-coordinates. A page may carry a
// native /Rotate (the requestor's rotate-control choice); placeInRotatedPage maps
// each stamp so it lands upright on the displayed (rotated) page.
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
    const place = placeInRotatedPage(page, s);

    // A date stamp draws the signer's signing date as text in the placed box.
    if (s.type === "date") {
      drawDateInBox(page, font, String(s.text || ""), place);
      continue;
    }

    // Signature fills the exact rectangle the requestor placed — no caption line.
    // The signing date, when wanted, is stamped separately in its own date box.
    const sigImg = await embed(s.signaturePath);
    page.drawImage(sigImg, place);
  }

  const out = await pdf.save();
  await fs.mkdir(SIGNED_DIR, { recursive: true });
  const outPath = path.join(SIGNED_DIR, outName);
  await fs.writeFile(outPath, out);
  return outPath;
}


// Draws a date string centred in a placed box, auto-shrinking to fit. Shared by
// stampPdfMulti and applySelfMarks. `place` is the output of placeInRotatedPage:
// the box's pre-rotation rectangle (x, y bottom-left; width along the text; height)
// plus a rotate angle, so the date reads upright on rotated pages too. For a
// /Rotate=0 page this reduces to the original centred, horizontal placement.
function drawDateInBox(page, font, text, place) {
  if (!text) return;
  const { x, y, width, height, rotate } = place;
  let size = Math.min(height * 0.72, 24);
  const maxW = width * 0.96;
  while (size > 4 && font.widthOfTextAtSize(text, size) > maxW) size -= 0.5;
  const tw = font.widthOfTextAtSize(text, size);
  // Centre in the rectangle's own (pre-rotation) frame, then rotate the start point
  // into place — drawText rotates around its baseline origin.
  const lx = Math.max(0, (width - tw) / 2);
  const ly = (height - size) / 2 + size * 0.12;
  const ang = (typeof rotate === "object" ? rotate.angle : rotate) || 0;
  const rad = (ang * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  page.drawText(text, {
    x: x + (lx * cos - ly * sin),
    y: y + (lx * sin + ly * cos),
    size, font, rotate, color: rgb(0.1, 0.12, 0.2)
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

// Rotate EVERY page clockwise by an explicit number of quarter-turns (0-3) — the
// requestor's rotate-control choice. Uses pdf-lib's NATIVE page rotation (/Rotate),
// which is lossless: the page content bytes are untouched, so scanned/image PDFs
// stay crisp. (Re-embedding each page into a fresh document to force /Rotate=0
// visibly faded + stretched real scans — the bug this replaces.) The stamping reads
// /Rotate and places signatures upright via placeInRotatedPage, so no per-page
// marker transform is needed here → pageRotations is empty.
export async function bakeUniformRotation(srcBytes, quarterTurns) {
  const turns = ((((quarterTurns | 0) % 4) + 4) % 4);
  if (turns === 0) return { bakedBytes: srcBytes, pageRotations: [] };
  const pdf = await PDFDocument.load(srcBytes);
  for (const p of pdf.getPages()) {
    p.setRotation(degrees((p.getRotation().angle + turns * 90) % 360));
  }
  return { bakedBytes: await pdf.save(), pageRotations: [] };
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
    const place = placeInRotatedPage(page, m);

    if (m.type === "date") {
      drawDateInBox(page, font, String(m.text || ""), place);
    } else if (m.signaturePath) {
      const img = await embed(m.signaturePath);
      page.drawImage(img, place);
    }
  }

  return await pdf.save();
}
