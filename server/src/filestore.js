// ============================================================
//   WHERE A STORED FILE ACTUALLY LIVES
//   ------------------------------------------------------------
//   Files are moving from the server's filesystem to an object-storage bucket.
//   During that move both have to work, and the column that names a file has to
//   keep meaning something in either case. This is the layer that decides.
//
//   THE DISCRIMINATOR IS A SLASH. A legacy value is a bare filename —
//   "req_abc123.pdf" — and lives on disk. A migrated value is a storage key —
//   "documents/req_abc123.pdf" — and lives in the bucket. Nothing needs a flag
//   column or a lookup table, and a row that has not been migrated is simply
//   left alone.
//
//   THE KEY'S SUFFIX IS THE DISK PATH. Because keys mirror the directory layout
//   exactly, "documents/req_abc123.pdf" names the bucket object AND the file at
//   uploads/documents/req_abc123.pdf. So a key can always fall back to disk
//   while the disk copy still exists — which is what makes repointing the
//   database survivable rather than a leap.
//
//   WRITES GO TO BOTH, and the key is only stored once the bucket copy has been
//   read back and verified. If the bucket write fails the caller gets a plain
//   filename and the request proceeds against disk, so an object-storage outage
//   degrades to the old behaviour rather than losing an upload.
// ============================================================
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { looksEncrypted, decryptBuffer } from "./confidential.js";
import * as storage from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.join(__dirname, "..", "uploads");

export const AREAS = ["documents", "signed", "signatures", "voicenotes"];

/** A stored value is a bucket key when it carries its area as a path prefix. */
export function isKey(storedValue) {
  const v = String(storedValue || "");
  return AREAS.some(a => v.startsWith(a + "/"));
}

/** The bucket key a value corresponds to, whether or not it already is one. */
export function keyFor(area, storedValue) {
  return isKey(storedValue) ? String(storedValue) : `${area}/${storedValue}`;
}

/**
 * Absolute path on disk, with the resolved result confirmed to sit inside
 * uploads/. A stored value comes from the database, and a value containing
 * "../" would otherwise read anywhere on the filesystem.
 */
// Exported so nothing has to re-implement the rule. Anything needing the file
// on disk — a test asserting encryption at rest, a migration — resolves it here.
export function diskPathFor(area, storedValue) {
  const rel = isKey(storedValue) ? String(storedValue) : path.join(area, String(storedValue));
  const full = path.resolve(UPLOADS, rel);
  if (full !== UPLOADS && !full.startsWith(UPLOADS + path.sep)) {
    throw new Error("Refusing a stored path that escapes the uploads directory");
  }
  return full;
}

/**
 * Read a stored file, from wherever it lives, decrypting it if it turns out to
 * be a confidential envelope. Replaces confidential.readMaybe() at call sites
 * that previously built a path by hand.
 */
export async function readStored(area, storedValue) {
  if (!AREAS.includes(area)) throw new Error(`Unknown storage area: ${area}`);
  if (!storedValue) throw new Error("No stored file recorded");

  const open = (bytes) => (looksEncrypted(bytes) ? decryptBuffer(bytes) : bytes);

  if (isKey(storedValue) && storage.isEnabled()) {
    try {
      // Decrypt INSIDE the try. A bucket object that is truncated or otherwise
      // damaged reads back fine and only then fails its authentication tag, and
      // treating that as fatal threw away the intact disk copy lying next to it
      // — which is how a confidential document became unopenable while a
      // perfectly good copy sat on the filesystem.
      return open(await storage.getFileBytes(String(storedValue)));
    } catch (e) {
      // Say so loudly: silently serving from disk would hide a broken migration.
      console.warn(`[filestore] bucket copy of ${storedValue} unusable (${e?.name || e?.message}); falling back to disk`);
    }
  }
  // If the key itself is wrong the disk copy fails too, and THAT error is the
  // one that surfaces — an honest one rather than a misleading bucket error.
  return open(await fs.readFile(diskPathFor(area, storedValue)));
}

/**
 * Write a stored file and return the value to record in the database.
 *
 * `bytes` must already be sealed by the caller when the content is
 * confidential — this layer never encrypts or decrypts on the way in, so the
 * bucket only ever receives what the filesystem would have received.
 *
 * Returns the bucket key when the object-storage copy is confirmed, otherwise
 * the bare filename.
 */
export async function writeStored(area, fileName, bytes, { contentType } = {}) {
  if (!AREAS.includes(area)) throw new Error(`Unknown storage area: ${area}`);
  const name = path.basename(String(fileName));      // never let a caller nest
  const full = diskPathFor(area, name);

  // Disk first, always. The filesystem copy is what every un-migrated code path
  // and the fallback above depend on.
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, bytes);

  if (!storage.isEnabled()) return name;

  const key = `${area}/${name}`;
  try {
    await storage.putAt(key, bytes, contentType);
    // Verified, not assumed. Recording a key for an object that is not really
    // there would point the database at nothing.
    const back = await storage.getFileBytes(key);
    if (Buffer.compare(back, Buffer.from(bytes)) !== 0) {
      throw new Error("stored bytes differ from what was written");
    }
    return key;
  } catch (e) {
    console.warn(`[filestore] bucket write failed for ${key} (${e?.message}); staying on disk`);
    return name;
  }
}

/** Remove a stored file from both places. Neither failure is fatal. */
export async function deleteStored(area, storedValue) {
  if (!storedValue) return;
  await fs.unlink(diskPathFor(area, storedValue)).catch(() => {});
  if (storage.isEnabled()) {
    await storage.deleteFile(keyFor(area, storedValue)).catch(() => {});
  }
}
