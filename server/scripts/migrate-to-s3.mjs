// Copy every stored file on this box into an S3 bucket.
//
//   node scripts/migrate-to-s3.mjs                 # inventory + what would move
//   node scripts/migrate-to-s3.mjs --apply         # actually copy
//   node scripts/migrate-to-s3.mjs --apply --limit 50
//
// Target, given as environment variables so no secret is ever typed on a command
// line and none is read from a file in this repository:
//
//   TARGET_BUCKET       required
//   TARGET_REGION       required for AWS (e.g. ap-south-1)
//   TARGET_ACCESS_KEY   required unless the box has an instance role
//   TARGET_SECRET_KEY   "
//   TARGET_ENDPOINT     ONLY for a self-hosted server. Leave UNSET for Amazon
//                       S3 — setting it is what makes the SDK talk to something
//                       other than AWS.
//   TARGET_FORCE_PATH_STYLE=true   usually needed for self-hosted, not for AWS.
//
// Deliberately separate from the application's own STORAGE_* settings. That lets
// the copy run against a new bucket while the app keeps serving from the old one,
// which is the only way to migrate without a window where reads fail.
//
// KEYS MATCH THE FILESTORE. An object is written at "area/filename" — the same
// key readStored derives from a stored value — so once everything is across, the
// database rows can be repointed and reads resolve without moving anything again.
//
// Safe to re-run. An object already present with identical content is skipped,
// so an interrupted run continues where it stopped rather than starting over.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand,
} from "@aws-sdk/client-s3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.join(__dirname, "..", "uploads");

// The filestore's areas. Anything outside them is not a stored document and is
// left alone rather than swept into the bucket.
const AREAS = ["documents", "signed", "signatures", "voicenotes"];

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LIMIT = (() => {
  const i = args.indexOf("--limit");
  return i >= 0 ? parseInt(args[i + 1], 10) || 0 : 0;
})();
const CONCURRENCY = 4;

const cfg = {
  bucket: (process.env.TARGET_BUCKET || "").trim(),
  region: (process.env.TARGET_REGION || "").trim(),
  endpoint: (process.env.TARGET_ENDPOINT || "").trim(),
  accessKey: (process.env.TARGET_ACCESS_KEY || "").trim(),
  secretKey: (process.env.TARGET_SECRET_KEY || "").trim(),
  pathStyle: String(process.env.TARGET_FORCE_PATH_STYLE || "").trim() === "true",
};

const MB = (n) => (n / 1048576).toFixed(1) + " MB";
const CONTENT_TYPES = {
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webm": "audio/webm", ".json": "application/json",
};

// ---- what is on this box ----
async function walk(dir, base = dir) {
  const out = [];
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(full, base));
    else {
      const stat = await fs.stat(full).catch(() => null);
      if (stat) {
        out.push({
          // Forward slashes: a key is not a Windows path, and a backslash here
          // would create an object nothing can ever find again.
          key: path.relative(base, full).split(path.sep).join("/"),
          full,
          size: stat.size,
        });
      }
    }
  }
  return out;
}

const md5 = async (file) => {
  const h = crypto.createHash("md5");
  h.update(await fs.readFile(file));
  return h.digest("hex");
};

console.log("");
const files = [];
for (const area of AREAS) files.push(...await walk(path.join(UPLOADS, area), UPLOADS));
files.sort((a, b) => a.key.localeCompare(b.key));
const totalBytes = files.reduce((a, f) => a + f.size, 0);

console.log(`  On this box: ${files.length} file(s), ${MB(totalBytes)}`);
for (const area of AREAS) {
  const sub = files.filter((f) => f.key.startsWith(area + "/"));
  if (sub.length) console.log(`    ${area.padEnd(12)} ${String(sub.length).padStart(5)}  ${MB(sub.reduce((a, f) => a + f.size, 0))}`);
}

if (!cfg.bucket) {
  console.log("\n  No TARGET_BUCKET set, so nothing was contacted and nothing copied.");
  console.log("  This is the inventory only. Set the TARGET_* variables to go further.\n");
  process.exit(0);
}

// ---- the target ----
// endpoint is passed as undefined when unset, which is what makes the SDK talk
// to Amazon S3 rather than a self-hosted server.
const s3 = new S3Client({
  region: cfg.region || undefined,
  endpoint: cfg.endpoint || undefined,
  forcePathStyle: cfg.pathStyle,
  credentials: cfg.accessKey
    ? { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey }
    : undefined,          // an instance role, where the box has one
});

