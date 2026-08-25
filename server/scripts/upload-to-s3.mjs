// Uploads the files inventoried by dump-uploads.mjs into the object-storage
// bucket, at the exact keys the manifest names, and verifies every one.
//
//   node --env-file=.env scripts/upload-to-s3.mjs --dump dump-<stamp>
//   node --env-file=.env scripts/upload-to-s3.mjs --dump dump-<stamp> --confirm
//
// DRY RUN BY DEFAULT. Without --confirm it reports exactly what it would do and
// writes nothing. These are signed documents; a script that uploads the moment
// you run it is the wrong shape.
//
// It NEVER touches the database and NEVER modifies or deletes anything under
// uploads/. Copying files into a bucket is additive and reversible: nothing
// reads from S3 yet, so a completed run changes no application behaviour. The
// risky step — repointing the database columns — is deliberately not here.
//
// Confidential documents are uploaded exactly as they sit on disk, which means
// still encrypted. Their bytes are never decrypted in the course of moving them.
//
// Re-running is safe. A key already present with a matching sha256 is skipped,
// so an interrupted run resumes rather than starting over.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand,
} from "@aws-sdk/client-s3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.join(__dirname, "..", "uploads");

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };
const confirm = args.includes("--confirm");
const skipOrphans = args.includes("--skip-orphans");
const concurrency = Number(flag("--concurrency") || 4);
const dumpDir = flag("--dump");

if (!dumpDir) {
  console.error("\n  --dump <dir> is required. Run scripts/dump-uploads.mjs first.\n");
  process.exit(1);
}

const cfg = {
  endpoint: (process.env.STORAGE_ENDPOINT || "").trim().replace(/\/+$/, ""),
  region: (process.env.STORAGE_REGION || "ap-south-1").trim(),
  bucket: (process.env.STORAGE_BUCKET || "").trim(),
  accessKey: (process.env.STORAGE_ACCESS_KEY || "").trim(),
  secretKey: (process.env.STORAGE_SECRET_KEY || "").trim(),
  forcePathStyle: String(process.env.STORAGE_FORCE_PATH_STYLE || "").trim() === "true",
};
if (!cfg.bucket || !cfg.endpoint) {
  console.error("\n  STORAGE_ENDPOINT and STORAGE_BUCKET must be set. Nothing done.\n");
  process.exit(1);
}

const s3 = new S3Client({
  region: cfg.region,
  endpoint: cfg.endpoint || undefined,
  forcePathStyle: cfg.forcePathStyle,
  credentials: cfg.accessKey ? { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey } : undefined,
});

// --- read the manifest -------------------------------------------------
// Minimal CSV parse: the manifest is machine-written by dump-uploads.mjs, but
// a filename may legitimately contain a comma, so quoted cells must be handled.
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

const manifestPath = path.join(path.resolve(dumpDir), "manifest.csv");
const raw = await fs.readFile(manifestPath, "utf8").catch(() => null);
if (raw === null) {
  console.error(`\n  Could not read ${manifestPath}\n`);
  process.exit(1);
}
const rows = parseCsv(raw);
const header = rows.shift();
const col = Object.fromEntries(header.map((h, i) => [h, i]));
for (const need of ["s3_key", "area", "file_name", "bytes", "sha256"]) {
  if (col[need] === undefined) {
    console.error(`\n  manifest.csv is missing the "${need}" column.\n`);
    process.exit(1);
  }
}

let items = rows.map(r => ({
  key: r[col.s3_key], area: r[col.area], name: r[col.file_name],
  bytes: Number(r[col.bytes] || 0), sha256: r[col.sha256],
  refs: Number(r[col.db_references] ?? 0),
  encrypted: r[col.encrypted] === "yes",
})).filter(i => i.key && i.sha256);

const orphanCount = items.filter(i => i.refs === 0).length;
if (skipOrphans) items = items.filter(i => i.refs > 0);

console.log(`\n  Bucket      ${cfg.bucket} at ${cfg.endpoint}`);
console.log(`  Manifest    ${items.length} file(s), ${(items.reduce((a, b) => a + b.bytes, 0) / 1048576).toFixed(1)} MB`);
console.log(`  Orphans     ${orphanCount} referenced by no database row` +
  (skipOrphans ? " — EXCLUDED (--skip-orphans)" : " — included; a copy costs nothing and a missed file is unrecoverable"));
