// ============================================================
//   SignFlow service worker — installability only, no caching.
//   ------------------------------------------------------------
//   This app is always online (live signature backend), and it
//   ships frequently, so we deliberately do NOT precache the app
//   shell — that would risk serving a stale build after a deploy.
//   The SW exists to make the app installable ("Add to Home
//   Screen") and to show a friendly page when the device is
//   offline. Everything else goes straight to the network.
// ============================================================

// Activate immediately on install/update so a new deploy takes over
// without the user having to close every tab.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const OFFLINE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline · HQHB SignFlow</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#F5F1E8;color:#0F1A2E;text-align:center}
.b{max-width:22rem;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{opacity:.7;line-height:1.5;margin:0}
</style></head><body><div class="b"><h1>You're offline</h1>
<p>HQHB SignFlow needs an internet connection. Reconnect and reopen the app.</p></div></body></html>`;

// Network-first for page navigations, with an offline fallback. We never cache
// app assets, so there is no stale-content risk after a deploy.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })
      )
    );
  }
  // All other requests (assets, API calls) fall through to the network untouched.
});
