// Which confidential documents can this server still decrypt, and which copy is at fault?
//
//   node --env-file=.env scripts/audit-confidential.mjs
//
// STRICTLY READ-ONLY. It never writes, never deletes, and never prints a byte
// of decrypted content — only whether decryption succeeded, and why not.
//
// A GCM tag failure means the key decrypting is not the key that encrypted, OR
// the ciphertext changed. From one document those look identical. They stop
// looking identical the moment you check BOTH copies of the same file, because
// a document lives in two places during the migration and they were written at
// different times by different code:
//
//   disk OK, bucket BAD  -> the bucket object is damaged; the key is fine
//   both BAD             -> the key on this box is not the encrypting key
//   both OK              -> this document was never the problem
//
// That distinction decides everything downstream: a damaged object is repaired
// from the disk copy sitting right next to it, whereas a wrong key means
// recovering the old CONFIDENTIAL_KEY and nothing else will do.
//
// Byte LENGTHS are printed alongside, because a short bucket copy is the
// signature of an upload cut off partway — which is what a quota that ran out
// mid-migration produces.
import "dotenv/config";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { looksEncrypted, decryptBuffer, isEnabled, keyStatus } from "../src/confidential.js";
import { diskPathFor, isKey, keyFor } from "../src/filestore.js";
import * as storage from "../src/storage.js";

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 12);

console.log(`\n  Confidential key: ${isEnabled() ? "configured" : "MISSING"} (${keyStatus()})`);
console.log(`  Object storage:   ${storage.isEnabled() ? "enabled" : "disabled"}\n`);

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "3306", 10),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "signflow",
});
const [rows] = await conn.execute(
  `SELECT id, file_path, created_at, status FROM requests
    WHERE confidential = 1 ORDER BY created_at ASC`);
await conn.end();

if (!rows.length) { console.log("  No confidential documents on this box.\n"); process.exit(0); }
console.log(`  ${rows.length} confidential request(s).\n`);

// Try one copy: does it exist, and does it decrypt? Never conflates the two.
async function probe(get) {
  try {
    const raw = await get();
    if (!raw) return { state: "absent" };
    if (!looksEncrypted(raw)) return { state: "plaintext", len: raw.length, sha: sha(raw) };
    try { decryptBuffer(raw); return { state: "ok", len: raw.length, sha: sha(raw) }; }
    catch (e) { return { state: "bad", len: raw.length, sha: sha(raw), why: e.message }; }
  } catch (e) { return { state: "absent", why: e.code || e.message }; }
}

const tally = { diskOnly: [], bothBad: [], bothOk: [], other: [] };

for (const r of rows) {
  const when = new Date(Number(r.created_at)).toISOString().slice(0, 10);
  const disk = await probe(() => fs.readFile(diskPathFor("documents", r.file_path)));
  const buck = storage.isEnabled()
    ? await probe(() => storage.getFileBytes(keyFor("documents", r.file_path)))
    : { state: "n/a" };

  const served = isKey(r.file_path) && storage.isEnabled() ? "bucket" : "disk";
  const line = `${when}  ${r.id}  serves-from:${served.padEnd(6)}  ` +
    `disk:${disk.state}${disk.len ? "/" + disk.len + "B/" + disk.sha : ""}  ` +
    `bucket:${buck.state}${buck.len ? "/" + buck.len + "B/" + buck.sha : ""}`;

  if (disk.state === "ok" && buck.state === "bad") tally.diskOnly.push(line);
  else if (disk.state === "bad" && buck.state === "bad") tally.bothBad.push(line);
  else if (disk.state === "bad" && buck.state !== "ok") tally.bothBad.push(line);
  else if (disk.state === "ok" || buck.state === "ok") tally.bothOk.push(line);
  else tally.other.push(line);
}

const rule = "  " + "-".repeat(78);
const show = (title, xs) => { if (!xs.length) return;
  console.log(`\n  ${title}: ${xs.length}`); console.log(rule); xs.forEach(x => console.log("  " + x)); };

show("REPAIRABLE — disk copy is good, bucket copy is damaged", tally.diskOnly);
show("UNREADABLE — no good copy anywhere", tally.bothBad);
show("HEALTHY", tally.bothOk);
show("OTHER", tally.other);

console.log("\n" + rule);
if (tally.bothBad.length && !tally.diskOnly.length && !tally.bothOk.length) {
  console.log("  VERDICT: every copy fails. The key on this box is not the key these were");
  console.log("  sealed with. Recover the previous CONFIDENTIAL_KEY — nothing else opens them.");
} else if (tally.diskOnly.length) {
  console.log("  VERDICT: the key is FINE. The bucket copies are damaged and the intact disk");
  console.log("  copies are sitting right beside them. Compare the byte lengths above: a short");
  console.log("  bucket copy means the upload was cut off partway.");
  console.log("  Fix: make readStored fall back to disk when the bucket copy will not decrypt,");
  console.log("  then re-upload the damaged objects from disk.");
} else if (tally.bothOk.length && !tally.bothBad.length) {
  console.log("  VERDICT: every confidential document decrypts. The fault is elsewhere.");
}
console.log("");
process.exit(0);
