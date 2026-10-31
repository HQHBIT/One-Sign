// ============================================================
//   FLOW LAYOUT — the board as a path, not a sideways-scrolling strip
//   ------------------------------------------------------------
//   Stages are laid out `perRow` to a row and read as one continuous path:
//   left to right along the first row, an arrow DOWN at its end, then back
//   right to left along the next (a "snake"), and so on. The down arrow
//   always lands on the next stage, so the order never needs explaining.
//
//   flowRows(count, perRow) → [{ reversed, slots, downAt }]
//     slots   perRow entries, left to right on screen: a stage index or null
//     downAt  the slot the ↓ to the next row sits under, or null on the last row
// ============================================================

export function flowRows(count, perRow) {
  const n = Math.max(1, perRow | 0);
  const rows = [];
  for (let start = 0, r = 0; start < count; start += n, r++) {
    const reversed = r % 2 === 1;
    const inRow = Math.min(n, count - start);
    const slots = Array(n).fill(null);
    // The k-th stage of the row sits at slot k going right, or at slot n-1-k
    // going left — so a short last row still starts where the arrow lands.
    for (let k = 0; k < inRow; k++) slots[reversed ? n - 1 - k : k] = start + k;
    const last = start + inRow >= count;
    rows.push({ reversed, slots, downAt: last ? null : (reversed ? 0 : n - 1) });
  }
  return rows;
}

// How many stages to a row at a given width: three on a desktop (owner,
// 2026-10-31), two on a tablet, one on a phone.
export const perRowFor = (width) => (width >= 1024 ? 3 : width >= 700 ? 2 : 1);
