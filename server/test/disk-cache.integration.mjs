// Disk copies the bucket already holds — pruneDiskCopies().
//
//   node test/disk-cache.integration.mjs      (from server/, MySQL running)
//
// Runs in-process against a fake S3. Verifies a disk copy is removed only when
// the bucket holds identical bytes, no row reads it by bare filename, and it is
// over an hour old; that a dry run removes nothing; and that a removed file is
// still served — from the bucket.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import { startFakeS3 } from "./support/fake-s3.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(HERE, "..", ".env") });
const s3 = await startFakeS3();
Object.assign(process.env, {
  STORAGE_ENDPOINT: s3.endpoint, STORAGE_BUCKET: s3.bucket, STORAGE_REGION: "ap-south-1",
  STORAGE_ACCESS_KEY: "test", STORAGE_SECRET_KEY: "test", STORAGE_FORCE_PATH_STYLE: "true",
});
const { initDb, execute } = await import("../src/db.js");
const storage = await import("../src/storage.js");
const { diskPathFor, readStored } = await import("../src/filestore.js");
const { pruneDiskCopies } = await import("../src/diskCache.js");
await initDb();

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);
const T = Date.now().toString(36);
const U = `u_dc_${T}`;
const name = (k) => `dc_${k}_${T}.pdf`;
const bytes = (k) => Buffer.from(`%PDF-1.4 disk-cache ${k} ${T}\n`);
const exists = (p) => fs.access(p).then(() => true, () => false);
const OLD = new Date(Date.now() - 3 * 3600_000);

// k → { bucket: what the bucket holds (null = nothing), recent }
const CASES = {
  verified:   { bucket: "same" },
  diskOnly:   { bucket: "same" },          // a row reads it by bare name
  notInBucket:{ bucket: null },
  differs:    { bucket: "other" },
  recent:     { bucket: "same", recent: true },
};

try {
  ck(storage.isEnabled(), "fake bucket configured");
  for (const [k, c] of Object.entries(CASES)) {
    const p = diskPathFor("documents", name(k));
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, bytes(k));
    if (!c.recent) await fs.utimes(p, OLD, OLD);
    if (c.bucket === "same") await storage.putAt(`documents/${name(k)}`, bytes(k), "application/pdf");
    if (c.bucket === "other") await storage.putAt(`documents/${name(k)}`, Buffer.from("something else"), "application/pdf");
  }
  await execute(
    "INSERT INTO users (id, email, password_hash, name, role, signature_path, created_at, active, org_id) VALUES (?,?,?,?, 'requestor', ?, ?, 1, 'hqhb')",
    [U, `${U}@dc.test`, bcrypt.hashSync("x", 4), "DC", name("diskOnly"), Date.now()]);

  const dry = await pruneDiskCopies({ dryRun: true });
  ck(dry.removed >= 1 && await exists(diskPathFor("documents", name("verified"))), `a dry run reports but removes nothing (${dry.removed} would go)`);

  const r = await pruneDiskCopies();
  const still = async (k) => exists(diskPathFor("documents", name(k)));
  ck(!(await still("verified")), "removed: identical in the bucket, over an hour old, no row reads it from disk");
  ck(await still("diskOnly"), "kept: a row refers to it by bare filename (read from disk only)");
  ck(await still("notInBucket"), "kept: the bucket does not have it");
  ck(await still("differs"), "kept: the bucket's copy is different");
  ck(await still("recent"), "kept: written less than an hour ago");
  ck(r.errors === 0 && r.freedBytes >= bytes("verified").length, `summary is sane (${JSON.stringify(r)})`);

  const served = await readStored("documents", `documents/${name("verified")}`);
  ck(served.equals(bytes("verified")), "the removed copy is still served, from the bucket");
} catch (e) {
  fail.push(`the run stopped early: ${e?.stack || e}`);
} finally {
  for (const k of Object.keys(CASES)) await fs.unlink(diskPathFor("documents", name(k))).catch(() => {});
  await execute("DELETE FROM users WHERE id = ?", [U]).catch(() => {});
  await s3.close?.();
  for (const p of pass) console.log("  PASS  " + p);
  for (const f of fail) console.log("  FAIL  " + f);
  console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
  process.exit(fail.length ? 1 : 0);
}
