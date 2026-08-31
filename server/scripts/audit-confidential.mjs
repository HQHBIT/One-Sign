// Which confidential documents can this server still decrypt?
//
//   node --env-file=.env scripts/audit-confidential.mjs
//
// STRICTLY READ-ONLY. It never writes, never deletes, and never prints a byte
// of decrypted content — only whether decryption succeeded, and why not.
//
// A GCM authentication failure means the key decrypting is not the key that
// encrypted, or the ciphertext has changed. Neither can be told apart from a
// single document, but the SHAPE of the failures across all of them can:
//
//   * everything fails            -> the key on this box is simply wrong
//   * everything before a date    -> the key changed on that date
//   * scattered failures          -> individual files, not the key
//
// The date boundary is the thing worth knowing, because it says what to go
// looking for and whether an older key still needs recovering.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { looksEncrypted, decryptBuffer, isEnabled, keyStatus } from "../src/confidential.js";
import { readStored, diskPathFor, isKey } from "../src/filestore.js";
import * as storage from "../src/storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log(`\n  Confidential key on this box: ${isEnabled() ? "configured" : "MISSING"} (${JSON.stringify(keyStatus())})`);
console.log(`  Object storage: ${storage.isEnabled() ? "enabled" : "disabled"}\n`);

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "3306", 10),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "signflow",
});

const [rows] = await conn.execute(
  `SELECT id, file_name, file_path, signed_file_path, created_at, status
     FROM requests WHERE confidential = 1 ORDER BY created_at ASC`);
await conn.end();

if (!rows.length) {
  console.log("  No confidential documents on this box.\n");
  process.exit(0);
}
console.log(`  ${rows.length} confidential request(s) to check.\n`);

const ok = [], bad = [], absent = [];

for (const r of rows) {
  const when = new Date(Number(r.created_at)).toISOString().slice(0, 10);
  const label = `${when}  ${r.id}  ${String(r.status).padEnd(16)}`;

  // Fetch the raw stored bytes WITHOUT decrypting, so a read failure and a
  // decrypt failure are never confused for one another.
  let raw = null, source = "disk";
  try {
    if (isKey(r.file_path) && storage.isEnabled()) {
      try { raw = await storage.getFileBytes(String(r.file_path)); source = "bucket"; }
      catch { raw = null; }
    }
    if (raw === null) raw = await fs.readFile(diskPathFor("documents", r.file_path));
  } catch (e) {
    absent.push(`${label}  file not readable (${e.code || e.message})`);
    continue;
  }

  if (!looksEncrypted(raw)) {
    ok.push(`${label}  stored PLAINTEXT (not an envelope) — readable, but not protected`);
    continue;
  }

  // Envelope header: [0]=0xC1 magic, [1]=version, [2]=key id.
  const version = raw[1], keyId = raw[2];
  try {
    decryptBuffer(raw);
    ok.push(`${label}  decrypts (v${version} key${keyId}, from ${source})`);
  } catch (e) {
    bad.push(`${label}  FAILS: ${e.message} (v${version} key${keyId}, ${raw.length}B from ${source})`);
  }
}

const line = "  " + "-".repeat(72);
console.log(`  DECRYPTS: ${ok.length}`);
console.log(line);
ok.forEach(x => console.log("  " + x));
console.log(`\n  FAILS TO DECRYPT: ${bad.length}`);
console.log(line);
bad.forEach(x => console.log("  " + x));
if (absent.length) {
  console.log(`\n  FILE NOT READABLE: ${absent.length}`);
  console.log(line);
  absent.forEach(x => console.log("  " + x));
}

// The boundary is the finding. Everything either side of it is detail.
if (bad.length && ok.length) {
  const lastBad = bad[bad.length - 1].trim().slice(0, 10);
  const firstOk = ok[0].trim().slice(0, 10);
  console.log(`\n  Newest failure: ${lastBad}    Oldest success: ${firstOk}`);
  console.log("  A clean split by date means the key changed; a mix means it did not.");
} else if (bad.length && !ok.length) {
  console.log("\n  EVERY confidential document fails. The key on this box is not the key");
  console.log("  they were encrypted with. Recover the previous CONFIDENTIAL_KEY —");
  console.log("  nothing else will open them.");
} else if (!bad.length) {
  console.log("\n  Every confidential document decrypts on this box.");
}
console.log("");
process.exit(0);
