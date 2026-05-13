# Portrait/Landscape Orientation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-form 0/90/180/270° PDF rotation with a binary Portrait/Landscape orientation chosen by the applicant. On submit, bake the chosen orientation into the PDF and transform marker coordinates so the reviewer sees a uniformly-oriented document with no rotation UI, and the signature stamps flat at MediaBox `(x, y)` with no rotation-aware code.

**Architecture:** Applicant picks Portrait or Landscape on the request-creation page. The viewer displays each page rotated 90° CW iff its native orientation differs from the chosen target — purely visual; the underlying file isn't touched yet. Markers are stored in the **native MediaBox frame throughout editing** (rotation-independent, identical to the original code's invariant), with the existing `viewportToMediabox` / `mediaboxToViewport` helpers handling click and display. On submit, the server runs `bakeOrientation()` which re-embeds every needed page onto a new page rotated 90° CW with swapped MediaBox dimensions and `/Rotate = 0`, then transforms each marker once from pre-bake to post-bake MediaBox coords. After that, `marker.rotation` is gone from the data model, `pickInitialRotation` is removed from the client, and `stampPdfMulti` no longer has any rotation-aware code paths.

**Tech Stack:** Node.js, Express, `pdf-lib` (server PDF surgery), React + `pdfjs-dist` (client viewer), MySQL via `mysql2` (storage), `node --test` (server unit tests, ships with Node 18+).

---

## File Structure

```
server/src/
  pdf.js                        MODIFY  — add bakeOrientation(); simplify stampPdfMulti()
  pdf-rotation.js               CREATE  — pure functions: orientationOf(), rotateMarker90CW(),
                                          bakeOrientationPlan()
  routes/requests.js            MODIFY  — wire bakeOrientation into POST /, transform markers,
                                          drop rotation field from inserts and stamp calls
server/test/
  pdf-rotation.test.js          CREATE  — unit tests for the pure transform functions
  bake-orientation.test.js      CREATE  — integration test that bakes a generated PDF and inspects it

client/src/
  api.js                        MODIFY  — createRequest() sends `orientation`
  App.jsx                       MODIFY  — Portrait/Landscape toggle in PdfPagedViewer (editable only),
                                          drop pickInitialRotation, drop initialRotation prop
                                          threading, drop marker.rotation, drop RotateCw icon

server/src/db.js                NOT MODIFIED — `rotation` column in request_step_signers stays in
                                place (idempotent migration). It will be written as 0 going forward
                                and ignored on read, per the spec's "no migration" decision.
```

The new `server/src/pdf-rotation.js` module isolates the pure helpers used by the bake. The client keeps using the existing `viewportToMediabox`/`mediaboxToViewport` helpers in `App.jsx` (they already handle the 0-or-90 cases correctly — just unused branches for 180/270).

---

## Prerequisites

The repo is not currently a git repository (per environment metadata). The plan uses `git commit` between tasks. If you intend to skip git, just skip the commit steps; nothing else depends on them. If you want commits, run once before starting:

```bash
cd D:\OneSign
git init
git add -A
git commit -m "chore: pre-orientation baseline"
```

The server has no pre-existing test runner. Tasks below use Node's built-in test runner (`node --test`), available in Node 18+. No new dependencies needed.

---

## Task 1: Pure rotation utilities + tests

**Files:**
- Create: `server/src/pdf-rotation.js`
- Create: `server/test/pdf-rotation.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/test/pdf-rotation.test.js`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  orientationOf,
  rotateMarker90CW,
  bakeOrientationPlan
} from "../src/pdf-rotation.js";

test("orientationOf returns 'landscape' when width > height", () => {
  assert.equal(orientationOf({ width: 800, height: 600 }), "landscape");
});

test("orientationOf returns 'portrait' when height >= width", () => {
  assert.equal(orientationOf({ width: 600, height: 800 }), "portrait");
  assert.equal(orientationOf({ width: 600, height: 600 }), "portrait");
});

test("rotateMarker90CW maps top-left corner to right edge", () => {
  // Marker at (x=10, y=20, w=10, h=5) in top-down %.
  // After 90° CW on the page: the marker's pre-rotation top-left ends up at
  // post-rotation (x=80, y=10). w/h swap.
  const r = rotateMarker90CW({ x: 10, y: 20, w: 10, h: 5 });
  assert.deepEqual(r, { x: 75, y: 10, w: 5, h: 10 });
});

test("rotateMarker90CW applied four times returns to identity", () => {
  let m = { x: 10, y: 20, w: 10, h: 5 };
  const orig = { ...m };
  for (let i = 0; i < 4; i++) m = rotateMarker90CW(m);
  assert.deepEqual(m, orig);
});

test("bakeOrientationPlan keeps pages already in target orientation", () => {
  const pages = [{ width: 600, height: 800 }, { width: 600, height: 800 }];
  const plan = bakeOrientationPlan(pages, "portrait");
  assert.deepEqual(plan, [0, 0]);
});

