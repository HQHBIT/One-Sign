// ============================================================
//   Confidential documents — the crypto boundary
//   ------------------------------------------------------------
//   The ONLY module that knows how a confidential file is protected. Everything
//   else calls encryptBuffer/readMaybe and stays ignorant of the details.
//
//   AES-256-GCM with a key held in the CONFIDENTIAL_KEY environment variable —
//   never in the database, never in git. A database dump, a stolen backup or a
//   snapshot of the disk therefore yields nothing readable.
//
//   What this does NOT defend against: anyone with a shell on the server can
//   read the key out of the environment. Removing the server from the trust
//   boundary needs client-side encryption — see the Phase 2 spec.
// ============================================================
import crypto from "node:crypto";
import fs from "fs/promises";

const MAGIC = 0xc1;      // marks our envelope; plaintext files never start with this
const VERSION = 0x01;
const KEY_ID = 0x01;     // reserved so a future key rotation can identify the wrapping key
const IV_LEN = 12;       // 96-bit nonce, the GCM standard
const TAG_LEN = 16;
const HEADER_LEN = 3 + IV_LEN;

// The AES key is DERIVED from CONFIDENTIAL_KEY rather than being it verbatim.
// Demanding an exact 32-byte base64 blob made deployment fragile: a BOM, a
// trailing newline or a shell's encoding silently produced the wrong bytes and
// the feature just stayed off. scrypt accepts any sufficiently long secret and
// always yields exactly 32 bytes, with no entropy lost for a random input.
//
// Fixed salt: there is one key per deployment, so a salt adds nothing here —
// its usual job (stopping one rainbow table covering many users) doesn't apply.
const KDF_SALT = Buffer.from("signflow.confidential.v1");
const MIN_SECRET_CHARS = 24;

let warnedLegacy = false;
let cachedKey = null;
let cachedRaw = null;

/** Normalise away the things that broke this before: BOM, quotes, whitespace. */
function rawSecret() {
  return (process.env.CONFIDENTIAL_KEY || "")
    .replace(/^﻿/, "")     // UTF-8 BOM, courtesy of PowerShell redirection
    .replace(/^['"]|['"]$/g, "") // stray quotes from a shell that kept them
    .trim();
}

/** The derived 32-byte key, or null when the secret is unset or too short. */
function key() {
  const raw = rawSecret();
  if (!raw) { cachedRaw = null; cachedKey = null; return null; }
  if (raw.length < MIN_SECRET_CHARS) {
    console.warn(`[confidential] CONFIDENTIAL_KEY is only ${raw.length} characters; at least ${MIN_SECRET_CHARS} random characters are required — feature disabled`);
    cachedRaw = raw; cachedKey = null;
    return null;
  }
  if (raw === cachedRaw && cachedKey) return cachedKey;
  // Derived once and cached — scrypt is deliberately slow.
  cachedKey = crypto.scryptSync(raw, KDF_SALT, 32, { N: 16384, r: 8, p: 1 });
  cachedRaw = raw;
  return cachedKey;
}


// THE KEY THIS FEATURE ORIGINALLY USED.
//
// Before the derivation above existed, CONFIDENTIAL_KEY was required to be a
// 32-byte base64 blob and those bytes WERE the key. Switching to scrypt changed
// the key without changing the secret, and because both schemes write a byte-
// identical envelope — same magic, same version, same key id — every document
// sealed beforehand still looks perfectly valid and fails only at its
// authentication tag. That is not a corrupt file and not a lost secret: it is
// the same secret, run through a different function.
//
// So the old key is still derivable, and is tried as a fallback. Nothing is
// weakened by this: a legacy document must still pass its own GCM tag to be
// accepted, so this authenticates rather than assumes. New documents are always
// sealed with the current key — encryptBuffer never uses this.
function legacyKey() {
  const raw = rawSecret();
  if (!raw) return null;
  let buf;
  try { buf = Buffer.from(raw, "base64"); } catch { return null; }
  return buf.length === 32 ? buf : null;
}
/**
 * Is the feature usable? When false the Confidential toggle is hidden and the
 * API refuses to create confidential requests — it must NEVER silently fall
 * back to storing a "confidential" document as plaintext.
 */
export function isEnabled() {
  return key() !== null;
}

/**
 * Why the feature is off, for diagnostics. A fail-closed feature is invisible
 * when misconfigured, so "it isn't working" needs an answer that doesn't
 * require reading server logs. Reports the DECODED LENGTH only — never the key,
 * never any part of it.
 */
export function keyStatus() {
  const raw = rawSecret();
  if (!raw) return "not_set";
  if (raw.length < MIN_SECRET_CHARS) return `too_short_${raw.length}_need_${MIN_SECRET_CHARS}`;
  return "ok";
}

/** Does this buffer carry our envelope? */
export function looksEncrypted(buf) {
  return Buffer.isBuffer(buf) && buf.length > HEADER_LEN + TAG_LEN && buf[0] === MAGIC;
}

/**
 * Wrap a plaintext buffer.
 * Layout: [magic][version][keyId][iv 12][ciphertext …][tag 16]
 * Self-describing on purpose — no companion metadata column to drift out of sync.
 */
export function encryptBuffer(plain) {
  const k = key();
  if (!k) throw new Error("Confidential storage is not configured on this server");
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]);
  return Buffer.concat([Buffer.from([MAGIC, VERSION, KEY_ID]), iv, body, cipher.getAuthTag()]);
}

