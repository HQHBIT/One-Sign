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

let cachedKey = null;
let cachedRaw = null;

/** The 32-byte key, or null when unset/malformed. Re-read if the env changes (tests). */
function key() {
  const raw = process.env.CONFIDENTIAL_KEY || "";
  if (!raw) { cachedRaw = null; cachedKey = null; return null; }
  if (raw === cachedRaw) return cachedKey;
  let buf;
  try { buf = Buffer.from(raw, "base64"); } catch { return null; }
  if (buf.length !== 32) {
    console.warn(`[confidential] CONFIDENTIAL_KEY must be 32 bytes base64, got ${buf.length} — feature disabled`);
    cachedRaw = raw; cachedKey = null;
    return null;
  }
  cachedRaw = raw; cachedKey = buf;
  return buf;
}

/**
 * Is the feature usable? When false the Confidential toggle is hidden and the
 * API refuses to create confidential requests — it must NEVER silently fall
 * back to storing a "confidential" document as plaintext.
 */
export function isEnabled() {
  return key() !== null;
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
  const d = crypto.createDecipheriv("aes-256-gcm", k, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]);
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
