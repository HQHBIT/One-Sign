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
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

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
    const sigImg = await embed(s.signaturePath);

    const boxW = (s.w / 100) * pw;
    const boxH = (s.h / 100) * ph;
    const boxX = (s.x / 100) * pw;
    const boxYTop = (s.y / 100) * ph;
    const boxY = ph - boxYTop - boxH;

    drawStampedBlock({
      page, sigImg, font, fontBold,
      boxX, boxY, boxW, boxH,
      signerName: s.signerName,
      signedAt: s.signedAt
    });
  }

  const out = await pdf.save();
  await fs.mkdir(SIGNED_DIR, { recursive: true });
  const outPath = path.join(SIGNED_DIR, outName);
  await fs.writeFile(outPath, out);
  return outPath;
}

// Draws the signature image filling the EXACT marker rectangle the requestor placed.
// The image is stretched to (boxW, boxH); no aspect-fit, no interior caption. A small
// "Digitally signed by … · date" strip is rendered BELOW the marker box (or above it
// when there isn't room below) so the visible signature footprint always equals the
// placed rectangle. Coords are MediaBox y-up; rotation has already been baked.
function drawStampedBlock({ page, sigImg, font, fontBold, boxX, boxY, boxW, boxH, signerName, signedAt }) {
  // 1) Signature fills the marker exactly.
  page.drawImage(sigImg, { x: boxX, y: boxY, width: boxW, height: boxH });

  // 2) Optional caption rendered outside the marker. Compose the lines first so we
  //    know whether there's anything to draw.
  if (!signerName && !signedAt) return;

  const { width: pageW, height: pageH } = page.getSize();
  const nameText = signerName ? `Digitally signed by ${signerName}` : "";
  const dateText = signedAt ? formatSignedDate(signedAt) : "";

  // Caption sizing scales with the marker width but stays within a comfortable range.
  const nameSize = clampNum(boxW * 0.045, 5.5, 8);
  const dateSize = clampNum(boxW * 0.038, 4.5, 7);
  const lineGap = Math.max(1, nameSize * 0.25);
  const padTop = Math.max(1.5, nameSize * 0.45);
  const padBottom = Math.max(1, dateSize * 0.4);
  const linesH = (nameText ? nameSize : 0) + (nameText && dateText ? lineGap : 0) + (dateText ? dateSize : 0);
  const captionH = padTop + linesH + padBottom;

  // Prefer below the marker. In MediaBox y-up, "below" means lower y.
  // Space below = boxY (distance from page bottom). Space above = pageH - (boxY + boxH).
  const spaceBelow = boxY;
  const spaceAbove = pageH - (boxY + boxH);
  const placeBelow = spaceBelow >= captionH || spaceBelow >= spaceAbove;

  // Caption block top edge (y-up). When placing below, top = boxY (marker bottom).
  const blockTopY = placeBelow ? boxY : boxY + boxH + captionH;
  const blockBottomY = blockTopY - captionH;
  if (blockBottomY < 0 || blockTopY > pageH) return; // No room at all.

  // Thin divider sits on the edge of the caption that touches the marker.
  const dividerY = placeBelow ? boxY - 0.4 : boxY + boxH + 0.4;
  page.drawLine({
    start: { x: boxX, y: dividerY },
    end:   { x: boxX + boxW, y: dividerY },
    thickness: 0.4,
    color: rgb(0.6, 0.6, 0.6)
  });

  // Text flows top-down from blockTopY. padTop gives a small breathing margin.
  let cursorY = blockTopY - padTop - nameSize * 0.8;
  if (nameText) {
    const w = fontBold.widthOfTextAtSize(nameText, nameSize);
    const x = boxX + Math.max(0, (boxW - w) / 2);
    page.drawText(nameText, { x, y: cursorY, size: nameSize, font: fontBold, color: rgb(0.15, 0.18, 0.27) });
    cursorY -= lineGap + dateSize;
  }
  if (dateText) {
    const w = font.widthOfTextAtSize(dateText, dateSize);
    const x = boxX + Math.max(0, (boxW - w) / 2);
    page.drawText(dateText, { x, y: cursorY, size: dateSize, font, color: rgb(0.42, 0.42, 0.45) });
  }
  // Suppress unused-var warning for pageW (kept for future right-edge clamp).
  void pageW;
}

function clampNum(v, min, max) { return Math.max(min, Math.min(max, v)); }

function formatSignedDate(ts) {
  const d = new Date(Number(ts));
  try { return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }); }
  catch { return d.toISOString().slice(0, 16).replace("T", " "); }
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
