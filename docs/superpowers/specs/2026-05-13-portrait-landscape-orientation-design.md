# Portrait/Landscape Orientation — Design

**Date:** 2026-05-13
**Topic:** Replace free-form PDF rotation with a binary Portrait/Landscape orientation chosen by the applicant; remove all rotation logic from the reviewer experience and from signature stamping.

---

## Problem

Today the applicant can rotate the PDF viewer to any of 0/90/180/270°, and that rotation:

1. Is stored on every marker (`marker.rotation`).
2. Drives `pickInitialRotation`, which forces every downstream viewer (preview drawer, approver drawer) to open at the same rotation.
3. Is consumed by `stampPdfMulti` to pre-rotate the signature image so it lands upright after the viewer applies `/Rotate`.

The behavior the user wants instead:

- The applicant picks **Portrait** or **Landscape** for the document. That's it — no arbitrary rotation.
- On submit, the chosen orientation is **baked into the PDF**: every page is physically oriented to match, and `/Rotate` is cleared.
- The reviewer opens the document with **no orientation UI**, **no rotate button**, and signs flat. The signature stamping code has **no rotation code path**.

## Scope

In scope:

- Applicant-side request creation: replace the Rotate button with a Portrait/Landscape toggle.
- Server-side: bake the chosen orientation into the PDF on submit; transform marker coordinates accordingly.
- Reviewer/approver: remove the rotate button and `pickInitialRotation` propagation; render at native /Rotate=0.
- Signature stamping: remove all rotation-aware code paths.
- Marker data model: drop the `rotation` field.

Out of scope:

- Migration of existing requests. Per stakeholder decision, this is a dev/demo environment; old requests are not preserved.
- Per-page orientation choice in the UI. The applicant picks one orientation for the whole document. The bake transforms individual pages as needed to achieve uniform orientation.
- Excel (.xlsx) document flow — currently no rotation; unchanged.

## Approach

Two viable mechanisms were considered for the physical bake:

1. **`embedPage` rebuild** — for each page that needs rotation, embed it as a `PDFEmbeddedPage`, create a new page with swapped MediaBox dimensions, and draw the embedded page onto it with rotation. Pages that already match the target orientation pass through untouched. Result: pages with `/Rotate = 0` and pixel-identical visuals. Flattens form fields and annotations.
2. **Content-stream CTM injection** — prepend a current-transformation-matrix operator to each rotated page's content stream and swap MediaBox dims. Preserves annotations but widget positions don't follow the matrix, so the preservation is misleading.

**Chosen: option 1.** The codebase already treats PDFs as flat images for stamping; we don't honor form fields anywhere. Option 1 is correct by construction and matches the user-facing promise that "what the applicant saw is what the reviewer sees."

## Architecture

```
Applicant (client)                  Server                    Reviewer (client)
-----------------                   ------                    ----------------
upload PDF
[Portrait | Landscape] toggle
place marker(s)
submit ────────[bytes, markers,──▶  for each page:
                orientation]         if page orientation != target:
                                       rotate 90° CW (bake via embedPage)
                                     else: leave as-is
                                     /Rotate cleared everywhere
                                     transform marker coords on rotated pages
                                     persist baked bytes + flat markers
                                                              ──▶ open at /Rotate=0
                                                                  no orientation UI
                                                                  click Sign
                                     stamp signature flat — no rotation code
```

## Components

### Client — `client/src/App.jsx`

**`PdfPagedViewer`**

- New props: `orientation: "portrait" | "landscape"`, `onOrientationChange: (next) => void`.
- The existing `rotation` state and `[r, (r+90)%360]` Rotate button are removed.
- For editable (applicant) mode: render a `[Portrait | Landscape]` toggle in the header instead.
- Per page, compute the page's native orientation from its viewport (`width vs height`). If it differs from `orientation`, render that page with pdf.js rotation 90° (CW). Otherwise render at 0°.
- On orientation toggle in editable mode: transform existing markers in-place using the same coordinate transform the server will apply on bake.
- For non-editable (preview, approver) modes: the toggle isn't rendered at all, and `orientation` is fixed to whatever was baked into the file.

**Marker model**

- The `rotation` field is removed from every place markers are constructed or read: `onAddMarker`, `setMarker`, `workflow.signers[].rotation`, request payloads, drag-update payloads.
- `pickInitialRotation` is deleted. Its call sites in the preview drawer and approve drawer drop the `initialRotation` prop entirely.

**Initial orientation default**

- On PDF load, detect the first page's native orientation and use it as the default `orientation` value. The applicant only has to click the toggle if they want the non-default.

### Server — `server/src/pdf.js`

**New function**

```
async function bakeOrientation(srcBytes, orientation):
  → returns { bakedBytes, pageRotations: number[] /* per-page 0 or 90 (CW) */ }
```

