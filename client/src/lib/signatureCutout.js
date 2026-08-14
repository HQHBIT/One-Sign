// ============================================================
//   SIGNATURE BACKGROUND REMOVAL
//   ------------------------------------------------------------
//   Turns a photo or scan of a signature on paper into a PNG with a genuinely
//   transparent background, so it composites onto a document like ink rather
//   than sitting there as an opaque rectangle of someone's notebook.
//
//   Why the approach is what it is:
//
//   * The paper colour is MEASURED, not assumed to be white. Phone photos come
//     out cream, grey, or colour-cast by the room lighting; a fixed white
//     threshold leaves a visible tinted box behind.
//   * Alpha comes from a SMOOTH RAMP, not a threshold. Stroke edges are
//     anti-aliased; a binary cut throws that away and the result reads as
//     jagged and pasted-on. The ramp is the single thing that makes it look
//     real.
//   * Output pixels are flooded with the estimated INK colour, carrying all
//     variation in alpha. Keeping the original half-grey edge pixels makes
//     strokes look washed out and pale over anything that isn't white.
//   * "Ink-ness" is measured by projecting onto the paper→ink axis rather than
//     by luminance, so coloured pens (blue, teal) survive intact.
// ============================================================

export const CUTOUT_DEFAULTS = { strength: 0.5, inkDarkness: 0.5 };

// Below this paper↔ink separation (0-441 in RGB distance) the image has too
// little contrast to separate reliably — usually a dark photo or a pencil
// signature. We still produce a result, but the caller warns the user.
const LOW_CONTRAST_DISTANCE = 45;

// Anything at or under this alpha counts as already-transparent and is ignored
// when sampling colours.
const TRANSPARENT_A = 8;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Classic smoothstep — the cubic gives a gentler shoulder than a linear ramp,
// which matters most on the thin tapering ends of a pen stroke.
function smoothstep(lo, hi, v) {
  if (hi <= lo) return v < lo ? 0 : 1;
  const t = clamp((v - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
}

// Strength 0..1 → the ramp's start/end. Raising it lifts both ends: the floor
// pushes faint stuff (paper grain, ruled lines, JPEG mush) to nothing, and the
// ceiling keeps partially-covered pixels partial for longer.
//
// The ceiling deliberately sits high. Since `ink` is the median of the darkest
// 2%, a stroke's core lands at t≈1 and still comes out solid — but a pixel that
// is genuinely half ink and half paper keeps roughly half alpha instead of
// snapping to opaque. Snapping is what fattens strokes and gives the stamped
// signature that cut-out, pasted-on look.
function rampFor(strength) {
  const s = clamp(strength, 0, 1);
  return { lo: 0.04 + 0.20 * s, hi: 0.55 + 0.28 * s };
}

// Darkness 0..1 → a multiplier on the detected ink colour. 0.5 leaves it as
// measured; photos of ballpoint often want a nudge darker to print well.
function inkScaleFor(darkness) {
  return 1.45 - 0.9 * clamp(darkness, 0, 1);
}

function medianOf(values) {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

// Median RGB of the outer border ring. Median (not mean) so a signature that
// runs off the edge of the crop can't drag the estimate toward the ink.
function estimatePaper(data, w, h) {
  const band = Math.max(1, Math.round(Math.min(w, h) * 0.06));
  const rs = [], gs = [], bs = [];
  const step = Math.max(1, Math.round(Math.min(w, h) / 200));
  for (let y = 0; y < h; y += step) {
    const inTopBottom = y < band || y >= h - band;
    for (let x = 0; x < w; x += step) {
      if (!inTopBottom && x >= band && x < w - band) continue; // interior
      const i = (y * w + x) * 4;
      if (data[i + 3] <= TRANSPARENT_A) continue;
      rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
    }
  }
  if (!rs.length) return [255, 255, 255];
  return [medianOf(rs), medianOf(gs), medianOf(bs)];
}

// Median RGB of the darkest 2% of opaque pixels — the pen itself.
function estimateInk(data, w, h) {
  const step = Math.max(1, Math.round(Math.min(w, h) / 300));
  const samples = [];
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (data[i + 3] <= TRANSPARENT_A) continue;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      samples.push([lum, i]);
    }
  }
  if (!samples.length) return [0, 0, 0];
  samples.sort((a, b) => a[0] - b[0]);
  const take = Math.max(1, Math.round(samples.length * 0.02));
  const rs = [], gs = [], bs = [];
  for (let k = 0; k < take; k++) {
    const i = samples[k][1];
    rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
  }
  return [medianOf(rs), medianOf(gs), medianOf(bs)];
}

// Drops connected blobs smaller than a floor proportional to the image — paper
// grain and JPEG ringing that survived the ramp. Iterative flood fill: a
// recursive one blows the stack on a full-resolution photo.
function despeckle(alpha, w, h) {
  const minSize = Math.max(6, Math.round(w * h * 0.00003));
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const blob = new Int32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (seen[p] || alpha[p] < 128) continue;
    let sp = 0, bn = 0;
    stack[sp++] = p;
    seen[p] = 1;
    while (sp > 0) {
      const q = stack[--sp];
      blob[bn++] = q;
      const qx = q % w, qy = (q / w) | 0;
      if (qx > 0     && !seen[q - 1] && alpha[q - 1] >= 128) { seen[q - 1] = 1; stack[sp++] = q - 1; }
      if (qx < w - 1 && !seen[q + 1] && alpha[q + 1] >= 128) { seen[q + 1] = 1; stack[sp++] = q + 1; }
      if (qy > 0     && !seen[q - w] && alpha[q - w] >= 128) { seen[q - w] = 1; stack[sp++] = q - w; }
      if (qy < h - 1 && !seen[q + w] && alpha[q + w] >= 128) { seen[q + w] = 1; stack[sp++] = q + w; }
    }
    if (bn < minSize) for (let k = 0; k < bn; k++) alpha[blob[k]] = 0;
  }
}

