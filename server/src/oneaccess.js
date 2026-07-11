// ============================================================
//   oneAccess SSO integration (redirect flow)
//   ------------------------------------------------------------
//   SignFlow delegates authentication to oneAccess. The browser is
//   bounced to the oneAccess login page; on success oneAccess sends
//   the user back to SignFlow with a short-lived RS256 access token.
//   We verify that token LOCALLY against oneAccess's public key
//   (fetched once and cached), then mirror the user into our own
//   users table and issue a normal SignFlow session.
//
//   Every value comes from the environment — nothing is hardcoded.
//   See server/.env.example for the full list.
// ============================================================
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const trimSlash = (s) => (s || "").replace(/\/+$/, "");

export const oneAccess = {
  apiBase: trimSlash(process.env.ONEACCESS_API_BASE_URL),     // .../api
  frontendUrl: trimSlash(process.env.ONEACCESS_FRONTEND_URL), // login/registration site
  appSlug: process.env.ONEACCESS_APP_SLUG || "",              // redirect=<slug>
  appId: process.env.ONEACCESS_APP_ID || "",
  redirectUrl: process.env.ONEACCESS_REDIRECT_URL || "",      // our registered base_url (SSO landing)
  clientId: process.env.ONEACCESS_CLIENT_ID || "",            // M2M — backend only
  clientSecret: process.env.ONEACCESS_CLIENT_SECRET || "",    // M2M — backend only
  publicKeyPath: process.env.ONEACCESS_PUBLIC_KEY_PATH || "./keys/oneaccess-public.pem",
  accessTokenTtl: process.env.ONEACCESS_ACCESS_TOKEN_TTL || "15m",
};

// oneAccess login is only offered when the essential config is present, so an
// un-configured deploy simply keeps the local login (nothing breaks).
export function oneAccessEnabled() {
  return !!(oneAccess.apiBase && oneAccess.frontendUrl && oneAccess.appSlug);
}

// Local password login stays ON by default. Set AUTH_LOCAL_LOGIN_ENABLED=false to
// complete the cutover to oneAccess-only — do this ONLY after verifying SSO works,
// otherwise no one can sign in.
export function localLoginEnabled() {
  const v = process.env.AUTH_LOCAL_LOGIN_ENABLED;
  return v === undefined || String(v).toLowerCase() !== "false";
}

// The oneAccess URL the browser is redirected to for login. redirect=<slug> tells
// oneAccess which registered app to bounce the user back to afterwards.
export function loginRedirectUrl() {
  const u = new URL(oneAccess.frontendUrl + "/login");
  if (oneAccess.appSlug) u.searchParams.set("redirect", oneAccess.appSlug);
  return u.toString();
}

// RS256 public key for verifying access tokens. Loaded from disk if present
// (provision the PEM at ONEACCESS_PUBLIC_KEY_PATH for air-gapped setups), else
// fetched once from GET /api/public-key and cached in memory + on disk. We never
// verify over the network per request.
let _publicKey = null;
export async function getPublicKey() {
  if (_publicKey) return _publicKey;
  try {
    const p = path.resolve(oneAccess.publicKeyPath);
    if (fs.existsSync(p)) {
      const pem = fs.readFileSync(p, "utf8").trim();
      if (pem.includes("BEGIN")) { _publicKey = pem; return _publicKey; }
    }
  } catch { /* fall through to fetch */ }
  if (!oneAccess.apiBase) throw new Error("ONEACCESS_API_BASE_URL not set");
  const res = await fetch(oneAccess.apiBase + "/public-key");
  if (!res.ok) throw new Error("oneAccess public-key fetch failed: " + res.status);
  const pem = (await res.text()).trim();
  if (!pem.includes("BEGIN")) throw new Error("oneAccess public-key response was not a PEM");
  _publicKey = pem;
  try {
    const p = path.resolve(oneAccess.publicKeyPath);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, pem);
  } catch { /* cache write is best-effort */ }
  return _publicKey;
}

// For tests / key rotation.
export function _setPublicKeyForTest(pem) { _publicKey = pem; }

// Verify an oneAccess access token locally (RS256). Returns the claims or throws.
export async function verifyOneAccessToken(token) {
  const key = await getPublicKey();
  return jwt.verify(token, key, { algorithms: ["RS256"] });
}

// Authoritative profile for the token holder. Best-effort: if it can't be reached
// we fall back to the verified token claims.
export async function fetchOneAccessProfile(token) {
  const res = await fetch(oneAccess.apiBase + "/profile", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("oneAccess profile fetch failed: " + res.status);
  return res.json();
}

// Normalise a verified token + optional profile into the fields we store.
export function toLocalIdentity(claims, profile) {
  const its = String(profile?.its_id ?? claims?.its_id ?? "").trim();
  const email = String(profile?.email ?? claims?.email ?? "").trim().toLowerCase();
  const name = String(profile?.fullname ?? claims?.fullname ?? claims?.name ?? email ?? "oneAccess user").trim();
  return { its, email, name };
}

export { crypto as _crypto };
