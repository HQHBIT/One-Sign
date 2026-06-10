// ============================================================
//   Small formatting + id-generation helpers
// ============================================================

/** Short collision-resistant id, prefixed by `p`. */
export const uid = (p = "id") =>
  `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** Locale-aware "Mar 4, 2026, 3:45 PM"-style timestamp. */
export const fmt = (ts) =>
  new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Locale-aware "Mar 4"-style timestamp, used in dense lists. */
export const fmtShort = (ts) =>
  new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
