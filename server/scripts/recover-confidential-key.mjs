// Is the key that opens the older confidential documents still on this box?
//
//   node --env-file=.env scripts/recover-confidential-key.mjs
//
// STRICTLY READ-ONLY. It writes nothing and changes nothing.
//
// Context: audit-confidential.mjs established that no derivation of the CURRENT
// CONFIDENTIAL_KEY opens the documents sealed before today. The secret itself
// changed. Only the previous value opens them, and nothing else ever will.
//
// That value is very likely still on the machine. A box keeps stale copies of
// its own environment in more places than anyone intends: pm2 records the
// environment a process was STARTED with and keeps it in its dump file, and a
// deploy that rewrites .env usually leaves the previous file beside it.
//
// EVERY CANDIDATE IS TESTED, NEVER PRINTED. This repository is public and so are
// its Actions logs, so the output carries the source file and the verdict and
// nothing else: no value, no length, not even a digest. Knowing WHICH file holds
// the working key is enough — a human copies it from there.
import "dotenv/config";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { looksEncrypted } from "../src/confidential.js";
import { diskPathFor } from "../src/filestore.js";

const rule = "  " + "-".repeat(78);

// ---- a document that is actually failing, to test candidates against ----
const conn = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "3306", 10),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "signflow",
});
const [rows] = await conn.execute(
  `SELECT file_path FROM requests WHERE confidential = 1 ORDER BY created_at ASC`);
await conn.end();

const liveKey = crypto.scryptSync(
  (process.env.CONFIDENTIAL_KEY || "").trim(),
  Buffer.from("signflow.confidential.v1"), 32, { N: 16384, r: 8, p: 1 });

// Pick a document the CURRENT key cannot open — testing against one that already
// works would say nothing.
let sample = null;
for (const r of rows) {
  let bytes;
  try { bytes = await fs.readFile(diskPathFor("documents", r.file_path)); } catch { continue; }
  if (!looksEncrypted(bytes)) continue;
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", liveKey, bytes.subarray(3, 15));
    d.setAuthTag(bytes.subarray(bytes.length - 16));
    Buffer.concat([d.update(bytes.subarray(15, bytes.length - 16)), d.final()]);
  } catch {
    sample = bytes;   // this one fails under the live key — exactly what we want
    break;
  }
}

if (!sample) {
  console.log("\n  Every confidential document already opens under the current key.");
  console.log("  Nothing to recover.\n");
  process.exit(0);
}

// ---- collect candidates ----
// Shallow on purpose: an environment file that matters sits at a known depth,
// and walking a whole home directory on a live box is not a diagnostic.
const home = process.env.HOME || "/home/ubuntu";
const roots = [`${home}/OneSign`, `${home}/OneSign/server`, `${home}/.pm2`, home];

const files = new Set();
for (const dir of roots) {
  let names = [];
  try { names = await fs.readdir(dir); } catch { continue; }
  for (const n of names) {
    if (/^\.env/.test(n) || /^dump\.pm2/.test(n) || /^ecosystem\./.test(n)) {
      files.add(`${dir}/${n}`);
    }
  }
}

// Both spellings: KEY=value in an env file, "KEY": "value" in pm2's JSON dump.
const found = [];
for (const f of [...files].sort()) {
  let text;
  try { text = await fs.readFile(f, "utf8"); } catch { continue; }
  const re = /CONFIDENTIAL_KEY["']?\s*[:=]\s*["']?([^"'\r\n]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const v = m[1].replace(/^﻿/, "").replace(/^["']|["']$/g, "").trim();
    if (v) found.push({ from: f, value: v });
  }
}

// ---- test them ----
const iv = sample.subarray(3, 15);
const tag = sample.subarray(sample.length - 16);
const body = sample.subarray(15, sample.length - 16);
const opens = (k) => {
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", k, iv);
    d.setAuthTag(tag);
    Buffer.concat([d.update(body), d.final()]);
    return true;
  } catch { return false; }
};

console.log("\n  Does any copy of the secret on this box open the older documents?");
console.log(rule);

const live = (process.env.CONFIDENTIAL_KEY || "").trim();
let recovered = null;
const seen = new Set();

for (const { from, value } of found) {
  if (seen.has(value)) continue;   // the same value in three files is one candidate
  seen.add(value);
  const note = value === live ? "   (this is the one in use)" : "";
  const b64 = Buffer.from(value, "base64");
  // Both schemes this feature has ever used, since an older value may predate
  // the switch to a derived key.
  const tries = [
    ["derived", crypto.scryptSync(value, Buffer.from("signflow.confidential.v1"), 32, { N: 16384, r: 8, p: 1 })],
    ["verbatim base64", b64.length === 32 ? b64 : null],
  ];
  const hit = tries.find(([, k]) => k && opens(k));
  if (hit) {
    console.log(`    OPENS   ${from}   (as ${hit[0]})${note}`);
    recovered = recovered || { from, how: hit[0] };
  } else {
    console.log(`    no      ${from}${note}`);
  }
}

if (!found.length) {
  console.log("    no CONFIDENTIAL_KEY found in any environment file or pm2 dump");
}

console.log("\n" + rule);
if (recovered) {
  console.log(`  RECOVERED. The key that opens these documents is in ${recovered.from},`);
  console.log(`  under CONFIDENTIAL_KEY, used as a ${recovered.how} key. Its value is`);
  console.log("  deliberately not printed. Copy it out of that file by hand and set it as the");
  console.log("  CONFIDENTIAL_KEY repository secret, so the next deploy stops overwriting it.");
} else if (found.length) {
  console.log("  Not on this machine. Every copy of the secret still present here is the");
  console.log("  current one. The previous value has to come from wherever it was first set");
  console.log("  — a password manager, the shell history of whoever configured the box, or a");
  console.log("  snapshot of the instance taken before it was overwritten.");
}
console.log("");
process.exit(0);
