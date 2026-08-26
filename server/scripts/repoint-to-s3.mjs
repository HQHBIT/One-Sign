// Repoints database columns from a bare filename to a bucket key, so reads come
// from object storage instead of the local disk.
//
//   node --env-file=.env scripts/repoint-to-s3.mjs --only-user <email>
//   node --env-file=.env scripts/repoint-to-s3.mjs --only-user <email> --confirm
//   node --env-file=.env scripts/repoint-to-s3.mjs --revert <rollback.json>
//
// This is the one step in the migration that changes production data, so every
// safeguard here is deliberate:
//
//   DRY RUN BY DEFAULT.        Nothing is written without --confirm.
//   SCOPED BY PERSON.          --only-user is required. There is no "all rows".
//   VERIFIED BEFORE REPOINTED. A column is only changed once the bucket object
//                              has been read back in full and its sha256 matched
//                              against the file still on disk. A row is never
//                              pointed at an object that has not been proven
//                              byte-identical.
//   REVERSIBLE.                Every change is written to a rollback file first,
//                              and --revert puts them all back.
//
// The disk copy is left in place, so even after repointing, readStored falls
// back to it if the bucket is unreachable.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.join(__dirname, "..", "uploads");

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };
const confirm = args.includes("--confirm");
const revertFile = flag("--revert");
const onlyUser = flag("--only-user");

const db = async () => mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "3306", 10),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "signflow",
});

// ---------- revert ----------
if (revertFile) {
  const plan = JSON.parse(await fs.readFile(path.resolve(revertFile), "utf8"));
  const conn = await db();
  let n = 0;
  for (const c of plan.changes) {
    const [r] = await conn.execute(
      `UPDATE \`${c.table}\` SET \`${c.column}\` = ? WHERE \`${c.pkColumn}\` = ? AND \`${c.column}\` = ?`,
      [c.oldValue, c.pk, c.newValue]);
    n += r.affectedRows;
  }
  await conn.end();
  console.log(`\n  Reverted ${n} of ${plan.changes.length} row(s) to their filenames.\n`);
  process.exit(0);
}

if (!onlyUser) {
  console.error("\n  --only-user <email> is required. This never runs across every row at once.\n");
  process.exit(1);
}

const bucket = (process.env.STORAGE_BUCKET || "").trim();
if (!bucket) { console.error("\n  STORAGE_BUCKET is not set.\n"); process.exit(1); }
const s3 = new S3Client({
  region: (process.env.STORAGE_REGION || "ap-south-1").trim(),
  endpoint: (process.env.STORAGE_ENDPOINT || "").trim().replace(/\/+$/, "") || undefined,
  forcePathStyle: String(process.env.STORAGE_FORCE_PATH_STYLE || "").trim() === "true",
  credentials: process.env.STORAGE_ACCESS_KEY
    ? { accessKeyId: process.env.STORAGE_ACCESS_KEY, secretAccessKey: process.env.STORAGE_SECRET_KEY }
    : undefined,
});

const conn = await db();
const [users] = await conn.execute(
  "SELECT id, name, email FROM users WHERE LOWER(email) = LOWER(?)", [onlyUser]);
if (!users.length) { console.error(`\n  No user with email ${onlyUser}.\n`); await conn.end(); process.exit(1); }
const u = users[0];
console.log(`\n  ${u.name} <${u.email}>`);
console.log(`  Bucket ${bucket}\n`);

// The same set the scoped upload moved, so every candidate has a bucket object.
const SETS = [
  { table: "requests", pkColumn: "id", where: "requestor_id = ?", p: [u.id],
    cols: { file_path: "documents", signed_file_path: "signed",
            applied_signature_path: "signatures", reject_voice_path: "voicenotes" } },
  { table: "users", pkColumn: "id", where: "id = ?", p: [u.id],
    cols: { signature_path: "signatures" } },
  { table: "user_signatures", pkColumn: "id", where: "user_id = ?", p: [u.id],
    cols: { file_path: "signatures", original_path: "signatures" } },
  { table: "request_step_signers", pkColumn: "id", where: "user_id = ?", p: [u.id],
    cols: { signature_path: "signatures" } },
];

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const changes = [], skipped = [], failed = [];

for (const set of SETS) {
  const cols = Object.keys(set.cols);
  const [rows] = await conn.execute(
    `SELECT \`${set.pkColumn}\` AS pk, ${cols.map(c => `\`${c}\``).join(", ")}
       FROM \`${set.table}\` WHERE ${set.where}`, set.p);

  for (const row of rows) {
    for (const col of cols) {
      const val = row[col];
      if (!val) continue;
      const area = set.cols[col];
      if (String(val).startsWith(area + "/")) { skipped.push({ ...row, col, why: "already a key" }); continue; }
      // A legacy Excel approval recorded a .json manifest, not a document.
      if (/\.json$/i.test(val)) { skipped.push({ pk: row.pk, col, why: "json manifest, not a file" }); continue; }

      const key = `${area}/${val}`;
      let onDisk = null;
      try { onDisk = await fs.readFile(path.join(UPLOADS, area, String(val))); }
      catch { skipped.push({ pk: row.pk, col, why: "not on disk" }); continue; }

      // The precondition: the bucket object must exist AND be byte-identical.
      try {
        const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const inBucket = Buffer.from(await got.Body.transformToByteArray());
        if (sha(inBucket) !== sha(onDisk)) {
          failed.push({ pk: row.pk, col, key, why: "bucket copy differs from disk" });
          continue;
        }
      } catch (e) {
        failed.push({ pk: row.pk, col, key, why: `not in bucket (${e.name || e.message})` });
        continue;
      }

      changes.push({ table: set.table, pkColumn: set.pkColumn, pk: row.pk, column: col,
                     oldValue: String(val), newValue: key });
    }
  }
}

console.log(`  ${changes.length} row(s) verified and ready to repoint`);
console.log(`  ${skipped.length} skipped, ${failed.length} not repointable\n`);
for (const f of failed.slice(0, 15)) console.log(`    NOT REPOINTED  ${f.table || ""} ${f.col} [${f.pk}] — ${f.why}`);
if (failed.length > 15) console.log(`    … and ${failed.length - 15} more`);

if (!confirm) {
  console.log("\n  DRY RUN — nothing written. Re-run with --confirm.\n");
  await conn.end();
  process.exit(0);
}

// Rollback recorded BEFORE anything changes, so an interrupted run is undoable.
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const rollback = path.resolve(`repoint-rollback-${stamp}.json`);
await fs.writeFile(rollback, JSON.stringify({ user: u.email, at: Date.now(), changes }, null, 2));
console.log(`  Rollback written first: ${rollback}`);

let done = 0;
for (const c of changes) {
  // The old value is part of the WHERE clause: if anything else changed this row
  // in the meantime, this update does nothing rather than overwriting it.
  const [r] = await conn.execute(
    `UPDATE \`${c.table}\` SET \`${c.column}\` = ? WHERE \`${c.pkColumn}\` = ? AND \`${c.column}\` = ?`,
    [c.newValue, c.pk, c.oldValue]);
  done += r.affectedRows;
}
await conn.end();

console.log(`  Repointed ${done} of ${changes.length} row(s).`);
console.log(`\n  Undo with:  node --env-file=.env scripts/repoint-to-s3.mjs --revert ${rollback}\n`);
process.exit(done === changes.length ? 0 : 2);
