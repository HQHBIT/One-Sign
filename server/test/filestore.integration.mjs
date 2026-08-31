// Integration: the disk/bucket dual-read and dual-write layer.
// Needs STORAGE_* configured; skips the bucket half cleanly when it is not.
//
//   node --env-file=.env test/filestore.integration.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isKey, keyFor, readStored, writeStored, deleteStored } from "../src/filestore.js";
import * as storage from "../src/storage.js";
import { encryptBuffer, decryptBuffer, isEnabled as confidentialEnabled } from "../src/confidential.js";

const UPLOADS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "uploads");
const made = [];
const tmpName = (ext = ".bin") => { const n = `_fstest_${crypto.randomUUID()}${ext}`; made.push(n); return n; };

// ---- telling a legacy filename from a migrated key ----
{
  assert.equal(isKey("req_abc.pdf"), false, "a bare filename is not a key");
  assert.equal(isKey("documents/req_abc.pdf"), true, "an area-prefixed path is a key");
  assert.equal(isKey("signed/x.pdf"), true);
  assert.equal(isKey("signatures/u.png"), true);
  assert.equal(isKey("voicenotes/v.webm"), true);
  // Something merely containing a slash is NOT a key — only the known areas count,
  // or a stray value could send a read at the bucket that belongs on disk.
  assert.equal(isKey("nonsense/x.pdf"), false, "an unknown prefix is not a key");
  assert.equal(isKey(""), false);
  assert.equal(isKey(null), false);

  assert.equal(keyFor("documents", "a.pdf"), "documents/a.pdf", "a filename gains its area");
  assert.equal(keyFor("documents", "documents/a.pdf"), "documents/a.pdf", "a key is left alone");
}

// ---- a value that escapes uploads/ is refused ----
{
  await assert.rejects(() => readStored("documents", "../../../../etc/passwd"),
    /escapes the uploads directory/, "path traversal in a stored value is refused");
  await assert.rejects(() => readStored("nonsense", "a.pdf"), /Unknown storage area/);
  await assert.rejects(() => readStored("documents", ""), /No stored file recorded/);
}

// ---- legacy path: a bare filename still reads from disk ----
{
  const name = tmpName(".pdf");
  const payload = crypto.randomBytes(4096);
  await fsp.mkdir(path.join(UPLOADS, "documents"), { recursive: true });
  await fsp.writeFile(path.join(UPLOADS, "documents", name), payload);

  const back = await readStored("documents", name);
  assert.equal(Buffer.compare(back, payload), 0, "a pre-migration row still reads from disk");
  await fsp.unlink(path.join(UPLOADS, "documents", name));
}

// ---- confidential content is decrypted on the way out, whatever the source ----
if (confidentialEnabled()) {
  const name = tmpName(".pdf.enc");
  const plain = Buffer.from("%PDF-1.7 confidential body");
  await fsp.writeFile(path.join(UPLOADS, "documents", name), encryptBuffer(plain));
  const back = await readStored("documents", name);
  assert.equal(Buffer.compare(back, plain), 0, "an encrypted envelope on disk comes back decrypted");
  await fsp.unlink(path.join(UPLOADS, "documents", name));
} else {
  console.log("  (CONFIDENTIAL_KEY unset — encryption checks skipped)");
}

if (!storage.isEnabled()) {
  console.log("filestore: storage not configured — disk-only tests passed, bucket tests skipped");
  process.exit(0);
}

// ---- dual write: disk AND bucket, and the DB value becomes a key ----
{
  const name = tmpName(".pdf");
  const payload = crypto.randomBytes(20000);
  const stored = await writeStored("documents", name, payload, { contentType: "application/pdf" });

  assert.equal(stored, `documents/${name}`, "a verified bucket write yields a key");
  assert.equal(isKey(stored), true);

  // Both copies exist. That redundancy is the whole point during the transition.
  const onDisk = await fsp.readFile(path.join(UPLOADS, "documents", name));
  assert.equal(Buffer.compare(onDisk, payload), 0, "the disk copy is written too");
  const inBucket = await storage.getFileBytes(stored);
  assert.equal(Buffer.compare(inBucket, payload), 0, "the bucket copy matches");

  const back = await readStored("documents", stored);
  assert.equal(Buffer.compare(back, payload), 0, "reading by key returns the same bytes");

  await deleteStored("documents", stored);
  assert.equal(await storage.exists(stored), false, "delete removes the bucket copy");
  await assert.rejects(() => fsp.access(path.join(UPLOADS, "documents", name)), "and the disk copy");
}

