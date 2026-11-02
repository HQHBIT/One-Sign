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
// `audit` (optional): the fully-signed document's audit data — an audit page is
// appended (addAuditPage). A stamp carrying `signNo` gets its Sign Number line.
export async function stampPdfMultiBytes({ srcBytes, stamps, audit = null }) {
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

    // HQHB Sign Number: one small grey line under the signature (and under a
    // date sitting directly beneath it), so every signature on the page says
    // which register entry it is.
    if (s.signNo) {
      const box = signNoBox(s, stamps);
      drawTextInBox(page, font, signNoText(s.signNo, s.signedAt), placeInRotatedPage(page, box),
        { maxSize: 6.5, color: rgb(0.36, 0.39, 0.46) });
    }
  }

  if (audit) await addAuditPage(pdf, audit);
  return await pdf.save();
}

// ---------- Sign Numbers (signRegister.js) ----------
const IST = (ts) => new Date(Number(ts) || Date.now()).toLocaleString("en-IN", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
});
export const signNoText = (signNo, signedAt) => `${signNo} · Signed via SignFlow · ${IST(signedAt)} IST`;

// Where the Sign Number line goes, in the app's %-coordinates: under the
// signature, at least a third of the page wide (a narrow box would shrink the
// text to nothing), pushed below a date stamped right under the signature, and
// above the signature instead when there is no room left on the page.
export function signNoBox(s, stamps = []) {
  const page = s.page || 1;
  const h = Math.min(2.2, Math.max(1.3, Number(s.h) * 0.24));
  let bottom = Number(s.y) + Number(s.h);
  for (const d of stamps) {
    if (d.type !== "date" || (d.page || 1) !== page) continue;
    const overlapsX = d.x < s.x + s.w && d.x + d.w > s.x;
    const justBelow = d.y >= s.y + s.h - 0.5 && d.y <= s.y + s.h + 6;
    if (overlapsX && justBelow) bottom = Math.max(bottom, d.y + d.h);
  }
  let y = bottom + 0.3;
  if (y + h > 99.5) y = Math.max(0, Number(s.y) - 0.3 - h);
  const w = Math.min(98, Math.max(Number(s.w), 34));
  const x = Math.max(1, Math.min(Number(s.x) + Number(s.w) / 2 - w / 2, 99 - w));
  return { page, x, y, w, h };
}

