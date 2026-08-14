# Professional signature & date rendering — design

**Date:** 2026-08-14
**Status:** approved, in implementation

## Problem

Signed documents do not look professional. Three distinct defects, visible together
on a single stamped page:

1. **Signatures are stretched.** `stampPdfMultiBytes` calls `page.drawImage(img, place)`
   with the marker box's exact width and height, so the image is scaled to fill the box
   regardless of its native aspect. Two boxes of slightly different shapes render the
   same signature at two different aspect ratios — the handwriting is visibly distorted.
   The client preview already uses `objectFit: "contain"`, so the preview and the
   stamped output disagree today.

2. **Uploaded signatures carry their background.** `trimSignatureCanvas` only *crops*
   transparent / near-white margins; it never converts background pixels to alpha. A
   photo of a signature on ruled paper is stored, and stamped, as an opaque rectangle
   with the paper and its ruled lines intact, sitting on top of the document.

3. **The date does not match the document.** `drawDateInBox` hardcodes
   `StandardFonts.Helvetica` in navy `rgb(0.1, 0.12, 0.2)`, sized to fill 72% of the
   box height. It reads as a foreign annotation rather than part of the document.

A fourth, contributing problem: box sizing is expressed as a fixed percentage of the
page (`{w: 22, h: 6}`), which is a different physical size on A4, Letter and A3. The
requestor has to hand-resize on nearly every document.

## Approach

Four phases, each independently shippable.

### Phase 1 — Aspect-correct stamping + millimetre sizing

**Contain-fit.** A new `fitContain(place, imgW, imgH)` in `server/src/pdf.js` computes
the largest rectangle with the image's native aspect that fits inside the placed box,
centred. Applied in both `stampPdfMultiBytes` and `applySelfMarks`. The box becomes a
bounding box, not a target — matching the client preview's `objectFit: "contain"`.

Rotated pages: the fit is computed in the box's pre-rotation frame (the frame
`placeInRotatedPage` returns), so it composes with the existing rotation mapping
without special-casing.

**Millimetre presets.** `SIGNATURE_BOX_PRESETS` in `client/src/lib/constants.js`:

| Preset | Size |
|---|---|
| Small | 45 × 14 mm |
| Standard | 60 × 18 mm |
| Large | 80 × 24 mm |

Converted to page-percent at drop time from the real page dimensions reported by
pdf.js, so a box is the same physical size on every paper size. Preset chips appear in
the placement toolbar in single, direct and workflow modes and in Sign-your-documents;
the choice persists in `localStorage`.

Boxes are **always** aspect-locked — to the signer's stored `signatureAspect` when
known, to the preset's aspect otherwise. Corner handles grow 10px → 14px with a 20px
touch hit area, a badge shows live dimensions (`62 × 18 mm`) while dragging, and
resizing snaps to 1 mm increments.

Date boxes are not hand-sized at all: they are derived from the detected font size
(phase 4), falling back to a `10 pt`-equivalent box.

### Phase 2 — Real background removal

New `client/src/lib/signatureCutout.js`, run at upload time in `SignatureModal`.

1. **Paper colour** — median RGB of the outer 6% border ring. Handles cream paper,
   grey scans and phone-photo colour casts, which a fixed white threshold does not.
2. **Ink colour** — median RGB of the darkest 2nd percentile of pixels.
3. **Alpha ramp** — for each pixel, project it onto the paper→ink axis:
   `t = clamp(dot(p − paper, ink − paper) / |ink − paper|², 0, 1)`, then
   `alpha = smoothstep(lo, hi, t)`. The **soft ramp is what makes it look real**: a
   binary threshold destroys the anti-aliasing on stroke edges and produces visibly
   jagged, cut-out edges.
4. **Flat ink colour** — every output pixel takes the estimated ink colour, with all
   variation carried in alpha. Keeping the original grey edge pixels leaves strokes
   looking washed out and pale when composited over anything but white.
5. **Despeckle** — drop 4-connected components below a size floor relative to image
   area, removing JPEG noise and paper grain that survives the ramp.
6. **Trim** to the content bounding box with small padding, export PNG.

Projection onto the paper→ink axis rather than plain luminance means coloured pens
(the teal in the reference case) are handled correctly.

**UI.** Original vs. result shown side by side on a checkerboard *and* on a dark
swatch — dark backgrounds are where bad transparency actually reveals itself. Two
debounced sliders: *cleanup strength* (moves `lo`/`hi`) and *ink darkness*. Preview
computes on a downscaled proxy; full resolution only on save. A warning appears if the
source is under ~400px wide, since it will stamp soft.

### Phase 3 — Auto-clean of stored signatures

Signatures already on file have their background baked in, so phases 1–2 do not repair
existing users.

