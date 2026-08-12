// ============================================================
//   In-memory rate limiter — no external dependency.
//   ------------------------------------------------------------
//   Sliding-window counter keyed by IP (+ an optional discriminator such as the
//   attempted email). Enough to stop credential-stuffing and registration
//   farming on a single-instance deployment. A restart clears the window, which
//   is acceptable for an abuse control (not a security boundary on its own).
//
//   Trust note: req.ip reflects X-Forwarded-For only when the app trusts the
//   proxy. index.js sets `trust proxy` to the single front (nginx/Cloudflare),
//   so a client cannot rotate the key by spoofing that header.
// ============================================================
const buckets = new Map(); // key -> { count, resetAt }

// Sweep expired buckets occasionally so the map can't grow without bound.
let lastSweep = 0;
function sweep(now) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

/**
 * Express middleware factory.
 *   windowMs — the sliding window
 *   max      — attempts allowed per key per window
 *   keyBy    — (req) => string extra discriminator (default: none)
 *   message  — 429 body
 */
export function rateLimit({ windowMs, max, keyBy = null, message = "Too many attempts. Please try again shortly." }) {
  return (req, res, next) => {
    const now = Date.now();
    sweep(now);
    const ip = (req.ip || req.socket?.remoteAddress || "unknown").toString();
    const extra = keyBy ? String(keyBy(req) || "") : "";
    const key = `${req.baseUrl}${req.path}|${ip}|${extra}`;

    let b = buckets.get(key);
    if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + windowMs }; buckets.set(key, b); }
    b.count += 1;

    const remaining = Math.max(0, max - b.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));

    if (b.count > max) {
      const retry = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retry));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// Lower-cases and trims a would-be email from the body so bad and good casings
// of the same address share one bucket. Non-strings collapse to "" — which is
// itself a heavily-limited key, so type-confusion probing is also throttled.
export const byEmail = (req) => {
  const e = req?.body?.email;
  return typeof e === "string" ? e.trim().toLowerCase().slice(0, 120) : "nonstring";
};