console.log(`  Encrypted   ${items.filter(i => i.encrypted).length} confidential file(s), uploaded as-is\n`);
if (!confirm) console.log("  DRY RUN — nothing will be written. Re-run with --confirm to upload.\n");

// --- upload ------------------------------------------------------------
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const results = { uploaded: [], skipped: [], failed: [], mismatched: [], absent: [] };

async function alreadyThere(item) {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: item.key }));
    if (Number(head.ContentLength) !== item.bytes) return false;
    // Size alone is not proof. Read it back and compare the digest.
    const got = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: item.key }));
    return sha(Buffer.from(await got.Body.transformToByteArray())) === item.sha256;
  } catch { return false; }
}

async function handle(item) {
  const full = path.join(UPLOADS, item.area, item.name);
  let bytes;
  try { bytes = await fs.readFile(full); }
  catch { results.absent.push(item); return; }

  // The manifest was taken earlier; if the file changed since, do not upload a
  // copy whose checksum no longer matches what was recorded.
  const local = sha(bytes);
  if (local !== item.sha256) { results.mismatched.push({ ...item, local }); return; }

  if (await alreadyThere(item)) { results.skipped.push(item); return; }
  if (!confirm) { results.uploaded.push(item); return; }   // dry run: would upload

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await s3.send(new PutObjectCommand({
        Bucket: cfg.bucket, Key: item.key, Body: bytes,
        ContentType: item.encrypted ? "application/octet-stream" : undefined,
      }));
      // Verify by reading back, every time. An upload that reports success and
      // stored something else is exactly the failure this migration cannot have.
      const got = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: item.key }));
      if (sha(Buffer.from(await got.Body.transformToByteArray())) !== item.sha256) {
        throw new Error("verification failed: stored bytes differ from the manifest");
      }
      results.uploaded.push(item);
      return;
    } catch (e) {
      if (attempt === 3) { results.failed.push({ ...item, error: e.message }); return; }
      await new Promise(r => setTimeout(r, 400 * attempt));
    }
  }
}

// Modest concurrency: enough to be quick, not enough to swamp a small server.
let cursor = 0;
async function worker() {
  while (cursor < items.length) {
    const item = items[cursor++];
    await handle(item);
    const done = results.uploaded.length + results.skipped.length + results.failed.length +
      results.mismatched.length + results.absent.length;
    if (done % 25 === 0 || done === items.length) process.stdout.write(`\r  ${done}/${items.length}`);
  }
}
await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
process.stdout.write("\n\n");

const verb = confirm ? "Uploaded" : "Would upload";
console.log(`  ${verb.padEnd(14)} ${results.uploaded.length}`);
console.log(`  ${"Already there".padEnd(14)} ${results.skipped.length} (verified by checksum)`);
console.log(`  ${"Absent".padEnd(14)} ${results.absent.length}`);
console.log(`  ${"Changed".padEnd(14)} ${results.mismatched.length} (checksum differs from the manifest)`);
console.log(`  ${"Failed".padEnd(14)} ${results.failed.length}`);

for (const f of results.failed) console.log(`      FAILED   ${f.key} — ${f.error}`);
for (const m of results.mismatched) console.log(`      CHANGED  ${m.key}`);
for (const a of results.absent) console.log(`      ABSENT   ${a.key}`);

const out = path.join(path.resolve(dumpDir), confirm ? "upload-report.txt" : "upload-dryrun.txt");
await fs.writeFile(out, [
  `SignFlow upload to ${cfg.bucket} — ${new Date().toISOString()}`,
  confirm ? "MODE: live" : "MODE: dry run (nothing written)",
  ``,
  `${verb}:     ${results.uploaded.length}`,
  `Already there: ${results.skipped.length}`,
  `Absent:        ${results.absent.length}`,
  `Changed:       ${results.mismatched.length}`,
  `Failed:        ${results.failed.length}`,
  ``,
  ...results.failed.map(f => `FAILED  ${f.key} — ${f.error}`),
  ...results.mismatched.map(m => `CHANGED ${m.key}`),
  ...results.absent.map(a => `ABSENT  ${a.key}`),
  ``,
  `The database was not modified. Nothing reads from the bucket yet.`,
  ``,
].join("\n"));
console.log(`\n  Written: ${out}\n`);

const clean = results.failed.length === 0 && results.mismatched.length === 0 && results.absent.length === 0;
process.exit(clean ? 0 : 2);