/**
 * Core transform. Takes ImageData, returns a NEW ImageData with the paper
 * removed. Pure and synchronous so it can be unit-tested without a DOM.
 */
export function cutoutImageData(src, opts = {}) {
  const { strength, inkDarkness } = { ...CUTOUT_DEFAULTS, ...opts };
  const { width: w, height: h, data } = src;
  const paper = estimatePaper(data, w, h);
  const ink = estimateInk(data, w, h);

  const ax = ink[0] - paper[0], ay = ink[1] - paper[1], az = ink[2] - paper[2];
  const axisLenSq = ax * ax + ay * ay + az * az;
  const separation = Math.sqrt(axisLenSq);

  const out = new ImageData(w, h);
  const alpha = new Uint8ClampedArray(w * h);

  // No usable paper↔ink axis at all (a blank or single-colour image): leave it
  // alone rather than turning the whole thing transparent.
  if (axisLenSq < 1) {
    out.data.set(data);
    return { imageData: out, paper, ink, separation, lowContrast: true };
  }

  const { lo, hi } = rampFor(strength);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    if (data[i + 3] <= TRANSPARENT_A) { alpha[p] = 0; continue; }
    // Scalar projection of (pixel - paper) onto (ink - paper), normalised so
    // t=0 is exactly paper and t=1 is exactly ink.
    const t = ((data[i] - paper[0]) * ax +
               (data[i + 1] - paper[1]) * ay +
               (data[i + 2] - paper[2]) * az) / axisLenSq;
    alpha[p] = Math.round(255 * smoothstep(lo, hi, t));
  }

  despeckle(alpha, w, h);

  const scale = inkScaleFor(inkDarkness);
  const ir = clamp(Math.round(ink[0] * scale), 0, 255);
  const ig = clamp(Math.round(ink[1] * scale), 0, 255);
  const ib = clamp(Math.round(ink[2] * scale), 0, 255);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    out.data[i] = ir; out.data[i + 1] = ig; out.data[i + 2] = ib;
    out.data[i + 3] = alpha[p];
  }

  return {
    imageData: out,
    paper, ink: [ir, ig, ib], separation,
    lowContrast: separation < LOW_CONTRAST_DISTANCE
  };
}

/**
 * True when the image still has its paper baked in — used to decide whether a
 * stored signature needs cleaning. Deliberately conservative: it only fires
 * when the border really is a solid opaque frame, so an already-clean
 * signature is never touched.
 */
export function isOpaqueBackground(src) {
  const { width: w, height: h, data } = src;
  const band = Math.max(1, Math.round(Math.min(w, h) * 0.06));
  let opaque = 0, total = 0;
  const step = Math.max(1, Math.round(Math.min(w, h) / 200));
  for (let y = 0; y < h; y += step) {
    const inTopBottom = y < band || y >= h - band;
    for (let x = 0; x < w; x += step) {
      if (!inTopBottom && x >= band && x < w - band) continue;
      total++;
      if (data[(y * w + x) * 4 + 3] > 247) opaque++;
    }
  }
  return total > 0 && opaque / total > 0.8;
}

// ---- DOM helpers -------------------------------------------------------

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that image"));
    img.src = src;
  });
}

function toCanvas(img, maxDim) {
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  const scale = maxDim ? Math.min(1, maxDim / Math.max(nw, nh)) : 1;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(nw * scale));
  c.height = Math.max(1, Math.round(nh * scale));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// Crops to the ink with a little breathing room. Runs AFTER the cutout, so it
// can trust alpha alone — no need for the old near-white heuristic.
function trimToAlpha(canvas) {
  const { width: w, height: h } = canvas;
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, w, h);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas; // nothing survived — hand back the input
  const pad = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  const out = document.createElement("canvas");
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext("2d").drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/**
 * Full pipeline: image source → transparent, trimmed PNG.
 *   opts.maxDim  — downscale first (used for the live preview; omit on save)
 *   opts.trim    — crop to content afterwards (default true)
 * Returns { dataUrl, canvas, width, height, lowContrast, tooSmall }.
 */
export async function cutoutSignature(src, opts = {}) {
  const { maxDim, trim = true, ...tuning } = opts;
  const img = typeof src === "string" ? await loadImage(src) : src;
  const canvas = toCanvas(img, maxDim);
  const ctx = canvas.getContext("2d");
  const result = cutoutImageData(ctx.getImageData(0, 0, canvas.width, canvas.height), tuning);
  ctx.putImageData(result.imageData, 0, 0);
  const finalCanvas = trim ? trimToAlpha(canvas) : canvas;
  return {
    dataUrl: finalCanvas.toDataURL("image/png"),
    canvas: finalCanvas,
    width: finalCanvas.width,
    height: finalCanvas.height,
    lowContrast: result.lowContrast,
    // Below this the signature stamps visibly soft at document scale.
    tooSmall: (img.naturalWidth || img.width) < 400
  };
}
