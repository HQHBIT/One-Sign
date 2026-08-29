// ============================================================
//   HOW BIG SHOULD A SIGNATURE BOX BE?
//   ------------------------------------------------------------
//   Boxes used to be a fixed percentage of the page — 22% × 6%. Two problems
//   followed from that, and both landed on the requestor as manual resizing:
//
//   1. A percentage is a different physical size on every paper size. The same
//      box is 46 mm wide on A4 and 65 mm on A3.
//
//   2. Its shape (2.59:1) rarely matched the signature going into it. Since the
//      stamp is contain-fitted, a mismatched shape leaves slack: a 1:1
//      signature filled only 39% of the box, a 4:1 one about 65%. The signature
//      landed looking small, and the requestor dragged the box to compensate.
//
//   So the requestor now chooses how BIG, not what SHAPE. Height is the one
//   dimension that means anything for a signature — the same way type is sized
//   by height — and the width follows from the signer's own signature. The fit
//   is then exact and there is nothing to drag.
// ============================================================

const MM_PER_INCH = 25.4;
const PT_PER_INCH = 72;

export const mmToPt = (mm) => (mm / MM_PER_INCH) * PT_PER_INCH;
export const ptToMm = (pt) => (pt / PT_PER_INCH) * MM_PER_INCH;

// Heights in millimetres. A handwritten signature on a business document sits
// around 15–18 mm tall; these bracket that.
export const SIGNATURE_HEIGHTS_MM = { small: 12, standard: 16, large: 22 };
export const SIGNATURE_PRESETS = [
  { key: "small",    label: "Small" },
  { key: "standard", label: "Standard" },
  { key: "large",    label: "Large" },
];
export const DEFAULT_PRESET = "standard";

// Used when the signer has no signature on file yet, so there is no real aspect
// to follow. Close to the average of a scanned handwritten signature.
export const DEFAULT_SIGNATURE_ASPECT = 3.2;

// A date box holds "17/08/26" — short, wide, and much shorter than a signature.
export const DATE_HEIGHT_MM = 6;
export const DATE_ASPECT = 4.2;

const STORE_KEY = "signflow.boxPreset";

export function getPreset() {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return SIGNATURE_HEIGHTS_MM[v] ? v : DEFAULT_PRESET;
  } catch { return DEFAULT_PRESET; }
}

export function setPreset(key) {
  try { if (SIGNATURE_HEIGHTS_MM[key]) localStorage.setItem(STORE_KEY, key); } catch { /* ignore */ }
}

/**
 * A box of `heightMm`, with width following `aspect`, expressed as percentages
 * of a page that is `pagePt` = { w, h } points in its DISPLAYED orientation.
 * Returns null when the page has not been measured yet.
 */
export function boxPercentFor({ heightMm, aspect, pagePt }) {
  if (!pagePt || !(pagePt.w > 0) || !(pagePt.h > 0)) return null;
  const a = aspect > 0 ? aspect : DEFAULT_SIGNATURE_ASPECT;
  const hPt = mmToPt(heightMm);
  const wPt = hPt * a;
  return {
    w: Math.min(90, (wPt / pagePt.w) * 100),
    h: Math.min(90, (hPt / pagePt.h) * 100),
  };
}

/** The physical size of a %-box, for the on-screen readout. */
export function boxMillimetres({ box, pagePt }) {
  if (!pagePt || !box) return null;
  return {
    w: ptToMm((box.w / 100) * pagePt.w),
    h: ptToMm((box.h / 100) * pagePt.h),
  };
}

/**
 * Snap a %-box's HEIGHT to whole millimetres and rebuild the width from the
 * aspect, so a dragged box stays both tidy and correctly shaped.
 */
export function snapBox({ box, aspect, pagePt, minMm = 6, maxMm = 60 }) {
  if (!pagePt) return box;
  const mm = ptToMm((box.h / 100) * pagePt.h);
  const snapped = Math.max(minMm, Math.min(maxMm, Math.round(mm)));
  return boxPercentFor({ heightMm: snapped, aspect, pagePt }) || box;
}
