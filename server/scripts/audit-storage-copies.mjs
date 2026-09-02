// Which stored files still exist, and in which of the two places?
//
//   node --env-file=.env scripts/audit-storage-copies.mjs
//
// STRICTLY READ-ONLY. It writes nothing, uploads nothing and deletes nothing.
//
// Every stored file is meant to live twice: on the box's disk and in the bucket.
// readStored prefers the bucket when the stored value is a key and falls back to
// disk, so a file surviving in EITHER place is a file that still opens. That is
// why "missing from disk" on its own says nothing — the existing migration
// inventory searches only the filesystem, and a bucket-only file shows up there
// as absent while being perfectly readable in the app.
//
// The question worth answering is the one neither view answers alone: how many
// referenced files exist in NEITHER place. Those are the only ones actually
// lost, and they are the only ones worth anyone's attention.
//
// This matters after a period when the bucket was full: writes failed and fell
// back to disk, so recent files may be disk-only, while older ones whose disk
// copy was cleaned up may be bucket-only. Both are fine. Neither is not.
import "dotenv/config";
import fs from "node:fs/promises";
import mysql from "mysql2/promise";
import { diskPathFor, keyFor } from "../src/filestore.js";
import * as storage from "../src/storage.js";

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "3306", 10),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "signflow",
});

// Each column that records a stored file, with the area it belongs to. Wrapped
// individually: a column that does not exist on this box must not end the run.
const SOURCES = [
  ["documents",  "SELECT file_path AS v FROM requests WHERE file_path IS NOT NULL AND file_path <> ''"],
  ["signed",     "SELECT signed_file_path AS v FROM requests WHERE signed_file_path IS NOT NULL AND signed_file_path <> ''"],
  ["signatures", "SELECT applied_signature_path AS v FROM requests WHERE applied_signature_path IS NOT NULL AND applied_signature_path <> ''"],
  ["signatures", "SELECT signature_path AS v FROM request_step_signers WHERE signature_path IS NOT NULL AND signature_path <> ''"],
  ["signatures", "SELECT signature_path AS v FROM users WHERE signature_path IS NOT NULL AND signature_path <> ''"],
];

const refs = new Map();   // area + value, deduplicated — one signature is reused by many rows
for (const [area, sql] of SOURCES) {
  try {
    const [rows] = await conn.execute(sql);
    for (const r of rows) if (r.v) refs.set(`${area}::${r.v}`, { area, v: String(r.v) });
  } catch (e) {
    console.log(`  (skipped a source: ${e.code || e.message})`);
  }
}
await conn.end();

console.log(`\n  Object storage: ${storage.isEnabled() ? "enabled" : "DISABLED"}`);
console.log(`  ${refs.size} distinct stored file(s) referenced by the database.\n`);

const onDisk = async (area, v) => {
  try { await fs.access(diskPathFor(area, v)); return true; } catch { return false; }
};
const inBucket = async (area, v) => {
  if (!storage.isEnabled()) return false;
  try { return await storage.exists(keyFor(area, v)); } catch { return false; }
};

const tally = { both: 0, diskOnly: 0, bucketOnly: 0, neither: [] };
for (const { area, v } of refs.values()) {
  const [d, b] = await Promise.all([onDisk(area, v), inBucket(area, v)]);
  if (d && b) tally.both++;
  else if (d) tally.diskOnly++;
  else if (b) tally.bucketOnly++;
  else tally.neither.push(`${area}/${v}`);
}

const rule = "  " + "-".repeat(74);
console.log(rule);
console.log(`  in BOTH places (fully redundant): ${tally.both}`);
console.log(`  disk only  — bucket copy never made, or made while the bucket was full: ${tally.diskOnly}`);
console.log(`  bucket only — reads fine, but the box holds no local copy: ${tally.bucketOnly}`);
console.log(`  in NEITHER — these are the lost ones: ${tally.neither.length}`);
console.log(rule);

if (tally.neither.length) {
  console.log("\n  Referenced by a row and present nowhere:");
  for (const k of tally.neither.slice(0, 60)) console.log(`    ${k}`);
  if (tally.neither.length > 60) console.log(`    … and ${tally.neither.length - 60} more`);
  console.log("\n  These cannot be recovered from this server. They can only come back from a");
  console.log("  snapshot of the machine, a copy of the bucket, or whoever still holds the");
  console.log("  original document.");
} else {
  console.log("\n  Every referenced file still exists in at least one place — nothing is lost.");
}

if (tally.diskOnly) {
  console.log(`\n  ${tally.diskOnly} file(s) have no bucket copy. Now that the quota is raised,`);
  console.log("  the migration workflow in upload mode restores the second copy.");
}
console.log("");
process.exit(0);
