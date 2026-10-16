// ============================================================
//   How big an uploaded document may be — the ONE place to change it.
//   ------------------------------------------------------------
//   PDFs may be up to 30 MB for every user; Excel workbooks stay at 14 MB
//   (they are parsed in memory to embed signatures, and nobody has asked for
//   more). The client mirrors these in client/src/lib/constants.js.
//
//   Three layers enforce a size, and a browser meets the SMALLEST:
//     1. nginx client_max_body_size — rejects the body before the app sees it
//        (default 1 MB when unset). The deploy workflows raise it to 35 MB.
//     2. multer — UPLOAD_CEILING_BYTES, deliberately ABOVE the per-type limits:
//        multipart framing means a 30 MB file is not exactly 30 MB on the wire,
//        and a backstop set to the same number would reject borderline files
//        only after the whole upload had been waited for.
//     3. uploadSizeError() — the per-type rule, with a message a person can act on.
// ============================================================
export const PDF_MAX_MB = 30;
export const XLSX_MAX_MB = 14;
const MB = 1024 * 1024;
export const UPLOAD_CEILING_BYTES = (PDF_MAX_MB + 2) * MB;

const isSpreadsheet = (file) =>
  /\.xlsx?$/i.test(file?.originalname || "") || /spreadsheet|excel/i.test(file?.mimetype || "");

/** null when the file is within its limit, else a message to return with 413. */
export function uploadSizeError(file) {
  if (!file) return null;
  const xlsx = isSpreadsheet(file);
  const max = xlsx ? XLSX_MAX_MB : PDF_MAX_MB;
  if (file.size <= max * MB) return null;
  return `${xlsx ? "Excel files" : "PDFs"} can be up to ${max} MB — this one is ${(file.size / MB).toFixed(1)} MB.`;
}

/** Shown when multer itself stops an upload at the ceiling. */
export const TOO_LARGE_MESSAGE = `That file is too large. PDFs can be up to ${PDF_MAX_MB} MB and Excel files up to ${XLSX_MAX_MB} MB.`;
