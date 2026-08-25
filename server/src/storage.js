// ============================================================
//   OBJECT STORAGE (S3-compatible)
//   ------------------------------------------------------------
//   Documents, signed output, signatures and voice notes currently live on the
//   EC2 box's filesystem. This moves them to an S3-compatible bucket (RustFS in
//   UAT) so the application server stops being the thing that holds the data.
//
//   Two deliberate decisions, both of which differ from the obvious approach:
//
//   NO PRESIGNED URLS. The tempting pattern is to redirect the browser to a
//   short-lived signed link. It cannot be used here. Every file route first
//   checks authoriseAccess(), then the confidential unlock gate, then writes an
//   access-log row — a redirect skips all three and hands out a URL that works
//   for anyone holding it until it expires. Worse, confidential documents are
//   stored ENCRYPTED, so a presigned link would serve ciphertext the browser
//   cannot open. Bytes therefore always come back through this module and out
//   through the existing routes, which keeps every control intact.
//
//   BYTES IN, BYTES OUT. The existing code encrypts before writing and decrypts
//   after reading (see confidential.js). Keeping this module a plain byte store
//   means that ordering is unchanged and confidential files are encrypted before
//   they ever leave the process — so bucket access alone does not reveal them.
// ============================================================
import {
  S3Client, PutObjectCommand, GetObjectCommand,
  DeleteObjectCommand, HeadBucketCommand,
} from "@aws-sdk/client-s3";
import crypto from "node:crypto";
import path from "node:path";

const cfg = {
  endpoint: (process.env.STORAGE_ENDPOINT || "").trim().replace(/\/+$/, ""),
  region: (process.env.STORAGE_REGION || "ap-south-1").trim(),
  bucket: (process.env.STORAGE_BUCKET || "").trim(),
  accessKey: (process.env.STORAGE_ACCESS_KEY || "").trim(),
  secretKey: (process.env.STORAGE_SECRET_KEY || "").trim(),
  // Path-style addressing (bucket in the path, not the hostname). Required by
  // most self-hosted S3 servers, which have no per-bucket DNS.
  forcePathStyle: String(process.env.STORAGE_FORCE_PATH_STYLE || "").trim() === "true",
};

/**
 * Whether object storage is configured. Fail-closed: with no bucket the callers
 * keep using the filesystem rather than erroring, so a half-configured server
 * degrades to the old behaviour instead of losing uploads.
 */
export function isEnabled() {
  return !!(cfg.bucket && cfg.endpoint);
}

/** Diagnostic for the health endpoint — never includes the secret. */
export function status() {
  return {
    enabled: isEnabled(),
    endpoint: cfg.endpoint || null,
    bucket: cfg.bucket || null,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle,
    credentials: cfg.accessKey ? "configured" : "none (instance role or anonymous)",
  };
}

let _client = null;
function client() {
  if (_client) return _client;
  if (!isEnabled()) throw new Error("Object storage is not configured");
  _client = new S3Client({
    region: cfg.region,
    // Left undefined against real AWS S3; set for a self-hosted server.
    endpoint: cfg.endpoint || undefined,
    forcePathStyle: cfg.forcePathStyle,
    // Omitted when unset so the SDK can fall back to an instance role. Note
    // that a self-hosted server has no such role — it always needs these.
    credentials: cfg.accessKey
      ? { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey }
      : undefined,
  });
  return _client;
}

// Areas map to the existing upload directories, so a key says what it holds.
export const AREAS = ["documents", "signed", "signatures", "voicenotes"];

/**
 * A storage key: `area/yyyy/mm/uuid.ext`.
 *
 * The original filename is deliberately NOT part of the key. A name like
 * "PR Termination - <person>.pdf" leaks the substance of a confidential request
 * to anyone who can list the bucket; the real name already lives in the
 * database, which is where it belongs.
 */
export function buildKey(area, originalName = "") {
  if (!AREAS.includes(area)) throw new Error(`Unknown storage area: ${area}`);
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  // Extension only, lowercased, and only if it looks like one — never the name.
  const raw = path.extname(originalName || "").toLowerCase();
  const ext = /^\.[a-z0-9]{1,8}$/.test(raw) ? raw : "";
  return `${area}/${yyyy}/${mm}/${crypto.randomUUID()}${ext}`;
}

/**
 * Store bytes and return the key. Persist the key — it is the only handle to
 * the object. Confidential content must already be encrypted by the caller.
 */
export async function putFile(area, buffer, { originalName = "", contentType } = {}) {
  const Key = buildKey(area, originalName);
  await client().send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key,
    Body: buffer,
    ContentType: contentType || "application/octet-stream",
  }));
  return Key;
}

/** Fetch an object's bytes. Throws if it is missing. */
export async function getFileBytes(Key) {
  const res = await client().send(new GetObjectCommand({ Bucket: cfg.bucket, Key }));
  return Buffer.from(await res.Body.transformToByteArray());
}

/** True when the object exists, false when it does not. Other errors propagate. */
export async function exists(Key) {
  try {
    await client().send(new GetObjectCommand({ Bucket: cfg.bucket, Key }));
    return true;
  } catch (e) {
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return false;
    throw e;
  }
}

export async function deleteFile(Key) {
  await client().send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key }));
}

/**
 * A real round trip: reach the bucket, write a small object, read it back,
 * confirm the bytes match, and delete it. Checking only that the bucket
 * responds would pass with credentials that cannot actually write.
 */
export async function healthCheck() {
  const started = Date.now();
  if (!isEnabled()) return { ok: false, reason: "not configured", ...status() };
  try {
    await client().send(new HeadBucketCommand({ Bucket: cfg.bucket }));
    const probe = Buffer.from(`signflow-health ${new Date().toISOString()}`);
    // One object, written under a key we hold, so it can be read back and then
    // removed. Writing via putFile() would generate a key we never see and leave
    // the probe object behind on every health check.
    const key = `_health/${crypto.randomUUID()}.txt`;
    await client().send(new PutObjectCommand({
      Bucket: cfg.bucket, Key: key, Body: probe, ContentType: "text/plain",
    }));
    let match = false;
    try {
      match = Buffer.compare(await getFileBytes(key), probe) === 0;
    } finally {
      // Always clean up, even if the read failed — otherwise a broken read
      // silently accumulates probe objects.
      await deleteFile(key).catch(() => {});
    }
    return { ok: match, roundTripMs: Date.now() - started, ...status() };
  } catch (e) {
    return { ok: false, reason: e?.name || "error", message: e?.message, ...status() };
  }
}
