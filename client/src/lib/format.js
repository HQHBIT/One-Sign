// ============================================================
//   Small formatting + id-generation helpers
// ============================================================

/** Short collision-resistant id, prefixed by `p`. */
export const uid = (p = "id") =>
  `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// SignFlow is India-only, so all timestamps are shown in IST (Asia/Kolkata)
// explicitly — this keeps them correct regardless of the viewer's device clock.

/** IST "Mar 4, 2026, 3:45 PM"-style timestamp (date + hour:minute, no seconds). */
export const fmt = (ts) =>
  new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

/** IST "Mar 4"-style date, used in dense lists. */
export const fmtShort = (ts) =>
  new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "Asia/Kolkata" });
