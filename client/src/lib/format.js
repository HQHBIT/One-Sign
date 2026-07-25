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

/**
 * Greeting-friendly short name: everything up to and INCLUDING the first
 * honorific (Bhai / Ben / Bs), since community names carry it as part of how a
 * person is addressed — "Mulla Mohammed Bhai Dohadwala" → "Mulla Mohammed Bhai",
 * "Huzaifa Bs Xyz" → "Huzaifa Bs". Falls back to the first word when no
 * honorific is present.
 */
export const greetName = (name) => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "there";
  const idx = parts.findIndex(p => /^(bhai|ben|bs)[.,]?$/i.test(p));
  return idx >= 0 ? parts.slice(0, idx + 1).join(" ") : parts[0];
};
