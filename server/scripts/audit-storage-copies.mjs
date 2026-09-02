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
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { diskPathFor, keyFor } from "../src/filestore.js";

// The bucket is addressed directly rather than through src/storage.js, because
// this has to run on a box regardless of which version that box has deployed —
// the same reason the confidential audit is carried inline. It also lets the
// check be a HEAD: asking whether an object exists must not download it.
const CFG = {
  endpoint: (process.env.STORAGE_ENDPOINT || "").trim().replace(/\/+$/, ""),
  region: (process.env.STORAGE_REGION || "ap-south-1").trim(),
  bucket: (process.env.STORAGE_BUCKET || "").trim(),
  accessKey: (process.env.STORAGE_ACCESS_KEY || "").trim(),
  secretKey: (process.env.STORAGE_SECRET_KEY || "").trim(),
  forcePathStyle: String(process.env.STORAGE_FORCE_PATH_STYLE || "").trim() === "true",
};
const bucketOn = !!(CFG.bucket && CFG.endpoint);
const s3 = bucketOn
  ? new S3Client({
      region: CFG.region,
      endpoint: CFG.endpoint || undefined,
      forcePathStyle: CFG.forcePathStyle,
      credentials: CFG.accessKey
        ? { accessKeyId: CFG.accessKey, secretAccessKey: CFG.secretKey }
        : undefined,
    })
  : null;

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

console.log(`\n  Object storage: ${bucketOn ? "enabled" : "DISABLED"}`);
console.log(`  ${refs.size} distinct stored file(s) referenced by the database.\n`);

const onDisk = async (area, v) => {
  try { await fs.access(diskPathFor(area, v)); return true; } catch { return false; }
};
const inBucket = async (area, v) => {
  if (!s3) return false;
  try {
    await s3.send(new HeadObjectCommand({ Bucket: CFG.bucket, Key: keyFor(area, v) }));
    return true;
  } catch (e) {
    // A missing object is an answer, not a failure. Anything else — a refused
    // credential, an unreachable endpoint — must not be silently reported as
    // "not in the bucket", which would turn an outage into a story about lost
    // files. It is counted separately and surfaced.
    if (e?.name === "NotFound" || e?.name === "NoSuchKey"
      || e?.$metadata?.httpStatusCode === 404) return false;
    return { error: e?.name || e?.message || "unknown" };
  }
};

const tally = { both: 0, diskOnly: 0, bucketOnly: 0, neither: [], errors: new Map() };
// Batched: one at a time over a thousand objects is slow, all at once opens a
// thousand sockets. Twenty keeps it to a few seconds without straining the box.
const all = [...refs.values()];
for (let i = 0; i < all.length; i += 20) {
  const batch = all.slice(i, i + 20);
  const results = await Promise.all(batch.map(async ({ area, v }) => {
    const [d, b] = await Promise.all([onDisk(area, v), inBucket(area, v)]);
    return { area, v, d, b };
  }));
  for (const { area, v, d, b } of results) {
    if (b && b.error) {
      tally.errors.set(b.error, (tally.errors.get(b.error) || 0) + 1);
      continue;   // unknown, not lost
    }
    if (d && b) tally.both++;
    else if (d) tally.diskOnly++;
    else if (b) tally.bucketOnly++;
    else tally.neither.push(`${area}/${v}`);
  }
}

const rule = "  " + "-".repeat(74);
console.log(rule);
console.log(`  in BOTH places (fully redundant): ${tally.both}`);
console.log(`  disk only  — bucket copy never made, or made while the bucket was full: ${tally.diskOnly}`);
console.log(`  bucket only — reads fine, but the box holds no local copy: ${tally.bucketOnly}`);
console.log(`  in NEITHER — these are the lost ones: ${tally.neither.length}`);
console.log(rule);

if (tally.errors.size) {
  console.log("\n  The bucket could not be asked about some files. These are UNKNOWN, not");
  console.log("  lost — treat the counts above as a floor until this is resolved:");
  for (const [name, n] of tally.errors) console.log(`    ${n} × ${name}`);
}

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