console.log(`\n  Target: ${cfg.bucket}${cfg.endpoint ? ` at ${cfg.endpoint}` : " on Amazon S3"}` +
  `${cfg.region ? ` (${cfg.region})` : ""}`);
console.log(`  Mode:   ${APPLY ? "APPLY — objects will be written" : "dry run — nothing will be written"}`);
if (LIMIT) console.log(`  Limit:  first ${LIMIT} file(s)`);
console.log("");

/** Already there, byte for byte? ETag is the MD5 for a single-part upload, which
 *  is what this writes, so it is a content check and not merely a size one. */
async function alreadyThere(f) {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: f.key }));
    const etag = String(head.ETag || "").replace(/"/g, "");
    if (head.ContentLength !== f.size) return { same: false, reason: "different size" };
    if (etag && !etag.includes("-")) {
      return { same: etag === await md5(f.full), reason: "different content" };
    }
    return { same: true };        // multipart ETag: size match is the best available
  } catch (e) {
    if (e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) {
      return { same: false, reason: "absent" };
    }
    throw e;
  }
}

const tally = { skipped: 0, copied: 0, differs: 0, failed: 0, bytes: 0 };
const failures = [];
const work = LIMIT ? files.slice(0, LIMIT) : files;

async function handle(f) {
  try {
    const there = await alreadyThere(f);
    if (there.same) { tally.skipped++; return; }
    if (there.reason === "different content") {
      // Not overwritten without being asked: the bucket copy differing from disk
      // is a fact worth reporting, and quietly replacing one with the other
      // destroys the evidence of whichever was wrong.
      tally.differs++;
      failures.push(`${f.key} — differs from the copy already in the bucket (not overwritten)`);
      return;
    }
    if (!APPLY) { tally.copied++; tally.bytes += f.size; return; }

    const body = await fs.readFile(f.full);
    await s3.send(new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: f.key,
      Body: body,
      ContentType: CONTENT_TYPES[path.extname(f.key).toLowerCase()] || "application/octet-stream",
    }));
    // Read back rather than trust the write. A bucket that accepted an object it
    // did not keep is the failure this migration exists to rule out.
    const back = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: f.key }));
    const bytes = Buffer.from(await back.Body.transformToByteArray());
    if (Buffer.compare(bytes, body) !== 0) throw new Error("read back different from what was written");
    tally.copied++; tally.bytes += f.size;
  } catch (e) {
    tally.failed++;
    const msg = e?.name === "Error" ? e.message : `${e?.name || "error"}${e?.message ? `: ${e.message}` : ""}`;
    failures.push(`${f.key} — ${msg}`);
  }
}

// A few at a time. One at a time is slow over a thousand files; all at once
// opens a thousand sockets and trips any rate limit the bucket has.
let cursor = 0;
let done = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (cursor < work.length) {
    const f = work[cursor++];
    await handle(f);
    if (++done % 100 === 0) console.log(`  … ${done}/${work.length}`);
  }
}));

console.log("\n  " + "-".repeat(64));
console.log(`  already there   ${tally.skipped}`);
console.log(`  ${APPLY ? "copied         " : "would copy     "} ${tally.copied}  (${MB(tally.bytes)})`);
if (tally.differs) console.log(`  DIFFERS         ${tally.differs}  — on disk and in the bucket, and not the same`);
if (tally.failed) console.log(`  failed          ${tally.failed}`);
console.log("  " + "-".repeat(64));

if (failures.length) {
  console.log("\n  Not copied:");
  for (const f of failures.slice(0, 40)) console.log(`    ${f}`);
  if (failures.length > 40) console.log(`    … and ${failures.length - 40} more`);
  // A quota is the one failure worth naming, because it is not a fault in the
  // file and re-running fixes nothing until the bucket is made bigger.
  if (failures.some((f) => /quota/i.test(f))) {
    console.log("\n  The bucket is full. Raise its quota and run this again — everything");
    console.log("  already copied is skipped, so it continues rather than restarting.");
  }
}

if (!APPLY && tally.copied) {
  console.log("\n  Nothing was written. Re-run with --apply to copy.");
}
console.log("");
process.exit(tally.failed ? 1 : 0);
