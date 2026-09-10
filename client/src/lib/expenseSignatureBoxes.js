// ============================================================
//   FINDING THE SIGNATURE BOXES ON AN UPLOADED EXPENSE PDF
//   ------------------------------------------------------------
//   When someone attaches a printed expense form rather than filling ours, the
//   signature boxes are already drawn on it — Finance's own table, with a Sign
//   column and a row per signatory. Asking the requestor to drag rectangles over
//   boxes that already exist is busywork, and they will not land on the lines.
//
//   So the boxes are read off the page instead. The anchors are the words the
//   form prints: "Requestor", "Reviewer", "Approver 1", "Approver 2" down the
//   left of the block, and "Name & Designation", "Sign", "Date" across its head.
//
//   GEOMETRY FROM ANCHORS, NOT FROM DRAWN LINES. A PDF's table rules are vector
//   operators, and reading them means walking the operator list and guessing
//   which strokes belong to which table. The text tells us the same thing more
//   reliably: column edges sit midway between adjacent header centres, and a
//   row's height is the distance to the next signatory. Both fall out of
//   positions the text layer gives us directly, and both degrade sensibly when
//   the form is scaled, because everything is relative.
//
//   Coordinates in and out are PERCENTAGES OF THE PAGE with y measured from the
//   top, which is the marker convention the rest of the app uses.
// ============================================================

const ROLE_PATTERNS = [
  { role: "requestor", label: "Requestor", re: /^requestor$/i },
  { role: "reviewer",  label: "Reviewer",  re: /^reviewer$/i },
  { role: "approver1", label: "Approver 1", re: /^approver\s*1$/i },
  { role: "approver2", label: "Approver 2", re: /^approver\s*2$/i },
];

const HEAD_NAME = /^name\s*&?\s*designation$/i;
const HEAD_SIGN = /^sign$/i;
const HEAD_DATE = /^date$/i;

const centreX = (it) => it.x + it.w / 2;
const centreY = (it) => it.y + it.h / 2;

// The form's own column widths, in Excel's units, straight from the template.
// Only their PROPORTIONS matter here, which is what makes them usable against a
// page printed at any scale or margin.
const COL_W = [30.73, 25.18, 15.36, 20.18];   // A .. D
const COL_TOTAL = COL_W.reduce((a, b) => a + b, 0);
const edgeRatio = (i) => COL_W.slice(0, i).reduce((a, b) => a + b, 0) / COL_TOTAL;
const centreRatio = (i) => edgeRatio(i) + COL_W[i] / COL_TOTAL / 2;

/**
 * Work out the Sign column's left and right edges from the header row.
 *
 * Two ways, and the better one is tried first.
 *
 * FITTED. Headers are centred in their cells, so two of them pin the table down:
 * knowing where the "Name & Designation" and "Sign" centres landed gives the
 * table's left edge and its scale, and every other edge follows exactly. The
 * midpoint between two header centres is NOT the rule between them unless the
 * two columns are the same width — and here they are 25.18 and 15.36 — which is
 * what made the naive version sit a few millimetres left of the printed box.
 *
 * The fit is then CHECKED against a header it did not use, the Date column. If
 * the prediction lands where Date actually is, the page really is this form at
 * some scale and the exact edges can be trusted. If it does not, the attachment
 * is some other layout and the fit would be confidently wrong, so it is thrown
 * away in favour of the rough midpoint — which is imprecise but never absurd.
 */
function signColumn(heads) {
  const { name, sign, date } = heads;
  if (!sign) return null;

  if (name && date) {
    const span = centreRatio(2) - centreRatio(1);
    const scale = (centreX(sign) - centreX(name)) / span;
    const left0 = centreX(name) - scale * centreRatio(1);
    const predictedDate = left0 + scale * centreRatio(3);
    // Within about a millimetre and a half of A4. Wider than any rounding in the
    // text layer, tighter than the difference between this form and another.
    if (scale > 0 && Math.abs(predictedDate - centreX(date)) < 1.5) {
      return { left: left0 + scale * edgeRatio(2), right: left0 + scale * edgeRatio(3), fitted: true };
    }
  }

  const left = name ? (centreX(name) + centreX(sign)) / 2 : sign.x - sign.w;
  const right = date ? (centreX(sign) + centreX(date)) / 2 : sign.x + sign.w * 2;
  if (!(right > left)) return null;
  return { left, right, fitted: false };
}

