// ============================================================
//   DISK COPIES THE BUCKET ALREADY HOLDS
//   ------------------------------------------------------------
//   writeStored() saves every file to disk AND to the bucket, and readStored()
//   reads a bucket key from the bucket first, falling back to disk only if the
//   bucket fails. Once a file is safely in the bucket its disk copy is a
//   duplicate — and on HQHB those duplicates filled the 6.7 GB root disk.
//
//   This pass removes a disk copy only when ALL of these hold:
//     · the bucket has an object at the same key whose bytes are IDENTICAL
//       (downloaded and compared, not assumed);
//     · no database row refers to the file by its bare filename — a bare value
//       is read from disk only (filestore.isKey), so its copy must stay;
//     · the file is more than an hour old, so nothing being written right now
//       is touched.
//   Everything else stays. Nothing is ever removed from the bucket here, and
//   bucket versioning keeps earlier versions besides.
// ============================================================
import fs from "node:fs/promises";
import path from "node:path";
import { query } from "./db.js";
import { diskPathFor, AREAS } from "./filestore.js";
import * as storage from "./storage.js";

// Every column that names a stored file.
const COLUMNS = [
  ["requests", ["file_path", "signed_file_path", "applied_signature_path", "reject_voice_path"]],
  ["request_attachments", ["file_path", "signed_file_path"]],
  ["request_step_signers", ["signature_path"]],
  ["users", ["signature_path"]],
  ["user_signatures", ["file_path", "original_path"]],
  ["ea_documents", ["file_path"]],
  ["shz_forwards", ["manzuri_file_path"]],
];
const MIN_AGE_MS = 60 * 60_000;

// Filenames some row still reads from disk (a value with no area prefix).
async function diskOnlyNames() {
  const names = new Set();
  for (const [table, cols] of COLUMNS) {
    for (const col of cols) {
      let rows = [];
      try { rows = await query(`SELECT ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL AND ${col} <> ''`); }
      catch { continue; } // a table/column missing on this box — nothing to protect there
      for (const { v } of rows) {
        const s = String(v);
        if (!AREAS.some(a => s.startsWith(a + "/"))) names.add(path.basename(s));
      }
    }
  }
  return names;
}

/** One pass. Returns what it did; `dryRun` reports without deleting. */
export async function pruneDiskCopies({ dryRun = false, now = Date.now() } = {}) {
  const out = { checked: 0, removed: 0, freedBytes: 0, keptDiskOnly: 0, keptNotInBucket: 0, keptRecent: 0, errors: 0 };
  if (!storage.isEnabled()) return { ...out, skipped: "no bucket configured" };
  const protect = await diskOnlyNames();

  for (const area of AREAS) {
    const dir = path.dirname(diskPathFor(area, "x"));
    let names = [];
    try { names = await fs.readdir(dir); } catch { continue; }
    for (const name of names) {
      const full = path.join(dir, name);
      try {
        const st = await fs.stat(full);
        if (!st.isFile()) continue;
        out.checked++;
        if (protect.has(name)) { out.keptDiskOnly++; continue; }
        if (now - st.mtimeMs < MIN_AGE_MS) { out.keptRecent++; continue; }
        let remote;
        try { remote = await storage.getFileBytes(`${area}/${name}`); }
        catch (e) {
          if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) { out.keptNotInBucket++; continue; }
          throw e;
        }
        const local = await fs.readFile(full);
        if (Buffer.compare(local, remote) !== 0) { out.keptNotInBucket++; continue; }
        if (!dryRun) await fs.unlink(full);
        out.removed++;
        out.freedBytes += st.size;
      } catch (e) {
        out.errors++;
        console.warn(`[disk-cache] ${area}/${name}: ${e?.message}`);
      }
    }
  }
  return out;
}

export function startDiskCachePruning({ everyMs = 6 * 3600_000 } = {}) {
  if (String(process.env.DISK_CACHE_PRUNE || "true").toLowerCase() === "false") return;
  const run = async () => {
    try {
      const r = await pruneDiskCopies();
      console.log(`[disk-cache] ${r.skipped || `removed ${r.removed} disk copies verified in the bucket (${(r.freedBytes / 1048576).toFixed(0)} MB); kept ${r.keptDiskOnly} disk-only, ${r.keptNotInBucket} not in bucket, ${r.keptRecent} recent; ${r.errors} errors`}`);
    } catch (e) { console.error("[disk-cache]", e.message); }
  };
  setTimeout(run, 3 * 60_000); // after boot settles
  setInterval(run, everyMs);
}