On sign-in, for each of the user's signatures with `bg_cleaned = 0`: fetch the blob,
test `isOpaqueBackground` (>80% of the border ring opaque and near paper colour), and
if so run the cutout at default settings and save it back. Silent, non-blocking, once
per signature.

**This rewrites a user's stored signature without asking**, so:

- the server keeps the original as `<name>.orig.png`, never deleted
- an audit event `signature.autocleaned` is written
- `POST /users/me/signatures/:sid/revert-cleanup` restores the original
- a toast informs the user, linking to the Signatures manager

Failures leave the flag unset and retry on the next sign-in, with an attempt cap so a
permanently failing image cannot loop.

Migration: `user_signatures.bg_cleaned TINYINT DEFAULT 0`, `original_path VARCHAR NULL`.

### Phase 4 — Date font matched to the document

Detection runs on the client, which already has pdf.js parsing the document; embedding
runs on the server, which has pdf-lib writing it.

**Detection** (`client/src/lib/docFont.js`): `getTextContent()` for the page, find the
text run nearest the date box (fallback: the page's dominant font by character count;
then the document's), and record `{ baseFont, size, bold, italic }`. Font size comes
from the text item's transform matrix. Ink colour is sampled from the already-rendered
page canvas over that run's bounding box, so the date matches the document's real text
colour instead of the current hardcoded navy.

Hints ride along with each date field into `signer_date_fields_json` / `date_fields_json`.

**Embedding** (`server/src/pdf-fonts.js`):

1. Walk the page's `/Resources /Font` **recursively through XObjects**. This is
   required: `bakeOrientation` re-embeds pages as form XObjects, which pushes the
   fonts down out of the page's own resource dictionary.
2. Match by `BaseFont`, stripping the `ABCDEF+` subset prefix, case- and
   space-insensitively.
3. Pull `FontFile2` (TrueType) or `FontFile3` (CFF/OpenType) from the `FontDescriptor`,
   including via `DescendantFonts` for Type0/CID fonts.
4. Embed with `@pdf-lib/fontkit`.
5. **Verify every glyph in the date string exists.** Subset fonts genuinely omit digits
   the document never printed. On any missing glyph, fall through.
6. Fallback: map the family name to the metrically-closest standard font —
   Times New Roman / Georgia / Cambria / Garamond → Times, Consolas / mono → Courier,
   everything else (Arial, Calibri, Segoe, Verdana) → Helvetica.
7. Final fallback: Helvetica.

**Rendering.** Size is the *detected point size*, with the box as a ceiling rather than
a target — shrink only if the text would overflow. Baseline placement uses the font's
real ascender/descender metrics, replacing the current `size * 0.12` fudge.

Date fields on existing pending requests carry no hints and keep today's exact
behaviour.

## Files

| File | Change |
|---|---|
| `server/src/pdf.js` | contain-fit; font resolution; metrics-based baseline |
| `server/src/pdf-fonts.js` | **new** — resource walk, FontFile extraction, fallback map |
| `server/src/routes/requests.js` | pass font hints through `bakeDateFields` / `dateStampsFor` |
| `server/src/routes/users.js` | original retention, `bg_cleaned`, revert endpoint |
| `server/src/db.js` | migration: `bg_cleaned`, `original_path` |
| `server/package.json` | add `@pdf-lib/fontkit` (hoisted at root today, undeclared) |
| `client/src/lib/signatureCutout.js` | **new** — cutout algorithm |
| `client/src/lib/docFont.js` | **new** — pdf.js font + colour detection |
| `client/src/lib/constants.js` | mm presets |
| `client/src/components/SignatureModal.jsx` | cutout preview + sliders |
| `client/src/viewer.jsx` | mm drop sizing, dimension badge, larger handles, locked aspect |
| `client/src/forms/NewRequest.jsx`, `App.jsx` | preset chips, font hints on date fields |

Tests extend `stampDate.test.mjs` and `applySelfMarks.test.mjs`; new `pdf-fonts.test.mjs`
and a `signatureCutout` unit test.

## Risks

| Risk | Mitigation |
|---|---|
| Subset font lacks digits | Glyph check before use, then standard-font fallback |
| Fonts hidden inside XObjects after orientation baking | Recursive resource walk, depth-limited |
| Auto-clean damages a good signature | Original retained, audit event, revert endpoint, user toast |
| Cutout fails on a low-contrast or shadowed photo | Manual sliders; opaque-background detection is conservative |
| Confidential documents | Font extraction runs on decrypted bytes already in memory, same path as stamping |

## Out of scope

Logo or emblem stamping on signed documents. Signature cropping/rotation tools.
Server-side image processing (no native image dependency is being added).
