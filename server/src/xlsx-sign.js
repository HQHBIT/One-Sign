// ============================================================
//   Excel signing — embeds signature images INTO the .xlsx
//   ------------------------------------------------------------
//   Markers are stored as percentages of the rendered sheet (the same
//   convention as PDFs). The viewer renders the FIRST sheet's used range, so a
//   marker at 20%/30% maps to 20% across / 30% down that range. ExcelJS anchors
//   an image to a cell rectangle via fractional tl/br coordinates, which gives
//   exactly that proportional placement without any pixel guesswork.
//
//   The result is a real .xlsx the recipient can open in Excel with the
//   signature visible — replacing the old sidecar "manifest" that recorded a
//   signature without ever applying one.
// ============================================================
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIGNED_DIR = path.join(__dirname, "..", "uploads", "signed");

// A signature this size or larger stays readable when the workbook is opened or
// printed. Only bites on very small sheets, where a strictly proportional box
// would shrink to an illegible smudge.
const MIN_W_PX = 120;
const MIN_H_PX = 34;

// Excel's own units -> screen pixels at 96dpi.
const colPx = (ws, i) => ((ws.getColumn(i)?.width ?? 8.43) * 7 + 5);
const rowPx = (ws, i) => ((ws.getRow(i)?.height ?? 15) * 4 / 3);

// The sheet the viewer shows (and therefore the one markers were placed on).
function targetSheet(wb) {
  return wb.worksheets.find(ws => ws.state !== "hidden" && ws.state !== "veryHidden") || wb.worksheets[0];
}

// The sheet's USED RANGE — the same extent the viewer renders (SheetJS lays out
// `!ref`, i.e. the populated rectangle). Markers are percentages of what the
// requestor saw, so mapping against anything wider would shift every signature.
function sheetExtent(ws) {
  const cols = Math.max(ws.columnCount || 0, ws.actualColumnCount || 0, 1);
  const rows = Math.max(ws.rowCount || 0, ws.actualRowCount || 0, 1);
  return { cols, rows };
}

// Pixel distance between two fractional cell offsets (0-based, `sizeOf` is 1-based).
function pxBetween(start, end, sizeOf, count) {
  let total = 0;
  for (let i = Math.floor(start); i < Math.min(Math.ceil(end), count); i++) {
    const from = Math.max(start, i), to = Math.min(end, i + 1);
    if (to > from) total += sizeOf(i + 1) * (to - from);
  }
  return total;
}

// Inverse of pxBetween: the fractional cell offset `wantPx` further along.
function offsetBy(start, wantPx, sizeOf, count) {
  let idx = Math.floor(start), used = start - idx, left = wantPx;
  while (idx < count) {
    const px = sizeOf(idx + 1), avail = px * (1 - used);
    if (avail >= left) return idx + used + left / px;
    left -= avail;
    idx += 1; used = 0;
  }
  return count;
}

// Embed every stamp into the workbook's visible sheet, in place.
//   stamps: [{ signaturePath, x, y, w, h }]  — x/y/w/h are percentages 0-100
async function applyStamps(wb, stamps) {
  const ws = targetSheet(wb);
  if (!ws) throw new Error("The workbook has no readable sheet");

  const { cols, rows } = sheetExtent(ws);
  const pct = (v) => Math.max(0, Math.min(100, Number(v) || 0)) / 100;
  const cSize = (i) => colPx(ws, i), rSize = (i) => rowPx(ws, i);

  for (const s of stamps) {
    if (!s?.signaturePath) continue;
    const ext = path.extname(s.signaturePath).toLowerCase() === ".jpg" ? "jpeg" : "png";
    const imageId = wb.addImage({ buffer: await fs.readFile(s.signaturePath), extension: ext });

    const left = pct(s.x) * cols;
    const top = pct(s.y) * rows;
    let right = Math.min(cols, pct(Number(s.x) + Number(s.w)) * cols);
    let bottom = Math.min(rows, pct(Number(s.y) + Number(s.h)) * rows);

    // Grow the box — keeping its shape — if it came out too small to read.
    const wPx = pxBetween(left, right, cSize, cols);
    const hPx = pxBetween(top, bottom, rSize, rows);
    const grow = Math.max(1, wPx > 0 ? MIN_W_PX / wPx : 1, hPx > 0 ? MIN_H_PX / hPx : 1);
    if (grow > 1) {
      right = offsetBy(left, Math.max(wPx * grow, MIN_W_PX), cSize, cols);
      bottom = offsetBy(top, Math.max(hPx * grow, MIN_H_PX), rSize, rows);
    }

    ws.addImage(imageId, {
      tl: { col: left, row: top },
      br: { col: Math.max(right, left + 0.05), row: Math.max(bottom, top + 0.05) },
      editAs: "oneCell",
    });
  }
}

/**
 * Sign a stored .xlsx and write the signed copy into uploads/signed.
 * Returns the absolute path of the signed workbook.
 */
export async function stampXlsx({ srcPath, stamps, outName }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(srcPath);
  await applyStamps(wb, stamps);
  await fs.mkdir(SIGNED_DIR, { recursive: true });
  const outPath = path.join(SIGNED_DIR, `${outName.replace(/\.xlsx?$/i, "")}.signed.xlsx`);
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

/**
 * Sign an in-memory .xlsx and hand the bytes straight back — used by
 * "Sign your documents", which stores nothing.
 */
export async function signXlsxBuffer({ buffer, stamps }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  await applyStamps(wb, stamps);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
