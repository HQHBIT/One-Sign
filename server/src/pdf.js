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

// Shrinks a placed box to the largest rectangle with the IMAGE's own aspect that
// still fits inside it, centred — i.e. CSS `object-fit: contain`. The marker box is
// a bounding box, not a target: a signature is never stretched to fill it, so the
// handwriting keeps its real proportions no matter what shape the requestor drew.
// (The client preview has always used objectFit:"contain"; before this, the stamped
// output disagreed with the preview it was previewing.)
//
// `place` is the output of placeInRotatedPage — width/height live in the box's OWN
// pre-rotation frame — so the centring offset is rotated into page space the same
// way drawDateInBox does it. That keeps this composable with rotated pages.
export function fitContain(place, imgWidth, imgHeight) {
  const { x, y, width, height, rotate } = place;
  if (!(imgWidth > 0) || !(imgHeight > 0)) return place;
  const scale = Math.min(width / imgWidth, height / imgHeight);
  const w = imgWidth * scale;
  const h = imgHeight * scale;
  const dx = (width - w) / 2;
  const dy = (height - h) / 2;
  const ang = (typeof rotate === "object" ? rotate.angle : rotate) || 0;
  const rad = (ang * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return {
    x: x + (dx * cos - dy * sin),
    y: y + (dx * sin + dy * cos),
    width: w,
    height: h,
    rotate
  };
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
  const out = await stampPdfMultiBytes({ srcBytes: await fs.readFile(srcPath), stamps });
  await fs.mkdir(SIGNED_DIR, { recursive: true });
  const outPath = path.join(SIGNED_DIR, outName);
  await fs.writeFile(outPath, out);
  return outPath;
}

// Same stamping, bytes in / bytes out. Confidential documents are decrypted into
// memory, stamped here and re-encrypted before touching the disk, so a readable
// copy never exists in the filesystem. stampPdfMulti is a thin wrapper over this
// so both paths provably behave identically.
// A stamp carrying `signNo` gets its small Sign Number tag.
//
// Nothing is ever ADDED to the document here beyond the signatures, their dates
// and that tag. A fully signed document used to gain a Signature Audit Report
// page; the owner asked for it gone (2026-11-02) and the whole trace now lives
// in Admin → Signature register, which is the place to read it.
export async function stampPdfMultiBytes({ srcBytes, stamps }) {
  const pdf = await PDFDocument.load(srcBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const cache = new Map();
  // A stamp carries the signature's bytes when they were read from storage — a
  // signature kept only in the bucket has no path on disk. A bare path is read
  // from disk as before.
  async function embed(p, given) {
    if (cache.has(p)) return cache.get(p);
    const bytes = given || await fs.readFile(p);
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

    // The signature is fitted INSIDE the rectangle the requestor placed, keeping its
    // own aspect — no caption line. The signing date, when wanted, is stamped
    // separately in its own date box.
    const sigImg = await embed(s.signaturePath, s.signatureBytes);
    page.drawImage(sigImg, fitContain(place, sigImg.width, sigImg.height));

    // HQHB Sign Number: a small grey tag under the signature (and under a date
    // sitting directly beneath it), naming the register entry and nothing more.
    if (s.signNo) {
      const box = signNoBox(s, stamps);
      drawTextInBox(page, font, signNoText(s.signNo), placeInRotatedPage(page, box),
        { maxSize: 6, color: rgb(0.45, 0.48, 0.54) });
    }
  }

  return await pdf.save();
}

// ---------- Sign Numbers (signRegister.js) ----------
const IST = (ts) => new Date(Number(ts) || Date.now()).toLocaleString("en-IN", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
});
// The tag on the page is the NUMBER and nothing else (owner, 2026-11-02): the
// line that also carried "Signed via SignFlow" and the timestamp ran a third of
// the page wide and got in the document's way. Everything it used to say is in
// Admin → Signature register, where there is room to read it; the page itself
// only needs to point at the entry.
export const signNoText = (signNo) => String(signNo ?? "");

// Where that tag goes, in the app's %-coordinates: a small box under the
// signature, no wider than it needs to be, pushed below a date stamped right
// under the signature, and above the signature instead when the page has no
// room left.
export function signNoBox(s, stamps = []) {
  const page = s.page || 1;
  const h = Math.min(1.6, Math.max(1.0, Number(s.h) * 0.2));
  let bottom = Number(s.y) + Number(s.h);
  for (const d of stamps) {
    if (d.type !== "date" || (d.page || 1) !== page) continue;
    const overlapsX = d.x < s.x + s.w && d.x + d.w > s.x;
    const justBelow = d.y >= s.y + s.h - 0.5 && d.y <= s.y + s.h + 6;
    if (overlapsX && justBelow) bottom = Math.max(bottom, d.y + d.h);
  }
  let y = bottom + 0.3;
  if (y + h > 99.5) y = Math.max(0, Number(s.y) - 0.3 - h);
  // Wide enough for "SF-2026-000123" at 6.5pt and no wider, so the tag sits
  // under the signature instead of spanning the page. It never grows past the
  // signature's own width — a wide signature does not want a wide tag.
  const w = Math.min(98, Math.max(Number(s.w), 13));
  const x = Math.max(1, Math.min(Number(s.x) + Number(s.w) / 2 - w / 2, 99 - w));
  return { page, x, y, w, h };
}



// Draws a date string centred in a placed box, auto-shrinking to fit. Shared by
// stampPdfMulti and applySelfMarks. `place` is the output of placeInRotatedPage:
// the box's pre-rotation rectangle (x, y bottom-left; width along the text; height)
// plus a rotate angle, so the date reads upright on rotated pages too. For a
// /Rotate=0 page this reduces to the original centred, horizontal placement.
function drawDateInBox(page, font, text, place) {
  drawTextInBox(page, font, text, place);
}

// Text centred in a placed box, shrinking to fit the width; `maxSize` caps the
// size (a Sign Number line stays small however tall its box), `color` tints it.
function drawTextInBox(page, font, text, place, { maxSize = 24, color = rgb(0.1, 0.12, 0.2) } = {}) {
  if (!text) return;
  const { x, y, width, height, rotate } = place;
  let size = Math.min(height * 0.72, maxSize);
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
    size, font, rotate, color
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
//   marks: [{ type: 'signature'|'date', signaturePath?, signatureBytes?, text?, page, x, y, w, h }]
export async function applySelfMarks(pdfBytes, marks) {
  const pdf = await PDFDocument.load(pdfBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const cache = new Map();
  async function embed(p, given) {
    if (cache.has(p)) return cache.get(p);
    const bytes = given || await fs.readFile(p);
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
      const img = await embed(m.signaturePath, m.signatureBytes);
      page.drawImage(img, fitContain(place, img.width, img.height));
    }
  }

  return await pdf.save();
}