Uses pdf-lib:
- Load source PDF.
- Create a new `PDFDocument`.
- For each source page:
  - Compute native orientation: `width >= height` ⇒ landscape, else portrait.
  - If native matches `orientation`: copy the page unchanged via `copyPages` and set `/Rotate = 0`.
  - Else: embed via `embedPage`, create a new page with swapped dims, draw the embedded page rotated 90° CW, set `/Rotate = 0`.
  - Record the page's applied rotation (0 or 90).
- Save and return bytes + per-page rotations.

**`stampPdfMulti` simplifications**

- Remove the `viewRot` / `pageRotation` resolution at the top.
- Remove `displayPointToMediabox`, `displayRectToMediabox`, the four-case switch in `drawImageInBox`, the four-case switch in `drawTextInBox`, and the rotation parameter on `drawStampedBlock`.
- Signature image and caption are drawn directly in MediaBox y-up coordinates: box origin is `(boxX, boxY)`, image aspect-fits into the upper portion, caption text occupies the bottom portion if `dispBoxH * 0.28 >= 10` and there is caption data.

The function shrinks from ~250 lines to ~80.

### Server — `server/src/routes/requests.js`

POST request creation:

1. Parse `orientation` from the multipart payload (`"portrait" | "landscape"`, defaults to first-page native if absent).
2. Read the uploaded PDF bytes.
3. Call `bakeOrientation(srcBytes, orientation)` → `{ bakedBytes, pageRotations }`.
4. For each marker (single mode or every `workflow.signers[]` slot), if `pageRotations[marker.page - 1] === 90`, apply the 90°-CW coordinate transform to `(x, y, w, h)`:

   ```
   x' = 100 - y - h
   y' = x
   w' = h
   h' = w
   ```

5. Strip `rotation` from each marker before storage.
6. Persist the baked bytes as the canonical uploaded file. Persist the transformed markers.

For Excel uploads: skip steps 2–5, save the file as-is.

## Data model changes

`marker` schema (single + workflow):

- Removed: `rotation` (was: number 0/90/180/270).
- Unchanged: `page`, `x`, `y`, `w`, `h`.

`request` schema:

- No new persistent fields. `orientation` flows in on submit; consumed by the bake; not stored. The file itself is the source of truth for orientation afterward.

If any database column exists for `marker.rotation`, drop it as part of this change (verify during implementation; the migration is destructive only against the development DB, which we are willing to lose per scope).

## Coordinate transform reference

Marker `(x, y, w, h)` are MediaBox-space percentages, top-down y. A 90° CW page rotation maps:

- `x' = 100 - y - h`
- `y' = x`
- `w' = h`
- `h' = w`

Its inverse (90° CCW, used only client-side when toggling Landscape → Portrait on a previously-portrait page):

- `x' = y`
- `y' = 100 - x - w`
- `w' = h`
- `h' = w`

Flipping twice in either direction returns to identity (verified algebraically — useful for an automated test).

## Error handling & edges

- PDF already in target orientation, all pages: pass-through; no embed cost, no marker transform.
- Mixed-orientation PDF: per-page decision; per-page marker transform driven by `pageRotations[]`.
- PDF with non-zero `/Rotate` at upload: the bake produces `/Rotate = 0` everywhere regardless, because each page is either copied (and we explicitly set `/Rotate = 0`) or rebuilt from `embedPage` (which has no inherited `/Rotate`).
- Empty PDF / corrupt PDF: `bakeOrientation` propagates the pdf-lib error; the request creation route returns 400 as it does today.

## Testing

- **Unit (pure):** marker coordinate transform — flip-flip is identity for arbitrary `(x, y, w, h)`.
- **Unit (pdf):** `bakeOrientation` on a known portrait single-page PDF → request landscape → result has swapped MediaBox dims and `/Rotate = 0`.
- **Visual:** place marker on portrait page in the applicant viewer → toggle to Landscape → marker is at the same physical spot in the rotated view.
- **End-to-end:** applicant submits in Landscape with a marker on page 1 → reviewer opens → page 1 renders as landscape at /Rotate=0 with no rotate button visible → approves → downloaded signed PDF has the signature horizontal on the landscape page.

## What gets removed

- `client/src/App.jsx`: `pickInitialRotation` function, `rotation` state in `PdfPagedViewer`, Rotate button, `initialRotation` prop threading (`DocPreview`, preview drawer, approve drawer), rotation params from `onAddMarker` / `onUpdateMarker`.
- `server/src/pdf.js`: `displayPointToMediabox`, `displayRectToMediabox`, rotation parameter on `drawStampedBlock`, all four-case switches in `drawImageInBox` and `drawTextInBox`, the `viewRot` / `pageRotation` resolution at the top of `stampPdfMulti`.
- Anywhere `marker.rotation` is read or written that isn't part of the bake/transform.
