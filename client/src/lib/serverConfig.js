// ============================================================
//   WHAT THIS DEPLOYMENT CAN DO
//   ------------------------------------------------------------
//   /auth/config reports the server's capabilities — whether confidential
//   documents are configured, whether this box records Manzoori, which
//   organisation it serves. Those are properties of the deployment, fixed for
//   the life of the page, so they are fetched ONCE and shared.
//
//   The alternative is what the code did before: each component that needed a
//   flag called the endpoint itself. That is one request per component, and a
//   row-level control would have made one request per row.
// ============================================================
import { useEffect, useState } from "react";
import { api } from "../api.js";

let inFlight = null;

/** The config, fetched at most once per page load. Never rejects — a capability
 *  that cannot be read is treated as absent, which fails closed. */
export function serverConfig() {
  if (!inFlight) inFlight = api.authConfig().catch(() => ({}));
  return inFlight;
}

/** The same, as a hook. Returns {} until it arrives, so a flag read from it is
 *  falsy while unknown rather than briefly true. */
export function useServerConfig() {
  const [cfg, setCfg] = useState(null);
  useEffect(() => {
    let alive = true;
    serverConfig().then((c) => { if (alive) setCfg(c || {}); });
    return () => { alive = false; };
  }, []);
  return cfg || {};
}