// ---- THE property that makes repointing survivable ----
// A row already pointing at a key must still serve if the bucket loses the
// object, because the key's suffix is also its path on disk.
{
  const name = tmpName(".pdf");
  const payload = crypto.randomBytes(8192);
  const stored = await writeStored("documents", name, payload);
  assert.equal(isKey(stored), true);

  // Delete ONLY the bucket copy, leaving the row pointing at a key.
  await storage.deleteFile(stored);
  assert.equal(await storage.exists(stored), false, "the bucket object is gone");

  const back = await readStored("documents", stored);
  assert.equal(Buffer.compare(back, payload), 0,
    "a key whose object is missing still serves from disk — a repointed row cannot 404");

  await fsp.unlink(path.join(UPLOADS, "documents", name));
}

// ---- a confidential file reaches the bucket still encrypted ----
if (confidentialEnabled()) {
  const name = tmpName(".pdf.enc");
  const plain = Buffer.from("%PDF-1.7 secret");
  const sealed = encryptBuffer(plain);
  const stored = await writeStored("documents", name, sealed);

  const raw = await storage.getFileBytes(stored);
  assert.equal(Buffer.compare(raw, sealed), 0, "the bucket holds the sealed bytes");
  assert.notEqual(raw.toString("latin1"), plain.toString("latin1"),
    "the plaintext never reaches the bucket — console access alone reveals nothing");
  assert.equal(raw[0], 0xc1, "and it carries the envelope marker");

  const back = await readStored("documents", stored);
  assert.equal(Buffer.compare(back, plain), 0, "but it still decrypts on the way out");

  await deleteStored("documents", stored);
}

// ---- a DAMAGED bucket copy must not cost us the good disk copy ----
// This is the production failure, reproduced. A bucket object that was cut
// off partway reads back without error and only fails at its authentication
// tag — so the read succeeded and the DECRYPT is what threw. The old code
// only fell back to disk when the read itself threw, so this exception
// escaped and the document became unopenable even though an intact copy was
// sitting on the filesystem the whole time.
if (confidentialEnabled()) {
  const name = tmpName(".pdf.enc");
  const plain = Buffer.concat([Buffer.from("%PDF-1.7 board minutes"), crypto.randomBytes(2048)]);
  const sealed = encryptBuffer(plain);
  const stored = await writeStored("documents", name, sealed);
  assert.equal(isKey(stored), true);

  // Truncate ONLY the bucket copy. Dropping the tail leaves the envelope
  // header intact and long enough to look valid, so it gets as far as the
  // tag check and fails there — byte for byte the production symptom.
  await storage.putAt(stored, sealed.subarray(0, sealed.length - 8), "application/pdf");
  const damaged = await storage.getFileBytes(stored);
  assert.equal(damaged[0], 0xc1, "the damaged copy still looks like an envelope");
  assert.throws(() => decryptBuffer(damaged), /unable to authenticate data|Unsupported state/,
    "and it genuinely does not decrypt — the reproduction is real");

  const back = await readStored("documents", stored);
  assert.equal(Buffer.compare(back, plain), 0,
    "a damaged bucket copy falls back to the intact disk copy instead of throwing");

  await deleteStored("documents", stored);
}
// ---- signed output round-trips through the same layer ----
{
  const name = tmpName(".signed.pdf");
  const payload = Buffer.concat([Buffer.from("%PDF-1.7\n"), crypto.randomBytes(3000)]);
  const stored = await writeStored("signed", name, payload, { contentType: "application/pdf" });
  assert.equal(stored, `signed/${name}`);
  assert.equal(Buffer.compare(await readStored("signed", stored), payload), 0);
  await deleteStored("signed", stored);
}

// ---- leave nothing behind ----
{
  for (const area of ["documents", "signed"]) {
    const left = (await fsp.readdir(path.join(UPLOADS, area)).catch(() => []))
      .filter(f => f.startsWith("_fstest_"));
    for (const f of left) await fsp.unlink(path.join(UPLOADS, area, f)).catch(() => {});
    // Re-read AFTER deleting. Asserting on the pre-deletion list made a single
    // leftover from an earlier crashed run fail every subsequent run.
    const still = (await fsp.readdir(path.join(UPLOADS, area)).catch(() => []))
      .filter(f => f.startsWith("_fstest_"));
    assert.equal(still.length, 0, `no test files left in ${area}`);
  }
}

console.log("filestore: all tests passed");
process.exit(0);