/**
 * Unwrap. The GCM tag is verified, so a tampered or truncated file throws
 * rather than decrypting into garbage.
 */
export function decryptBuffer(stored) {
  const k = key();
  if (!k) throw new Error("Confidential storage is not configured on this server");
  const buf = Buffer.from(stored);
  if (!looksEncrypted(buf)) throw new Error("Not a confidential envelope");
  if (buf[1] !== VERSION) throw new Error(`Unsupported envelope version ${buf[1]}`);
  if (buf[2] !== KEY_ID) throw new Error(`Document was sealed with key ${buf[2]}, which this server does not hold`);
  const iv = buf.subarray(3, 3 + IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const body = buf.subarray(HEADER_LEN, buf.length - TAG_LEN);
  const open = (withKey) => {
    const d = crypto.createDecipheriv("aes-256-gcm", withKey, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]);
  };
  try {
    return open(k);
  } catch (e) {
    // Only a tag failure is worth a second attempt, and only when a legacy key
    // actually exists. Anything else is a real error and is left alone.
    const legacy = legacyKey();
    if (!legacy || Buffer.compare(legacy, k) === 0) throw e;
    try {
      const out = open(legacy);
      if (!warnedLegacy) {
        warnedLegacy = true;
        console.warn("[confidential] opening documents sealed before the key derivation changed; they are readable but still on the old key");
      }
      return out;
    } catch { throw e; }   // report the CURRENT key's failure, not the fallback's
  }
}

/**
 * Read a stored document, decrypting only if it is actually encrypted.
 * Documents predating this feature are plaintext and pass straight through, so
 * no migration is needed.
 */
export async function readMaybe(fullPath) {
  const buf = await fs.readFile(fullPath);
  return looksEncrypted(buf) ? decryptBuffer(buf) : buf;
}

/** Encrypt when the request is confidential, otherwise store as-is. */
export function sealIfConfidential(buf, confidential) {
  return confidential ? encryptBuffer(buf) : Buffer.from(buf);
}

/** Stored filename for a document — confidential ones carry a .enc suffix. */
export function storedNameFor(base, confidential) {
  return confidential ? `${base}.enc` : base;
}

/** A cryptographically-random 6-digit unlock code, as a string. */
export function newUnlockCode() {
  return String(crypto.randomInt(100000, 1000000));
}

/** t••••@hqhb.in — enough for the user to recognise, useless for enumeration. */
export function maskEmail(email) {
  const s = String(email || "");
  const at = s.indexOf("@");
  if (at < 1) return "your registered address";
  return `${s[0]}${"•".repeat(Math.max(3, Math.min(6, at - 1)))}${s.slice(at)}`;
}
