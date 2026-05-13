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
      rotation: marker.rotation,
      signerName: marker.signerName,
      signedAt: marker.signedAt
    }],
    outName
  });
}

// Stamping rule:
//
// The signature is pre-rotated in MediaBox by the inverse of the rotation the
// page is meant to be viewed at, so when the viewer applies that page rotation
// the signature lands horizontally — aligned with the page text. We prefer the
// rotation the requestor was using when they placed the marker (s.rotation,
// which also drives pickInitialRotation on the client), and fall back to the
// PDF's own /Rotate when that isn't stored.
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
    const viewRot = s.rotation != null ? Number(s.rotation) : page.getRotation().angle;
    const pageRotation = (((viewRot % 360) + 360) % 360);

    // Marker box in MediaBox y-up
    const boxW = (s.w / 100) * pw;
    const boxH = (s.h / 100) * ph;
    const boxX = (s.x / 100) * pw;
    const boxYTop = (s.y / 100) * ph;
    const boxY = ph - boxYTop - boxH;

    drawStampedBlock({
      page, sigImg, font, fontBold,
      boxX, boxY, boxW, boxH,
      pageRotation,
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

// Draws an entire "signature block" (image + separator + name + date) inside the
// MediaBox box, pre-rotated to compensate for the page's /Rotate metadata.
function drawStampedBlock({ page, sigImg, font, fontBold, boxX, boxY, boxW, boxH, pageRotation, signerName, signedAt }) {
  // Display-space dimensions of the marker box (what the user sees on screen after
  // /Rotate is applied). For 90/270, MediaBox W maps to display H and vice versa.
  const isSideways = pageRotation === 90 || pageRotation === 270;
  const dispBoxW = isSideways ? boxH : boxW;
  const dispBoxH = isSideways ? boxW : boxH;

  // Bottom 28% (in display) reserved for caption if there's room and there's data.
  const hasCaptionData = !!(signerName || signedAt);
  const captionFrac = hasCaptionData && (dispBoxH * 0.28) >= 10 ? 0.28 : 0;
  const sigFrac = 1 - captionFrac;
  const dispSigH = sigFrac * dispBoxH;
  const dispCapH = captionFrac * dispBoxH;

  // Signature image aspect-fit in display sigRect (dispBoxW × dispSigH).
  const sigRatio = sigImg.width / sigImg.height;
  const dispSigRatio = dispBoxW / dispSigH;
  let fitDispW, fitDispH;
  if (sigRatio > dispSigRatio) { fitDispW = dispBoxW; fitDispH = dispBoxW / sigRatio; }
  else { fitDispH = dispSigH; fitDispW = dispSigH * sigRatio; }

  // Sig's top-left within the box, in DISPLAY coords (top-left origin, x right, y down).
  // Centred horizontally, vertically centred within the sig portion (top dispSigH of box).
  const sigDispX = (dispBoxW - fitDispW) / 2;
  const sigDispY = (dispSigH - fitDispH) / 2;

  // Place the signature image and the caption text using the rotation helpers.
  drawImageInBox(page, sigImg, boxX, boxY, boxW, boxH, sigDispX, sigDispY, fitDispW, fitDispH, pageRotation);

  if (captionFrac > 0) {
    drawSeparatorAtSigCaptionBoundary(page, boxX, boxY, boxW, boxH, dispSigH, pageRotation);

    const nameText = signerName ? `Signed by ${signerName}` : "";
    const dateText = signedAt ? formatSignedDate(signedAt) : "";
    const nameSize = clampNum(dispCapH * 0.42, 4, 9);
    const dateSize = clampNum(dispCapH * 0.34, 3, 7);
    const marginTop = Math.max(1.5, dispCapH * 0.08);
    const lineGap = Math.max(1, nameSize * 0.18);

    if (nameText) {
      const w = fontBold.widthOfTextAtSize(nameText, nameSize);
      const dispX = Math.max(2, (dispBoxW - w) / 2);
      const dispY = dispSigH + marginTop;
      drawTextInBox(page, nameText, boxX, boxY, boxW, boxH, dispX, dispY, nameSize, fontBold, rgb(0.15, 0.18, 0.27), pageRotation);
    }
    if (dateText) {
      const w = font.widthOfTextAtSize(dateText, dateSize);
      const dispX = Math.max(2, (dispBoxW - w) / 2);
      const dispY = dispSigH + marginTop + nameSize + lineGap;
      drawTextInBox(page, dateText, boxX, boxY, boxW, boxH, dispX, dispY, dateSize, font, rgb(0.45, 0.45, 0.45), pageRotation);
    }
  }
}

// Draws an image with the given DISPLAY-space top-left (dispX, dispY) and DISPLAY-space
// width/height (fitDispW, fitDispH), pre-rotated so it ends up upright after /Rotate.
// Box is the MediaBox y-up rectangle (boxX/Y/W/H) that encloses the displayed box.
function drawImageInBox(page, img, boxX, boxY, boxW, boxH, dispX, dispY, fitDispW, fitDispH, pageRotation) {
  // First compute where the display-space sig rect lands in MediaBox y-up. This is a
  // rotation-aware transform from (dispX, dispY, fitDispW, fitDispH) → mediabox rect.
  const r = displayRectToMediabox(boxX, boxY, boxW, boxH, dispX, dispY, fitDispW, fitDispH, pageRotation);
  // r = { x, y, w, h } in MediaBox y-up, where (x, y) is the BL after pre-rotation.
  // Now compute drawImage params with the right rotate so the image fills r and
  // appears upright after /Rotate.
  switch (pageRotation) {
    case 90:
      return page.drawImage(img, { x: r.x + r.w, y: r.y, width: r.h, height: r.w, rotate: degrees(-90) });
    case 180:
      return page.drawImage(img, { x: r.x + r.w, y: r.y + r.h, width: r.w, height: r.h, rotate: degrees(180) });
    case 270:
      return page.drawImage(img, { x: r.x, y: r.y + r.h, width: r.h, height: r.w, rotate: degrees(90) });
    default:
      return page.drawImage(img, { x: r.x, y: r.y, width: r.w, height: r.h, rotate: degrees(0) });
  }
}

function drawTextInBox(page, text, boxX, boxY, boxW, boxH, dispX, dispY, fontSize, fontObj, color, pageRotation) {
  // Place the text at the DISPLAY top-left (dispX, dispY) inside the box.
  // Compute the baseline-left in MediaBox y-up, with the correct rotation.
  const ascent = fontSize * 0.8;
  const isSideways = pageRotation === 90 || pageRotation === 270;
  const dispBoxW = isSideways ? boxH : boxW;
  const dispBoxH = isSideways ? boxW : boxH;
  // Convert (dispX, dispY) display offset within the box to MediaBox baseline position.
  let x, y, rot;
  switch (pageRotation) {
    case 90:
      // display X = mediabox b (y_up), display Y = mediabox a (x). caption top-left in mb = (boxX, boxY) — but need to map (dispX, dispY) which is relative.
      x = boxX + dispY + ascent;
      y = boxY + dispX;
      rot = -90;
      break;
    case 180:
      x = boxX + (dispBoxW - dispX);
      y = boxY + (dispBoxH - dispY) - (fontSize - ascent) - ascent;
      // Cleaner: y_up baseline = boxY + (dispBoxH - dispY - fontSize) where fontSize ~= ascent for our purposes
      y = boxY + dispBoxH - dispY - ascent;
      // For 180 rotation around (x, y), text extends -x and +y in mediabox. So we want baseline at TOP-RIGHT of where the visible text appears.
      x = boxX + dispBoxW - dispX;
      rot = 180;
      break;
    case 270:
      x = boxX + (dispBoxW - dispY) - ascent;
      y = boxY + (dispBoxH - dispX);
      rot = 90;
      break;
    default:
      x = boxX + dispX;
      y = boxY + (dispBoxH - dispY) - ascent;
      rot = 0;
  }
  page.drawText(text, { x, y, size: fontSize, font: fontObj, color, rotate: degrees(rot) });
}

function drawSeparatorAtSigCaptionBoundary(page, boxX, boxY, boxW, boxH, dispSigH, pageRotation) {
  const color = rgb(0.62, 0.62, 0.62);
  const thickness = 0.4;
  // Endpoints in display: from (0, dispSigH) to (dispBoxW, dispSigH)
  const isSideways = pageRotation === 90 || pageRotation === 270;
  const dispBoxW = isSideways ? boxH : boxW;
  // Convert display endpoints to mediabox
  const a = displayPointToMediabox(boxX, boxY, boxW, boxH, 1, dispSigH, pageRotation);
  const b = displayPointToMediabox(boxX, boxY, boxW, boxH, dispBoxW - 1, dispSigH, pageRotation);
  page.drawLine({ start: a, end: b, thickness, color });
}

// (displayX, displayY) inside the box (display top-left origin) → mediabox y-up point.
// Use boxW / boxH directly (NOT dispBoxW / dispBoxH) so the math is correct for all
// rotations including 90 / 270 where display dims are swapped relative to MediaBox.
function displayPointToMediabox(boxX, boxY, boxW, boxH, dispX, dispY, pageRotation) {
  switch (pageRotation) {
    case 90:
      return { x: boxX + dispY,           y: boxY + dispX };
    case 180:
      return { x: boxX + boxW - dispX,    y: boxY + boxH - dispY };
    case 270:
      return { x: boxX + boxW - dispY,    y: boxY + boxH - dispX };
    default:
      return { x: boxX + dispX,           y: boxY + boxH - dispY };
  }
}

// Convert a display-space rectangle (dispX, dispY, dispW, dispH) inside the box to a
// MediaBox y-up rectangle. Returns the BL of the rect in MediaBox AFTER the inverse
// rotation transform (i.e. the rect the original-orientation image will occupy AFTER
// being pre-rotated to land back in this display space).
function displayRectToMediabox(boxX, boxY, boxW, boxH, dispX, dispY, dispW, dispH, pageRotation) {
  // Map the four corners of the display rect to mediabox, then take the min-x/min-y as
  // the BL and the dimensions accordingly.
  const a = displayPointToMediabox(boxX, boxY, boxW, boxH, dispX,         dispY,         pageRotation);
  const c = displayPointToMediabox(boxX, boxY, boxW, boxH, dispX + dispW, dispY + dispH, pageRotation);
  const minX = Math.min(a.x, c.x), maxX = Math.max(a.x, c.x);
  const minY = Math.min(a.y, c.y), maxY = Math.max(a.y, c.y);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
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