// The page added at the end of a fully signed document: what it is, where it
// came from, its original fingerprint, and every signature on it.
async function addAuditPage(pdf, a) {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const INK = rgb(0.06, 0.1, 0.18), MUTED = rgb(0.4, 0.43, 0.5), GOLD = rgb(0.72, 0.54, 0.29), LINE = rgb(0.86, 0.84, 0.8);
  const W = 595.28, H = 841.89, M = 48;
  const fit = (text, f, size, maxW) => {
    let t = String(text ?? "");
    if (f.widthOfTextAtSize(t, size) <= maxW) return t;
    while (t.length > 1 && f.widthOfTextAtSize(t + "…", size) > maxW) t = t.slice(0, -1);
    return t + "…";
  };
  // Words onto at most `max` lines of `maxW`; the last line ellipsed only if
  // the text truly does not fit even then.
  const wrap = (text, f, size, maxW, max) => {
    const words = String(text ?? "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(t, size) <= maxW || !line) line = t;
      else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    if (lines.length > max) { const keep = lines.slice(0, max); keep[max - 1] = fit(lines.slice(max - 1).join(" "), f, size, maxW); return keep; }
    return lines.map((l) => fit(l, f, size, maxW));
  };
  const rows = a.signatures || [];
  const PER_PAGE = 14;
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));

  for (let p = 0; p < pages; p++) {
    const page = pdf.addPage([W, H]);
    let y = H - M;
    // Header band
    page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: GOLD });
    page.drawText("SignFlow", { x: M, y: y - 4, size: 11, font: bold, color: GOLD });
    page.drawText("HQHB", { x: W - M - bold.widthOfTextAtSize("HQHB", 9), y: y - 2, size: 9, font: bold, color: MUTED });
    y -= 34;
    page.drawText("Signature Audit Report", { x: M, y, size: 20, font: bold, color: INK });
    y -= 16;
    page.drawText(fit(`Completed ${IST(a.completedAt)} IST`, font, 9.5, W - 2 * M), { x: M, y, size: 9.5, font, color: MUTED });
    y -= 22;

    if (p === 0) {
      // Document details
      const details = [
        ["Document", a.documentName],
        ["Document ID", a.documentId],
        ["Requested by", a.requestedBy],
        ["Sent for signature", `${IST(a.sentAt)} IST`],
        ["Fully signed", `${IST(a.completedAt)} IST`],
        ["Signatures", String(rows.length)],
      ];
      page.drawRectangle({ x: M, y: y - details.length * 17 - 34, width: W - 2 * M, height: details.length * 17 + 40, borderColor: LINE, borderWidth: 0.8, color: rgb(0.985, 0.98, 0.97) });
      y -= 18;
      for (const [k, v] of details) {
        page.drawText(k, { x: M + 14, y, size: 9, font, color: MUTED });
        page.drawText(fit(v, bold, 9.5, W - 2 * M - 150), { x: M + 140, y, size: 9.5, font: bold, color: INK });
        y -= 17;
      }
      page.drawText("Original file (SHA-256)", { x: M + 14, y, size: 9, font, color: MUTED });
      page.drawText(fit(a.originalSha256, mono, 7.6, W - 2 * M - 150), { x: M + 140, y, size: 7.6, font: mono, color: INK });
      y -= 40;
    }

    // Signatures table
    const cols = [{ t: "Sign No", w: 108 }, { t: "Signer", w: 244 }, { t: "Signed (IST)", w: 112 }, { t: "Step", w: W - 2 * M - 464 }];
    page.drawText(p === 0 ? "Signatures" : "Signatures (continued)", { x: M, y, size: 12, font: bold, color: INK });
    y -= 26;
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: rgb(0.06, 0.1, 0.18) });
    let cx = M + 8;
    for (const c of cols) { page.drawText(c.t, { x: cx, y: y, size: 8.5, font: bold, color: rgb(1, 1, 1) }); cx += c.w; }
    y -= 26;
    for (const [i, r] of rows.slice(p * PER_PAGE, (p + 1) * PER_PAGE).entries()) {
      // A record meant for tracing never cuts a name short: it wraps (two lines).
      const nameLines = wrap(r.signer, bold, 9, cols[1].w - 10, 2);
      const byLines = r.actedBy ? wrap(`signed on their behalf by ${r.actedBy}`, font, 7.5, cols[1].w - 10, 2) : [];
      const rowH = 10 + nameLines.length * 11 + byLines.length * 9.5;
      if (i % 2 === 1) page.drawRectangle({ x: M, y: y - rowH + 14, width: W - 2 * M, height: rowH, color: rgb(0.965, 0.955, 0.94) });
      cx = M + 8;
      page.drawText(r.signNo, { x: cx, y, size: 8.5, font: mono, color: INK }); cx += cols[0].w;
      let ly = y;
      for (const l of nameLines) { page.drawText(l, { x: cx, y: ly, size: 9, font: bold, color: INK }); ly -= 11; }
      for (const l of byLines) { page.drawText(l, { x: cx, y: ly + 1, size: 7.5, font, color: MUTED }); ly -= 9.5; }
      cx += cols[1].w;
      page.drawText(fit(IST(r.signedAt), font, 8.5, cols[2].w - 8), { x: cx, y, size: 8.5, font, color: INK }); cx += cols[2].w;
      page.drawText(r.step ? `Step ${r.step}` : "—", { x: cx, y, size: 8.5, font, color: INK });
      y -= rowH;
      page.drawLine({ start: { x: M, y: y + 12 }, end: { x: W - M, y: y + 12 }, thickness: 0.5, color: LINE });
    }

    // Footer
    const foot = "This page was added by SignFlow when the document was fully signed. Every Sign Number is kept in the SignFlow register held by the HQHB IT administrator — quote it to trace or verify a signature.";
    const words = foot.split(" "); let line = "", fy = M + 18;
    const lines = [];
    for (const wd of words) { const tryL = line ? `${line} ${wd}` : wd; if (font.widthOfTextAtSize(tryL, 7.8) > W - 2 * M) { lines.push(line); line = wd; } else line = tryL; }
    if (line) lines.push(line);
    page.drawLine({ start: { x: M, y: fy + 16 }, end: { x: W - M, y: fy + 16 }, thickness: 0.6, color: LINE });
    for (const l of lines) { page.drawText(l, { x: M, y: fy, size: 7.8, font, color: MUTED }); fy -= 11; }
    page.drawText(`Audit page ${p + 1} of ${pages}`, { x: W - M - font.widthOfTextAtSize(`Audit page ${p + 1} of ${pages}`, 7.8), y: M - 6, size: 7.8, font, color: MUTED });
  }
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
