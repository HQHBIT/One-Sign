// ============================================================
//   WebAuthn / passkeys — biometric sign-in on a trusted device
//   ------------------------------------------------------------
//   The DEVICE performs the face/fingerprint check in its own secure
//   hardware (Face ID, Windows Hello) and signs a one-time challenge.
//   SignFlow only ever stores a PUBLIC KEY and verifies the signature —
//   it never sees, receives, or stores any biometric data.
//
//   This is an ADD-ON alongside oneAccess / password: a user enrols a
//   device once (register/*), then a "Sign in with biometric" button
//   authenticates them without a password (login/*, usernameless).
// ============================================================
import { Router } from "express";
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { query, queryOne, execute, hydrateUser } from "../db.js";
import { authRequired, signToken } from "../auth.js";

const router = Router();
const uid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const toB64 = (buf) => Buffer.from(buf).toString("base64");
const fromB64 = (s) => new Uint8Array(Buffer.from(s, "base64"));

// The relying-party id must be the origin's hostname. Deriving it from the
// request means the same code works on localhost AND on the live domain without
// any env config (a credential is bound to whichever host it was enrolled on).
function rpFromReq(req) {
  const origin = String(req.headers.origin || (req.headers.host ? `https://${req.headers.host}` : ""));
  let rpID = "localhost";
  try { rpID = new URL(origin).hostname; } catch { /* keep default */ }
  return { rpID, origin };
}

function deviceLabel(req) {
  const ua = String(req.headers["user-agent"] || "");
  if (/iPhone|iPad|iPod/i.test(ua)) return "iPhone / iPad";
  if (/Macintosh|Mac OS/i.test(ua)) return "Mac";
  if (/Android/i.test(ua)) return "Android device";
  if (/Windows/i.test(ua)) return "Windows device";
  return "This device";
}

// Single-use challenge store (challenges live between the options + verify
// round-trips). Login is pre-auth so it can't use a session — the client gets a
// challengeId back and returns it; the row is deleted the moment it's consumed.
async function saveChallenge(purpose, userId, challenge) {
  const id = uid("wac");
  await execute(
    "INSERT INTO webauthn_challenges (id, purpose, user_id, challenge, expires_at) VALUES (?, ?, ?, ?, ?)",
    [id, purpose, userId || null, challenge, Date.now() + 5 * 60 * 1000]
  );
  return id;
}
async function takeChallenge(id, purpose) {
  if (!id) return null;
  const row = await queryOne("SELECT * FROM webauthn_challenges WHERE id = ? AND purpose = ?", [id, purpose]);
  if (row) await execute("DELETE FROM webauthn_challenges WHERE id = ?", [id]);
  if (!row || Date.now() > Number(row.expires_at)) return null;
  return row;
}

// ---------- enrol this device (authenticated) ----------
router.post("/register/options", authRequired, async (req, res, next) => {
  try {
    const { rpID } = rpFromReq(req);
    const existing = await query("SELECT cred_id, transports FROM webauthn_credentials WHERE user_id = ?", [req.user.id]);
    const options = await generateRegistrationOptions({
      rpName: "HQHB SignFlow",
      rpID,
      userName: req.user.email,
      userID: new TextEncoder().encode(req.user.id),
      userDisplayName: req.user.name || req.user.email,
      attestationType: "none",
      excludeCredentials: existing.map(c => ({ id: c.cred_id, transports: c.transports ? c.transports.split(",") : undefined })),
      // Use the DEVICE'S built-in authenticator (Windows Hello face/fingerprint,
      // Touch ID, Face ID) directly — not the "use another device / security key"
      // chooser. residentKey:required makes it discoverable for usernameless login.
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "required",
        userVerification: "preferred",
      },
    });
    const challengeId = await saveChallenge("reg", req.user.id, options.challenge);
    res.json({ options, challengeId });
  } catch (e) { next(e); }
});

router.post("/register/verify", authRequired, async (req, res, next) => {
  try {
    const { rpID, origin } = rpFromReq(req);
    const { response, challengeId } = req.body || {};
    const ch = await takeChallenge(challengeId, "reg");
    if (!ch || ch.user_id !== req.user.id) return res.status(400).json({ error: "Your enrolment window expired. Please try again." });
    const verification = await verifyRegistrationResponse({
      response, expectedChallenge: ch.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
    });
    if (!verification.verified || !verification.registrationInfo) return res.status(400).json({ error: "Could not verify this device." });
    const { credential } = verification.registrationInfo; // { id, publicKey, counter, transports }
    await execute(
      "INSERT INTO webauthn_credentials (id, user_id, cred_id, public_key, counter, transports, device_label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [uid("wcr"), req.user.id, credential.id, toB64(credential.publicKey), Number(credential.counter || 0), (credential.transports || []).join(","), deviceLabel(req), Date.now()]
    );
    res.json({ ok: true, label: deviceLabel(req) });
  } catch (e) { next(e); }
});

