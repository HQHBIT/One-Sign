// Silent self-update. When a newer client build has been deployed, reload once so
// the running app matches what's on the server (new logo, fixes, etc.) instead of
// serving a stale in-memory bundle — the classic "installed PWA left open across a
// deploy" problem.
//
// How it works: each build is stamped with a unique id, baked into the bundle
// (__BUILD_ID__) and written to /version.json in the deployed output (see
// vite.config.js). We fetch /version.json (never cached) and, if it names a
// different build than the one we're running, reload.

// Injected by Vite `define` at build time; guarded so it never throws in envs
// where the define isn't applied.
const BUILT = typeof __BUILD_ID__ !== "undefined" ? String(__BUILD_ID__) : "";
const GUARD_KEY = "sf_reloaded_build"; // reload-loop guard, per tab session

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { cache: "no-store", signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Reload if a newer build is live. Safe to call often — it's a tiny no-store
// fetch and a no-op when already current. Never runs in dev (no version.json,
// HMR handles freshness there).
export async function checkForUpdate() {
  if (!import.meta.env.PROD || !BUILT) return;
  try {
    const res = await fetchWithTimeout("/version.json", 3000);
    if (!res.ok) return;
    const data = await res.json();
    const latest = data && data.build ? String(data.build) : "";
    if (!latest || latest === BUILT) return;

    // A newer build exists. Guard against reload loops: if for any reason the
    // reload doesn't land us on `latest`, don't keep reloading for it this session.
    if (sessionStorage.getItem(GUARD_KEY) === latest) return;
    try { sessionStorage.setItem(GUARD_KEY, latest); } catch { /* private mode — ignore */ }

    // Nudge the service worker to pull the newest assets before we reload.
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) { try { await reg.update(); } catch { /* ignore */ } }
    }
    window.location.reload();
  } catch { /* offline, aborted, or non-JSON (SPA fallback) — ignore */ }
}