test("bakeOrientationPlan rotates pages whose orientation differs", () => {
  const pages = [
    { width: 600, height: 800 }, // portrait
    { width: 800, height: 600 }  // landscape
  ];
  assert.deepEqual(bakeOrientationPlan(pages, "portrait"),  [0,  90]);
  assert.deepEqual(bakeOrientationPlan(pages, "landscape"), [90, 0]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:\OneSign\server && node --test test/pdf-rotation.test.js`
Expected: FAIL — `Cannot find module '../src/pdf-rotation.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/pdf-rotation.js`:

```javascript
// Pure rotation helpers used by the server's bake step. Marker coordinates are
// top-down MediaBox % with x to the right and y downward; w/h are widths/heights
// in %. A 90° clockwise rotation of the *page* maps a marker at (x, y) on the
// pre-rotation page to (100 - y - h, x) on the post-rotation page, with w and h
// swapping. (Same math as the existing viewportToMediabox helper in App.jsx.)

export function orientationOf({ width, height }) {
  return width > height ? "landscape" : "portrait";
}

export function rotateMarker90CW({ x, y, w, h }) {
  return { x: 100 - y - h, y: x, w: h, h: w };
}

// For each page dimensions object, returns 0 (leave as-is) or 90 (rotate CW)
// to reach the target orientation. Callers iterate pages in order.
export function bakeOrientationPlan(pageDims, targetOrientation) {
  return pageDims.map(d => orientationOf(d) === targetOrientation ? 0 : 90);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:\OneSign\server && node --test test/pdf-rotation.test.js`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/pdf-rotation.js server/test/pdf-rotation.test.js
git commit -m "feat: pure rotation helpers for orientation bake"
```

---

## Task 2: bakeOrientation function + integration test

**Files:**
- Modify: `server/src/pdf.js` (add `bakeOrientation` export)
- Create: `server/test/bake-orientation.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/test/bake-orientation.test.js`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { bakeOrientation } from "../src/pdf.js";

async function makePdf(pages) {
  const pdf = await PDFDocument.create();
  for (const { w, h } of pages) pdf.addPage([w, h]);
  return await pdf.save();
}

test("bakeOrientation passes through a portrait PDF unchanged when target is portrait", async () => {
  const src = await makePdf([{ w: 600, h: 800 }]);
  const { bakedBytes, pageRotations } = await bakeOrientation(src, "portrait");
  const out = await PDFDocument.load(bakedBytes);
  assert.equal(out.getPageCount(), 1);
  const { width, height } = out.getPage(0).getSize();
  assert.equal(width, 600);
  assert.equal(height, 800);
  assert.deepEqual(pageRotations, [0]);
});

test("bakeOrientation rotates a portrait page to landscape (dims swap, /Rotate cleared)", async () => {
  const src = await makePdf([{ w: 600, h: 800 }]);
  const { bakedBytes, pageRotations } = await bakeOrientation(src, "landscape");
  const out = await PDFDocument.load(bakedBytes);
  const page = out.getPage(0);
  const { width, height } = page.getSize();
  assert.equal(width, 800);
  assert.equal(height, 600);
  assert.equal(page.getRotation().angle, 0);
  assert.deepEqual(pageRotations, [90]);
});

test("bakeOrientation handles mixed-orientation PDFs per-page", async () => {
  const src = await makePdf([
    { w: 600, h: 800 }, // portrait
    { w: 800, h: 600 }, // landscape
    { w: 600, h: 800 }  // portrait
  ]);
  const { bakedBytes, pageRotations } = await bakeOrientation(src, "portrait");
  const out = await PDFDocument.load(bakedBytes);
  assert.equal(out.getPageCount(), 3);
  for (let i = 0; i < 3; i++) {
    const { width, height } = out.getPage(i).getSize();
    assert.ok(height >= width, `page ${i} should be portrait`);
    assert.equal(out.getPage(i).getRotation().angle, 0);
  }
  assert.deepEqual(pageRotations, [0, 90, 0]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:\OneSign\server && node --test test/bake-orientation.test.js`
Expected: FAIL — `bakeOrientation is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `server/src/pdf.js`, add this import at the top alongside the existing `pdf-lib` import:

```javascript
import { orientationOf, bakeOrientationPlan } from "./pdf-rotation.js";
```

Then add this new exported function (place it after `stampPdfMulti`):

```javascript
// Rebuilds the PDF so every page matches the target orientation. Pages already in
// that orientation are embedded and drawn unchanged. Pages in the other orientation
// are embedded and drawn rotated 90° CW onto a new page with swapped MediaBox dims.
// Result: all pages have /Rotate = 0 and display in the target orientation natively.
// Returns the new bytes and a parallel array indicating which pages were rotated
// (0 = unchanged, 90 = rotated CW).
export async function bakeOrientation(srcBytes, targetOrientation) {
  const src = await PDFDocument.load(srcBytes);
  const srcPages = src.getPages();

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
```

Note: `degrees` is already imported at the top of `server/src/pdf.js` (`import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:\OneSign\server && node --test test/bake-orientation.test.js`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Visual sanity check the bake math**

The dim-and-/Rotate checks pass automatically, but the test can't verify visually that the rotated content lands on the new page. Run a quick manual check:

```bash
cd D:\OneSign && node --input-type=module -e "import { PDFDocument, rgb } from 'pdf-lib'; import { bakeOrientation } from './server/src/pdf.js'; import fs from 'node:fs/promises'; const src = await PDFDocument.create(); const p = src.addPage([600, 800]); p.drawText('TOP-LEFT', { x: 20, y: 770, size: 24 }); p.drawText('BOTTOM-RIGHT', { x: 400, y: 20, size: 24 }); const bytes = await src.save(); const { bakedBytes } = await bakeOrientation(bytes, 'landscape'); await fs.writeFile('./bake-check.pdf', bakedBytes); console.log('Wrote bake-check.pdf');"
```

Open `D:\OneSign\bake-check.pdf` in any PDF viewer. Expected: a landscape page (800w × 600h) where "TOP-LEFT" appears in the top-LEFT of the visible page and "BOTTOM-RIGHT" appears in the bottom-RIGHT, both rotated 90° CW relative to their original orientation (so reading direction is now top-to-bottom along the right edge for "TOP-LEFT", etc.). The key check: both texts are visible and on the page. If either is off-page, the anchor coordinates need adjustment.

If the manual check fails (text off-page), the most likely fix is to swap `x` and `y` in the rotated branch of `drawEmbeddedRotated`:

```javascript
page.drawPage(embedded, { x: visH, y: 0, width: visW, height: visH, rotate: degrees(-90) });
```

Re-run the visual check after any tweak and re-run the test suite to confirm dim/rotate invariants still pass.

Delete `bake-check.pdf` when done.

- [ ] **Step 6: Commit**

```bash
git add server/src/pdf.js server/test/bake-orientation.test.js
git commit -m "feat: bakeOrientation rebuilds PDF to uniform orientation"
```

---

## Task 3: Wire bakeOrientation into the request creation route

**Files:**
- Modify: `server/src/routes/requests.js` (POST `/`, both legacy and workflow paths)

- [ ] **Step 1: Add imports**

At the top of `server/src/routes/requests.js`, alongside the existing imports, add:

```javascript
import { bakeOrientation } from "../pdf.js";
import { rotateMarker90CW } from "../pdf-rotation.js";
```

(Note: `stampPdf`/`stampPdfMulti` are already imported from `../pdf.js` — extend that import line instead of adding a duplicate line.)

- [ ] **Step 2: Add helpers near the top of the file**

Just after the `const upload = multer({...})` declaration, add:

```javascript
function parseOrientation(raw) {
  const v = (raw || "").toString().toLowerCase();
  return v === "landscape" ? "landscape" : v === "portrait" ? "portrait" : null;
}

// Bake the orientation into the uploaded PDF bytes and return the new buffer
// plus the per-page rotation plan. Non-PDFs and missing orientation pass through.
async function bakeRequestFile({ buffer, fileType, orientation }) {
  if (fileType !== "pdf" || !orientation) {
    return { bakedBuffer: buffer, pageRotations: [] };
  }
  const { bakedBytes, pageRotations } = await bakeOrientation(buffer, orientation);
  return { bakedBuffer: Buffer.from(bakedBytes), pageRotations };
}

// Apply the per-page rotation plan to a marker. If the marker's page was rotated
// 90° CW during the bake, rotate the marker the same way; otherwise return as-is.
function transformMarkerForBake(marker, pageRotations) {
  const pageIdx = (marker.page || 1) - 1;
  if (pageRotations[pageIdx] !== 90) return marker;
  const r = rotateMarker90CW({ x: marker.x, y: marker.y, w: marker.w, h: marker.h });
  return { ...marker, ...r };
}
```

- [ ] **Step 3: Use the helpers in the legacy single-marker path**

In `router.post("/", ...)`, replace the block from `const { targetTeamId, marker } = req.body || {};` down to and including `await fs.writeFile(path.join(DOC_DIR, storedName), file.buffer);` (about lines 89–106 in the current file) with:

```javascript
    // ---------- legacy single-marker single-team path ----------
    const { targetTeamId, marker } = req.body || {};
    if (!targetTeamId || !marker) return res.status(400).json({ error: "Provide either workflow or targetTeamId+marker" });
    let markerObj;
    try { markerObj = JSON.parse(marker); } catch { return res.status(400).json({ error: "marker must be valid JSON" }); }
    if (markerObj && "rotation" in markerObj) delete markerObj.rotation;

    const team = await queryOne("SELECT * FROM teams WHERE id = ?", [targetTeamId]);
    if (!team) return res.status(400).json({ error: "Unknown team" });

    const approvers = await query(`
      SELECT u.* FROM users u JOIN signing_authority sa ON sa.user_id = u.id
      WHERE u.role = 'approver' AND sa.team_id = ?
    `, [targetTeamId]);
    if (approvers.length === 0) return res.status(400).json({ error: "No approvers configured for this team" });

    const orientation = parseOrientation(req.body?.orientation);
    let bakedBuffer, pageRotations;
    try {
      ({ bakedBuffer, pageRotations } = await bakeRequestFile({
        buffer: file.buffer, fileType, orientation
      }));
    } catch (e) {
      console.error("[create] bake failed", e);
      return res.status(400).json({ error: "Could not process PDF orientation" });
    }
    const bakedMarker = transformMarkerForBake(markerObj, pageRotations);

    const id = uid();
    const storedName = `${id}.${ext}`;
    await fs.mkdir(DOC_DIR, { recursive: true });
    await fs.writeFile(path.join(DOC_DIR, storedName), bakedBuffer);
```

Then in the `INSERT INTO requests` call immediately below, change `JSON.stringify(markerObj)` to `JSON.stringify(bakedMarker)`.

- [ ] **Step 4: Use the helpers in the workflow path**

In `createWorkflowRequest(...)`, after the validation block (just before `const id = uid();` around line 160), insert:

```javascript
  const orientation = parseOrientation(req.body?.orientation);
  let bakedBuffer, pageRotations;
  try {
    ({ bakedBuffer, pageRotations } = await bakeRequestFile({
      buffer: file.buffer, fileType, orientation
    }));
  } catch (e) {
    console.error("[create workflow] bake failed", e);
    return res.status(400).json({ error: "Could not process PDF orientation" });
  }
  for (const step of workflow) {
    for (const s of step.signers) {
      const baked = transformMarkerForBake(
        { x: s.x, y: s.y, w: s.w, h: s.h, page: s.page || 1 },
        pageRotations
      );
      s.x = baked.x; s.y = baked.y; s.w = baked.w; s.h = baked.h;
      delete s.rotation;
    }
  }
```

Then replace `await fs.writeFile(path.join(DOC_DIR, storedName), file.buffer);` (around line 163) with:

```javascript
  await fs.writeFile(path.join(DOC_DIR, storedName), bakedBuffer);
```

And in the loop that inserts `request_step_signers` (around line 184), change the rotation parameter from `Number(s.rotation || 0)` to `0` (legacy column stays in schema, written as zero, ignored on read):

```javascript
        await conn.execute(
          `INSERT INTO request_step_signers (id, step_id, signer_order, user_id, page, marker_x, marker_y, marker_w, marker_h, rotation, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [uid("sg"), stepId, j + 1, s.userId, s.page || 1, s.x, s.y, s.w, s.h, 0]
        );
```

- [ ] **Step 5: Manual smoke test (no client changes yet)**

Start the server and submit a request through the existing client (orientation will be absent at this point, which means `parseOrientation` returns `null` and the bake is a no-op):

```bash
cd D:\OneSign && npm run dev
```

In the browser at `http://localhost:5173`, log in as the requestor and submit any PDF request. Verify the request appears in the approver's queue and can be approved exactly as before.

Expected: no regressions; orientation parameter is silently ignored.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/requests.js
git commit -m "feat: bake orientation and transform markers on request create"
```

---

## Task 4: Simplify stampPdfMulti — remove rotation-aware code paths

**Files:**
- Modify: `server/src/pdf.js`

- [ ] **Step 1: Replace stampPdfMulti and its helpers**

Open `server/src/pdf.js`. The file currently has (in order): `stampPdf`, a comment block, `stampPdfMulti`, `drawStampedBlock`, `drawImageInBox`, `drawTextInBox`, `drawSeparatorAtSigCaptionBoundary`, `displayPointToMediabox`, `displayRectToMediabox`, `clampNum`, `formatSignedDate`, `writeXlsxSignatureManifest`, plus the `bakeOrientation` you added in Task 2.

Replace everything from the comment block above `stampPdfMulti` through the end of `displayRectToMediabox` (i.e., from line 24 to line 237 in the original file, ending just before `clampNum`) with the flat versions below. Keep `clampNum`, `formatSignedDate`, `writeXlsxSignatureManifest`, and `bakeOrientation` exactly as they are.

```javascript
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

// Draws the signature image (aspect-fit) above an optional caption ("Signed by …"
// + date) inside the marker box. All coordinates are MediaBox y-up; no rotation logic.
function drawStampedBlock({ page, sigImg, font, fontBold, boxX, boxY, boxW, boxH, signerName, signedAt }) {
  const hasCaptionData = !!(signerName || signedAt);
  const captionFrac = hasCaptionData && (boxH * 0.28) >= 10 ? 0.28 : 0;
  const sigFrac = 1 - captionFrac;
  const sigAreaH = sigFrac * boxH;
  const capAreaH = captionFrac * boxH;

  const sigRatio = sigImg.width / sigImg.height;
  const areaRatio = boxW / sigAreaH;
  let fitW, fitH;
  if (sigRatio > areaRatio) { fitW = boxW; fitH = boxW / sigRatio; }
  else { fitH = sigAreaH; fitW = sigAreaH * sigRatio; }

  // Signature area sits at the TOP of the box (display y = 0..sigAreaH); caption sits
  // BELOW it. In MediaBox y-up: top-of-box = boxY + boxH. The signature image's BL
  // is at boxY + boxH - sigAreaH + verticalSlack/2.
  const sigBLx = boxX + (boxW - fitW) / 2;
  const sigBLy = boxY + boxH - sigAreaH + (sigAreaH - fitH) / 2;
  page.drawImage(sigImg, { x: sigBLx, y: sigBLy, width: fitW, height: fitH });

  if (captionFrac > 0) {
    // Separator between sig and caption: in y-up at boxY + capAreaH
    page.drawLine({
      start: { x: boxX + 1, y: boxY + capAreaH },
      end:   { x: boxX + boxW - 1, y: boxY + capAreaH },
      thickness: 0.4,
      color: rgb(0.62, 0.62, 0.62)
    });

    const nameText = signerName ? `Signed by ${signerName}` : "";
    const dateText = signedAt ? formatSignedDate(signedAt) : "";
    const nameSize = clampNum(capAreaH * 0.42, 4, 9);
    const dateSize = clampNum(capAreaH * 0.34, 3, 7);
    const marginTop = Math.max(1.5, capAreaH * 0.08);
    const lineGap = Math.max(1, nameSize * 0.18);

    if (nameText) {
      const w = fontBold.widthOfTextAtSize(nameText, nameSize);
      const x = boxX + Math.max(2, (boxW - w) / 2);
      const y = boxY + capAreaH - marginTop - nameSize * 0.8;
      page.drawText(nameText, { x, y, size: nameSize, font: fontBold, color: rgb(0.15, 0.18, 0.27) });
    }
    if (dateText) {
      const w = font.widthOfTextAtSize(dateText, dateSize);
      const x = boxX + Math.max(2, (boxW - w) / 2);
      const y = boxY + capAreaH - marginTop - nameSize - lineGap - dateSize * 0.8;
      page.drawText(dateText, { x, y, size: dateSize, font, color: rgb(0.45, 0.45, 0.45) });
    }
  }
}
```

- [ ] **Step 2: Update stampPdf to stop forwarding rotation**

Replace the existing `stampPdf` function (lines 9–22 of the original file) with:

```javascript
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
```

- [ ] **Step 3: Run server tests**

```bash
cd D:\OneSign\server && node --test test/
```

Expected: PASS — both test files green. (No new tests were added for the simplified stamp because the existing bake-orientation tests exercise the full chain and the dev-time visual scenarios cover the rest.)

- [ ] **Step 4: Manual end-to-end smoke**

Restart the dev server. Submit a portrait PDF as the legacy single-marker requestor; approve it as the approver; download the signed PDF. The signature should appear upright at the marker position. (Orientation is still always portrait at this point because the client doesn't send it yet.)

- [ ] **Step 5: Commit**

```bash
git add server/src/pdf.js
git commit -m "refactor: strip rotation code from stampPdfMulti; stamp flat in MediaBox"
```

---

## Task 5: Portrait/Landscape toggle in PdfPagedViewer

**Files:**
- Modify: `client/src/App.jsx` (PdfPagedViewer + DocPreview)

The viewer becomes a **controlled** component: it receives `orientation` and `onOrientationChange` from the parent (`RequestEditor`). For non-editable mode (preview, approver drawer), no toggle is rendered. Per page, the viewer decides 0° or 90° display rotation based on the page's native orientation vs. the active orientation.

**Important invariant:** markers continue to be stored in **native MediaBox % coordinates** throughout the entire editing session — exactly as in the current code. The existing `viewportToMediabox` and `mediaboxToViewport` helpers (which already handle 0/90 correctly) are kept. When the applicant toggles orientation, no marker mutation is needed — the same MediaBox coords render at the right visual spot under the new per-page rotation.

- [ ] **Step 1: Replace PdfPagedViewer**

Replace the entire `PdfPagedViewer` component (from `function PdfPagedViewer({` around line 969 through its closing brace before `function PdfPage(...)` around line 1031) with:

```javascript
function PdfPagedViewer({ file, markers, editable, onAddMarker, onUpdateMarker, onDeleteMarker, onPages, orientation, onOrientationChange, onFirstPageOrientation }) {
  const [pdf, setPdf] = useState(null);
  const [err, setErr] = useState(null);
  const [pageDims, setPageDims] = useState([]); // [{ width, height }, ...]

  useEffect(() => {
    let cancelled = false;
    setPdf(null); setErr(null); setPageDims([]);
    (async () => {
      try {
        const loadingTask = pdfjsLib.getDocument({ url: file.base64 });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        setPdf(doc);
        onPages?.(doc.numPages);
        const dims = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1, rotation: 0 });
          dims.push({ width: vp.width, height: vp.height });
        }
        if (cancelled) return;
        setPageDims(dims);
        if (dims.length > 0) {
          const first = dims[0].width > dims[0].height ? "landscape" : "portrait";
          onFirstPageOrientation?.(first);
        }
      } catch (e) {
        if (!cancelled) setErr(e.message || String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [file.base64]);

  if (err) return <div className="card p-6 text-sm" style={{ color: "#9B2C2C" }}>Could not render PDF: {err}</div>;
  if (!pdf) return <div className="card p-10 text-sm opacity-50 text-center">Rendering PDF…</div>;

  // Fall back to portrait while page dims are still loading, so the JSX below never
  // gets undefined. Once dims arrive, RequestEditor will have called setOrientation
  // via onFirstPageOrientation and re-rendered us with the correct value.
  const activeOrientation = orientation || "portrait";
  const pages = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  const pageRotations = pageDims.map(d =>
    (d.width > d.height ? "landscape" : "portrait") === activeOrientation ? 0 : 90
  );

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "rgba(15,26,46,.08)", backgroundColor: "#FAF7F0" }}>
        <div className="text-xs opacity-60">{pdf.numPages} page{pdf.numPages === 1 ? "" : "s"} · {activeOrientation}</div>
        {editable && (
          <div className="flex gap-1">
            <button
              onClick={() => onOrientationChange?.("portrait")}
              className={`btn-ghost text-xs ${activeOrientation === "portrait" ? "ring-1" : ""}`}
              title="Display every page in portrait orientation. Pages whose native orientation differs will be rotated 90° clockwise when the request is submitted."
            >Portrait</button>
            <button
              onClick={() => onOrientationChange?.("landscape")}
              className={`btn-ghost text-xs ${activeOrientation === "landscape" ? "ring-1" : ""}`}
              title="Display every page in landscape orientation. Pages whose native orientation differs will be rotated 90° clockwise when the request is submitted."
            >Landscape</button>
          </div>
        )}
      </div>
      <div style={{ maxHeight: 720, overflowY: "auto", backgroundColor: "#E8E3D5" }}>
        {pages.map(p => (
          <PdfPage key={p} pdf={pdf} pageNum={p}
            rotation={pageRotations[p - 1] || 0}
            markers={markers.filter(m => (m.page || 1) === p)}
            editable={editable}
            onAddMarker={onAddMarker ? (x, y, w, h) => onAddMarker(p, x, y, w, h) : null}
            onUpdateMarker={onUpdateMarker}
            onDeleteMarker={onDeleteMarker} />
        ))}
      </div>
      {editable && <div className="text-xs opacity-60 px-4 py-2 border-t" style={{ borderColor: "rgba(15,26,46,.08)" }}>Pick Portrait or Landscape, then click-drag where the signature should go. The orientation is baked into the PDF on submit.</div>}
    </div>
  );
}
```

Notable changes vs. the current implementation:
- `initialRotation` prop **removed**.
- New props: `orientation`, `onOrientationChange`, `onFirstPageOrientation`.
- The Rotate button is gone; the Portrait/Landscape buttons appear only when `editable`.
- `pageRotations[p-1]` is computed per-page based on each page's native dims vs. the active orientation.
- The `onAddMarker` callback to `PdfPage` no longer passes the rotation as a 5th argument (the per-page rotation lives inside `PdfPage` via the `rotation` prop, and `PdfPage` already uses it correctly via the existing `viewportToMediabox` helper).

- [ ] **Step 2: Update DocPreview to forward the new props (and drop initialRotation)**

Replace `DocPreview` (around line 937) with:

```javascript
function DocPreview({ file, marker, markers, editable = false, onAddMarker, onUpdateMarker, onDeleteMarker, onPages, appliedSignature, orientation, onOrientationChange, onFirstPageOrientation }) {
  const list = markers || (marker ? [{ ...marker, page: marker.page || 1 }] : []);
  if (!file) return null;

  if (file.ext === "pdf") {
    return <PdfPagedViewer file={file} markers={list} editable={editable}
      onAddMarker={onAddMarker} onUpdateMarker={onUpdateMarker} onDeleteMarker={onDeleteMarker}
      onPages={onPages}
      orientation={orientation} onOrientationChange={onOrientationChange}
      onFirstPageOrientation={onFirstPageOrientation} />;
  }
  return <XlsxViewer file={file} markers={list} editable={editable} onAddMarker={onAddMarker} onPages={onPages} appliedSignature={appliedSignature} />;
}
```

- [ ] **Step 3: Verify the build compiles**

```bash
cd D:\OneSign && npm run build
```

Expected: build succeeds. (Functional verification comes in Task 7 once we wire orientation into RequestEditor.)

- [ ] **Step 4: Commit**

```bash
git add client/src/App.jsx
git commit -m "feat: Portrait/Landscape toggle replaces free-form Rotate button"
```

---

## Task 6: Drop the unused RotateCw icon import

**Files:**
- Modify: `client/src/App.jsx` (top-of-file lucide-react import)

- [ ] **Step 1: Confirm RotateCw is no longer referenced**

```bash
cd D:\OneSign\client && grep -n "RotateCw" src/App.jsx
```

Expected: at most one match — the import line itself. (Task 5 deleted the only usage.)

- [ ] **Step 2: Remove the import token**

Open `client/src/App.jsx`. Find the line that imports from `"lucide-react"` and delete `RotateCw` from the import list. For example, change:

```javascript
import { Upload, X, RotateCw, GitBranch, /* … */ } from "lucide-react";
```

to:

```javascript
import { Upload, X, GitBranch, /* … */ } from "lucide-react";
```

- [ ] **Step 3: Verify build**

```bash
cd D:\OneSign && npm run build
```

Expected: build succeeds, no "RotateCw is not defined" error.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.jsx
git commit -m "chore: drop unused RotateCw icon import"
```

---

## Task 7: Wire orientation into RequestEditor and send it on submit

**Files:**
- Modify: `client/src/api.js`
- Modify: `client/src/App.jsx` (RequestEditor: orientation state, DocPreview wiring, submit call, drop marker.rotation from onAddMarker)

- [ ] **Step 1: Update api.createRequest to accept orientation**

In `client/src/api.js`, find `createRequest` (around line 80) and replace it with:

```javascript
  createRequest({ file, targetTeamId, marker, workflow, instantApproval, note, requestType, orientation }) {
    const fd = new FormData();
    fd.append("file", file, file.name);
    if (workflow) fd.append("workflow", JSON.stringify(workflow));
    if (targetTeamId) fd.append("targetTeamId", targetTeamId);
    if (marker) fd.append("marker", JSON.stringify(marker));
    if (instantApproval) fd.append("instantApproval", "true");
    if (note) fd.append("note", note);
    if (requestType) fd.append("requestType", requestType);
    if (orientation) fd.append("orientation", orientation);
    return this.fetch("/api/requests", { method: "POST", body: fd });
  },
```

- [ ] **Step 2: Find addRequest in App.jsx and add orientation pass-through**

```bash
cd D:\OneSign\client && grep -n "addRequest\|api.createRequest" src/App.jsx
```

Locate the wrapper function `addRequest` (it lives in the App-level context provider). Wherever it destructures the call args and forwards them to `api.createRequest`, extend both lists with `orientation`. For example:

```javascript
const addRequest = async ({ file, targetTeamId, marker, workflow, instantApproval, note, requestType, orientation }) => {
  // ...
  return api.createRequest({ file, targetTeamId, marker, workflow, instantApproval, note, requestType, orientation });
};
```

(Exact surrounding code may differ — the change is: add `orientation` to both the args and the `api.createRequest` call.)

- [ ] **Step 3: Add orientation state in RequestEditor and drop marker.rotation from onAddMarker**

In `RequestEditor` (function starting around line 540), find the existing `useState` declarations (e.g., `const [marker, setMarker] = useState(null);`). Add:

```javascript
const [orientation, setOrientation] = useState(null); // populated by viewer onFirstPageOrientation
```

Then locate `onAddMarker` (around line 577–595) and replace it with the version below — the only change is that the 5th `rotation` parameter is removed and the marker objects no longer carry a `rotation` field:

```javascript
const onAddMarker = (page, x, y, w, h) => {
  if (mode === "single") {
    setMarker({ page, x, y, w, h });
    return;
  }
  if (!placingSlot) {
    notify("Pick a signer first, then click 'Place signature'", "info");
    return;
  }
  const { stepIdx, signerIdx } = placingSlot;
  setWorkflow(wf => {
    const next = wf.map((st, i) => i !== stepIdx ? st : {
      ...st,
      signers: st.signers.map((s, j) => j !== signerIdx ? s : { ...s, page, x, y, w, h })
    });
    return next;
  });
  setPlacingSlot(null);
};
```

- [ ] **Step 4: Wire the orientation props through DocPreview**

There are two `<DocPreview file={file} markers={allMarkers} editable …>` invocations inside `RequestEditor` (around lines 735 and 767). Update **both** to:

```jsx
<DocPreview file={file} markers={allMarkers} editable
  onAddMarker={onAddMarker} onUpdateMarker={onUpdateMarker} onDeleteMarker={onDeleteMarker}
  orientation={orientation}
  onOrientationChange={setOrientation}
  onFirstPageOrientation={setOrientation} />
```

- [ ] **Step 5: Pass orientation in the submit call**

In `submit` (around line 640), update both `addRequest` calls:

```javascript
const submit = async () => {
  setBusy(true);
  try {
    if (mode === "single") {
      if (!canSubmitSingle) { notify("Complete all steps first", "error"); return; }
      await addRequest({ file: file.blob, targetTeamId: targetTeam, marker, instantApproval, note, requestType, orientation });
    } else {
      if (!canSubmitWorkflow) { notify("Complete the workflow — every signer needs a placed signature", "error"); return; }
      await addRequest({ file: file.blob, workflow, instantApproval, note, requestType, orientation });
    }
    notify("Request submitted", "success");
    onDone();
  } catch (e) {
    notify(e.message || "Submit failed", "error");
  } finally { setBusy(false); }
};
```

- [ ] **Step 6: Manual visual test of the toggle**

Restart the dev server. As the requestor (`mufaddal.safdari@hqhb.in` / `Mufaddal@1995`):

1. Upload a portrait PDF — header should show "Portrait · landscape" toggle with Portrait selected.
2. Place a marker at, say, top-left of the page.
3. Click "Landscape" — the page rotates 90° CW. Marker stays visually pinned to the same physical page content. (This works automatically because the marker is stored in native MediaBox % and the existing `mediaboxToViewport` helper handles the per-page rotation.)
4. Click "Portrait" — page returns; marker is back where you placed it.
5. Click "Landscape" again and Submit.

Inspect the stored file:

```bash
ls -la D:\OneSign\server\uploads\documents
```

Open the most-recent file in a PDF viewer. Expected: it opens natively as landscape with no `/Rotate` metadata.

Check the DB for the stored marker (legacy single-marker case):

```bash
mysql -u root signflow -e "SELECT marker_json FROM requests ORDER BY created_at DESC LIMIT 1"
```

Expected: marker JSON has no `rotation` field.

- [ ] **Step 7: Commit**

```bash
git add client/src/api.js client/src/App.jsx
git commit -m "feat: send orientation on submit; drop marker.rotation on client"
```

---

## Task 8: Drop pickInitialRotation and the initialRotation prop chain

**Files:**
- Modify: `client/src/App.jsx` (preview drawer, approver drawer)

- [ ] **Step 1: Delete pickInitialRotation**

In `client/src/App.jsx` find the function around line 1579 (right after `WorkflowSummary`'s outer return):

```javascript
// Pick the rotation the requestor used when placing markers, so every viewer of this
// request (preview drawer, approve drawer, etc.) shows the document the same way.
function pickInitialRotation(req) { /* … */ }
```

Delete this function entirely (the function plus the preceding comment block — about 14 lines).

- [ ] **Step 2: Drop the prop from the two read-side call sites**

Find these two lines:

Around line 1550:
```javascript
const initialRotation = pickInitialRotation(req);
```
Delete this line.

Around line 1570:
```jsx
<DocPreview file={file} markers={markers} initialRotation={initialRotation} />
```
Replace with:
```jsx
<DocPreview file={file} markers={markers} />
```

Around line 1855:
```jsx
{file ? <DocPreview file={file} markers={markers} initialRotation={pickInitialRotation(req)} /> : <div className="text-sm opacity-50">Loading…</div>}
```
Replace with:
```jsx
{file ? <DocPreview file={file} markers={markers} /> : <div className="text-sm opacity-50">Loading…</div>}
```

- [ ] **Step 3: Verify build and reviewer-side visual**

```bash
cd D:\OneSign && npm run build
```

Expected: build succeeds.

Then `npm run dev` and log in as the approver (`moiz.barwani@hqhb.in` / `Moiz@9207`). Open a pending request. Verify:

- The Portrait/Landscape buttons are **not** visible (the approver's DocPreview doesn't set `editable`).
- The document renders at its baked-in orientation.
- The marker is at the right physical spot on the page.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.jsx
git commit -m "refactor: drop pickInitialRotation and initialRotation prop chain"
```

---

## Task 9: Final end-to-end verification

**Files:** none modified — verification only.

- [ ] **Step 1: Reset to a clean DB (optional but recommended)**

Stale rotation-bearing rows from before this change will display imperfectly. To start fresh:

```bash
mysql -u root -e "DROP DATABASE signflow"
cd D:\OneSign && npm run dev
```

The server recreates and reseeds on boot.

- [ ] **Step 2: Run the full server test suite**

```bash
cd D:\OneSign\server && node --test test/
```

Expected: every test green.

- [ ] **Step 3: Manual scenarios**

Log in as requestor (`mufaddal.safdari@hqhb.in` / `Mufaddal@1995`) and run each:

1. **Portrait PDF → Portrait submit (no bake):** upload a portrait PDF, leave toggle on Portrait, place marker, submit. Approve as `moiz.barwani@hqhb.in`. Download signed PDF. Signature upright at marker position. Pages remain portrait.

2. **Portrait PDF → Landscape submit (bake):** upload portrait PDF, click Landscape, place marker on the rotated view, submit. Approve. Download signed PDF. Every page now landscape with no /Rotate; signature upright at the marker on the landscape page.

3. **Landscape PDF → Portrait submit (bake):** upload a landscape PDF, click Portrait, place marker, submit. Approve. Download. Every page portrait; signature upright.

4. **Mixed-orientation PDF → Portrait submit:** if you have a doc with both orientations, upload it. After submit, every page is portrait; markers land at correct spots.

5. **Multi-step workflow:** create a multi-step request, place markers across steps, flip orientation mid-edit, verify markers stay visually pinned, submit, approve through both steps, download final.

6. **Reviewer flow has no toggle:** open any request as the approver. Confirm the Portrait/Landscape buttons are not visible.

- [ ] **Step 4: Mark completion**

```bash
git commit --allow-empty -m "test: orientation rollout verified end-to-end"
```

---

## Done

Checklist of what changed when this plan is complete:

- ✅ The applicant has a Portrait/Landscape toggle in the request creation viewer (replacing the free-form Rotate button).
- ✅ On submit, the chosen orientation is physically baked into the PDF (every page has `/Rotate = 0`, dimensions adjusted as needed).
- ✅ Marker coordinates are transformed on the server for pages that were rotated during bake.
- ✅ Markers continue to be stored in the native (now post-bake) MediaBox % coordinates — rotation-independent throughout.
- ✅ The reviewer/approver has no orientation UI, no rotate button, and no `pickInitialRotation` logic.
- ✅ `stampPdfMulti` has no rotation-aware code paths.
- ✅ `marker.rotation` is no longer set anywhere in new request payloads.
- ✅ The legacy `request_step_signers.rotation` column stays in the schema (idempotent) but is written as `0` and ignored on read.