// ---------- sign in with biometric (public) ----------
// Two modes:
//  - no email  → usernameless: the device offers whatever discoverable passkey
//    it holds for this site (works on an enrolled device).
//  - email     → that account's registered credentials are offered, which also
//    enables ecosystem-synced passkeys and the cross-device (QR-to-phone)
//    hand-off — so one enrolled phone can sign the user in on any device.
router.post("/login/options", async (req, res, next) => {
  try {
    const { rpID } = rpFromReq(req);
    const email = String(req.body?.email || "").trim().toLowerCase();
    let allow = [];
    let userId = null;
    if (email) {
      const u = await queryOne(
        "SELECT id, active FROM users WHERE LOWER(email) = ? OR LOWER(secondary_email) = ?", [email, email]);
      if (u && (u.active == null || Number(u.active) === 1)) {
        const creds = await query("SELECT cred_id, transports FROM webauthn_credentials WHERE user_id = ?", [u.id]);
        if (creds.length) {
          userId = u.id;
          // "hybrid" is appended as a transport hint so a device that doesn't
          // hold the passkey itself can offer the QR → phone hand-off.
          allow = creds.map(c => ({
            id: c.cred_id,
            transports: c.transports ? [...new Set([...c.transports.split(","), "hybrid"])] : undefined,
          }));
        }
      }
      // Identical response for unknown email and no-passkey account — reveals
      // nothing about whether the email has an account (anti-enumeration).
      if (!allow.length) {
        return res.status(404).json({
          error: "No biometric sign-in is set up for this email yet. Sign in with oneAccess, then enable it from your profile menu.",
          code: "no_biometric",
        });
      }
    }
    const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred", allowCredentials: allow });
    const challengeId = await saveChallenge("auth", userId, options.challenge);
    res.json({ options, challengeId });
  } catch (e) { next(e); }
});

router.post("/login/verify", async (req, res, next) => {
  try {
    const { rpID, origin } = rpFromReq(req);
    const { response, challengeId } = req.body || {};
    const ch = await takeChallenge(challengeId, "auth");
    if (!ch) return res.status(400).json({ error: "Sign-in window expired. Please try again." });
    const cred = await queryOne("SELECT * FROM webauthn_credentials WHERE cred_id = ?", [response?.id]);
    if (!cred) return res.status(401).json({ error: "Please register on oneAccess to sign in!", code: "not_registered" });
    // Email-first flow pinned the challenge to an account — the presented
    // credential must belong to that same account.
    if (ch.user_id && ch.user_id !== cred.user_id) {
      return res.status(401).json({ error: "This passkey doesn't belong to that email address." });
    }
    const user = await queryOne("SELECT * FROM users WHERE id = ?", [cred.user_id]);
    if (!user || (user.active != null && Number(user.active) === 0)) return res.status(401).json({ error: "That account isn't available." });
    const verification = await verifyAuthenticationResponse({
      response, expectedChallenge: ch.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
      credential: {
        id: cred.cred_id, publicKey: fromB64(cred.public_key), counter: Number(cred.counter),
        transports: cred.transports ? cred.transports.split(",") : undefined,
      },
    });
    if (!verification.verified) return res.status(401).json({ error: "Biometric check failed." });
    await execute("UPDATE webauthn_credentials SET counter = ? WHERE id = ?", [Number(verification.authenticationInfo.newCounter || 0), cred.id]);
    res.json({ token: signToken(user.id), user: await hydrateUser(user) });
  } catch (e) { next(e); }
});

// ---------- manage my enrolled devices ----------
router.get("/credentials", authRequired, async (req, res, next) => {
  try {
    const rows = await query("SELECT id, device_label, created_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC", [req.user.id]);
    res.json({ credentials: rows.map(r => ({ id: r.id, label: r.device_label || "Device", createdAt: Number(r.created_at) })) });
  } catch (e) { next(e); }
});
router.delete("/credentials/:id", authRequired, async (req, res, next) => {
  try {
    await execute("DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