/**
 * Suggested signature boxes for one page.
 *
 * @param {Array<{text:string,x:number,y:number,w:number,h:number}>} items
 *        Text with positions, in page percentages, y from the top.
 * @param {number} page 1-based page number, carried onto each box.
 * @returns {Array<{role,label,page,x,y,w,h}>}
 */
export function boxesFromTextItems(items = [], page = 1) {
  const clean = items
    .filter((it) => it && typeof it.text === "string" && it.text.trim())
    .map((it) => ({ ...it, text: it.text.trim() }));

  const heads = {
    name: clean.find((it) => HEAD_NAME.test(it.text)),
    sign: clean.find((it) => HEAD_SIGN.test(it.text)),
    date: clean.find((it) => HEAD_DATE.test(it.text)),
  };
  const col = signColumn(heads);
  if (!col) return [];

  // Only rows BELOW the header, so a stray "Requestor" elsewhere on the page —
  // the form uses the word twice — cannot be mistaken for the signature block.
  const headY = centreY(heads.sign);
  const anchors = [];
  for (const { role, label, re } of ROLE_PATTERNS) {
    const hit = clean
      .filter((it) => re.test(it.text) && centreY(it) > headY)
      .sort((a, b) => a.y - b.y)[0];
    if (hit) anchors.push({ role, label, item: hit });
  }
  if (!anchors.length) return [];

  anchors.sort((a, b) => a.item.y - b.item.y);

  // A row's height is the distance to the next signatory. The last row has no
  // next, so it reuses the previous gap — on this form every signatory block is
  // the same two rows tall, so that is exact rather than a guess.
  const gaps = [];
  for (let i = 1; i < anchors.length; i++) {
    gaps.push(anchors[i].item.y - anchors[i - 1].item.y);
  }
  const typical = gaps.length
    ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
    : anchors[0].item.h * 2;

  return anchors.map((a, i) => {
    const top = a.item.y;
    const height = i < anchors.length - 1 ? anchors[i + 1].item.y - top : typical;
    // Inset slightly so the stamp sits inside the printed rule rather than on
    // top of it. Proportional, so it survives a scaled page.
    const padY = Math.min(height * 0.12, 1);
    const padX = Math.min((col.right - col.left) * 0.06, 1);
    return {
      role: a.role,
      label: a.label,
      page,
      x: +(col.left + padX).toFixed(3),
      y: +(top + padY).toFixed(3),
      w: +((col.right - col.left) - padX * 2).toFixed(3),
      h: +(height - padY * 2).toFixed(3),
    };
  });
}

/**
 * Convert one pdf.js text layer into the percentage form above.
 *
 * pdf.js reports text in PDF user space, whose origin is the BOTTOM-left, and
 * carries each item's position in a transform matrix. Markers are measured from
 * the top, so y is flipped here — getting this backwards puts every box on the
 * wrong half of the page, which looks like a detection failure rather than a
 * coordinate one.
 */
export function itemsFromTextContent(textContent, viewport) {
  const W = viewport?.width || 1;
  const H = viewport?.height || 1;
  return (textContent?.items || [])
    .filter((it) => it && typeof it.str === "string")
    .map((it) => {
      const t = it.transform || [1, 0, 0, 1, 0, 0];
      const w = it.width || 0;
      const h = it.height || Math.abs(t[3]) || 0;
      const xPdf = t[4];
      const yPdf = t[5];
      return {
        text: it.str,
        x: (xPdf / W) * 100,
        // t[5] is the text baseline; the glyph box extends upward from it.
        y: ((H - yPdf - h) / H) * 100,
        w: (w / W) * 100,
        h: (h / H) * 100,
      };
    });
}

/**
 * Scan a loaded pdf.js document and return every signature box it can find.
 *
 * Stops at the first page that yields a full-looking block, because the form's
 * second page repeats the item table but not the signatures — and a box
 * suggested on the wrong page is worse than none.
 */
export async function detectExpenseSignatureBoxes(pdf, { maxPages = 4 } = {}) {
  const found = [];
  const pages = Math.min(pdf?.numPages || 0, maxPages);
  for (let n = 1; n <= pages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const boxes = boxesFromTextItems(itemsFromTextContent(await page.getTextContent(), viewport), n);
    if (boxes.length) {
      found.push(...boxes);
      break;
    }
  }
  return found;
}
