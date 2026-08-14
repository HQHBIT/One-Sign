// Unit: the signature background-removal maths.
// The DOM-touching helpers live in the same module but are only reached from
// inside functions, so importing it under Node is safe with an ImageData shim.
import assert from "node:assert/strict";

if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    constructor(a, b, c) {
      if (typeof a === "number") {
        this.width = a; this.height = b;
        this.data = new Uint8ClampedArray(a * b * 4);
      } else {
        this.data = a; this.width = b; this.height = c;
      }
    }
  };
}

const { cutoutImageData, isOpaqueBackground, CUTOUT_DEFAULTS } =
  await import("../src/lib/signatureCutout.js");

// Builds an opaque image of `bg`, then paints `rects` in `fg`.
function makeImage(w, h, bg, rects = [], fg = [0, 0, 0], alpha = 255) {
  const img = new ImageData(w, h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    img.data[i] = bg[0]; img.data[i + 1] = bg[1]; img.data[i + 2] = bg[2];
    img.data[i + 3] = alpha;
  }
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        img.data[i] = fg[0]; img.data[i + 1] = fg[1]; img.data[i + 2] = fg[2];
      }
    }
  }
  return img;
}

const alphaAt = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];
const rgbAt = (img, x, y) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

// ---- black ink on white paper: paper goes, ink stays ----
{
  const src = makeImage(100, 60, [255, 255, 255], [[20, 20, 40, 40]]);
  const { imageData: out, lowContrast } = cutoutImageData(src, CUTOUT_DEFAULTS);
  assert.equal(alphaAt(out, 0, 0), 0, "corner paper is fully transparent");
  assert.equal(alphaAt(out, 99, 59), 0, "far corner is fully transparent");
  assert.equal(alphaAt(out, 30, 30), 255, "ink is fully opaque");
  assert.equal(lowContrast, false, "black on white is high contrast");
}

// ---- cream paper is detected, not assumed white ----
{
  const src = makeImage(100, 60, [245, 240, 225], [[20, 20, 40, 40]], [25, 25, 30]);
  const { imageData: out } = cutoutImageData(src, CUTOUT_DEFAULTS);
  assert.equal(alphaAt(out, 2, 2), 0, "cream paper is removed, not left as a tinted box");
  assert.equal(alphaAt(out, 30, 30), 255, "ink survives on cream paper");
}

// ---- coloured ink survives: alpha is projection onto paper→ink, not luminance ----
{
  const teal = [30, 130, 125];
  const src = makeImage(100, 60, [252, 250, 248], [[20, 20, 40, 40]], teal);
  const { imageData: out, ink } = cutoutImageData(src, CUTOUT_DEFAULTS);
  assert.equal(alphaAt(out, 30, 30), 255, "teal ink is kept");
  assert.equal(alphaAt(out, 1, 1), 0, "paper still removed under coloured ink");
  const [r, g, b] = rgbAt(out, 30, 30);
  assert.ok(g > r && b > r, `output keeps the ink's hue (got ${r},${g},${b})`);
  assert.ok(ink[1] > ink[0], "detected ink is the teal, not black");
}

// ---- edge pixels get intermediate alpha: the soft ramp is what stops jaggies ----
{
  const src = makeImage(100, 60, [255, 255, 255], [[20, 20, 40, 40]]);
  // A half-tone pixel on the stroke boundary, as anti-aliasing would produce.
  const i = (30 * 100 + 19) * 4;
  src.data[i] = 128; src.data[i + 1] = 128; src.data[i + 2] = 128;
  const { imageData: out } = cutoutImageData(src, CUTOUT_DEFAULTS);
  const a = alphaAt(out, 19, 30);
  assert.ok(a > 0 && a < 255, `half-tone edge pixel is partially transparent (got ${a})`);
}

// ---- strength raises the floor: more of the faint stuff disappears ----
{
  const mk = () => makeImage(100, 60, [255, 255, 255], [[20, 20, 40, 40]]);
  const faint = (img) => {
    // A pale ruled line across the page, well away from the signature.
    for (let x = 0; x < 100; x++) {
      const i = (50 * 100 + x) * 4;
      img.data[i] = 225; img.data[i + 1] = 228; img.data[i + 2] = 235;
    }
    return img;
  };
  const gentle = cutoutImageData(faint(mk()), { strength: 0 }).imageData;
  const hard = cutoutImageData(faint(mk()), { strength: 1 }).imageData;
  assert.ok(alphaAt(hard, 50, 50) <= alphaAt(gentle, 50, 50),
    "raising strength removes at least as much of a pale ruled line");
  assert.equal(alphaAt(hard, 30, 30), 255, "the signature itself survives full strength");
}

// ---- despeckle clears isolated noise but keeps the signature ----
{
  const src = makeImage(100, 60, [255, 255, 255], [[20, 20, 40, 40]]);
  const i = (5 * 100 + 80) * 4;               // one stray dark pixel
  src.data[i] = 0; src.data[i + 1] = 0; src.data[i + 2] = 0;
  const { imageData: out } = cutoutImageData(src, CUTOUT_DEFAULTS);
  assert.equal(alphaAt(out, 80, 5), 0, "a single-pixel speck is dropped");
  assert.equal(alphaAt(out, 30, 30), 255, "the real blob is kept");
}

// ---- a blank image is left alone rather than wiped ----
{
  const src = makeImage(40, 40, [255, 255, 255]);
  const { imageData: out, lowContrast } = cutoutImageData(src, CUTOUT_DEFAULTS);
  assert.equal(lowContrast, true, "no paper→ink axis means low contrast");
  assert.equal(alphaAt(out, 20, 20), 255, "blank input is passed through untouched");
}

// ---- ink darkness shifts the output colour in the right direction ----
{
  const src = makeImage(100, 60, [255, 255, 255], [[20, 20, 40, 40]], [90, 90, 90]);
  const light = cutoutImageData(src, { inkDarkness: 0 }).imageData;
  const dark = cutoutImageData(src, { inkDarkness: 1 }).imageData;
  assert.ok(rgbAt(dark, 30, 30)[0] < rgbAt(light, 30, 30)[0],
    "higher darkness produces darker ink");
}

// ---- isOpaqueBackground only fires on a genuinely solid border ----
{
  assert.equal(isOpaqueBackground(makeImage(100, 60, [255, 255, 255], [[20, 20, 40, 40]])), true,
    "a stored signature with its paper still on is flagged");
  const clean = makeImage(100, 60, [255, 255, 255], [[20, 20, 40, 40]], [0, 0, 0], 0);
  assert.equal(isOpaqueBackground(clean), false,
    "an already-transparent signature is left alone");
}

console.log("signatureCutout: all tests passed");
