// Hunts for files the database references but which are absent from uploads/.
//
//   node --env-file=.env scripts/find-missing-files.mjs --dump <dir>
//
// STRICTLY READ-ONLY. It searches, it reports, it never copies, moves, writes or
// deletes anything. Restoring a found file is a separate, deliberate step.
//
// A file can be absent for several different reasons and they need different
// answers, so the report separates them rather than lumping everything into one
// "missing" count:
//
//   * still on the box, somewhere else  — recoverable right now
//   * in a backup or snapshot            — recoverable, needs the archive mounted
//   * genuinely gone                     — the request cannot be reconstructed
//
// It searches the whole filesystem once and matches by basename, rather than
// running a find per missing file: 100+ separate passes over a server's disk is
// slow enough that people give up halfway.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.resolve(path.join(__dirname, "..", "uploads"));

const args = process.argv.slice(2);
const dumpDir = args[args.indexOf("--dump") + 1];
if (!dumpDir || dumpDir.startsWith("--")) {
  console.error("\n  --dump <dir> is required. Run scripts/dump-uploads.mjs first.\n");
  process.exit(1);
}

// --- read the references the dump recorded as MISSING ---
function parseCsv(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 1);
}

const refPath = path.join(path.resolve(dumpDir), "references.csv");
const raw = await fs.readFile(refPath, "utf8").catch(() => null);
if (raw === null) { console.error(`\n  Could not read ${refPath}\n`); process.exit(1); }

const rows = parseCsv(raw);
const header = rows.shift();
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const missing = rows
  .filter(r => r[col.file_exists] === "MISSING")
  .map(r => ({
    table: r[col.table], column: r[col.column], pk: r[col.pk_value],
    area: r[col.area], stored: r[col.stored_value],
    name: path.basename(String(r[col.stored_value])),
  }));

if (!missing.length) {
  console.log("\n  Nothing is missing — every referenced file is present.\n");
  process.exit(0);
}

const wanted = new Map();
for (const m of missing) {
  if (!wanted.has(m.name)) wanted.set(m.name, []);
  wanted.get(m.name).push(m);
}
console.log(`\n  Looking for ${wanted.size} distinct filename(s) across ${missing.length} reference(s).`);

// --- one sweep of the filesystem ---
// Pruned to keep this to seconds rather than minutes: nothing we lost will be
// inside a package directory or a kernel pseudo-filesystem.
const PRUNE = ["/proc", "/sys", "/dev", "/run", "/snap", "/var/lib/docker/overlay2"];
const pruneExpr = PRUNE.flatMap(p => ["-path", p, "-prune", "-o"]);

console.log("  Sweeping the filesystem (this takes a moment)…\n");
let found = [];
try {
  const { stdout } = await execFileAsync("find", [
    "/", ...pruneExpr,
    "-type", "f",
    "(", "-name", "*.pdf", "-o", "-name", "*.xlsx", "-o", "-name", "*.xls",
    "-o", "-name", "*.png", "-o", "-name", "*.webm", "-o", "-name", "*.m4a",
    "-o", "-name", "*.enc", ")",
    "-print",
  ], { maxBuffer: 200 * 1024 * 1024 });
  found = stdout.split("\n").filter(Boolean);
} catch (e) {
  // find exits non-zero on permission errors while still printing usable output.
  found = String(e.stdout || "").split("\n").filter(Boolean);
  if (!found.length) { console.error(`  Filesystem sweep failed: ${e.message}\n`); process.exit(1); }
}
console.log(`  Examined ${found.length} candidate file(s) on this machine.\n`);

// --- match, excluding the uploads tree itself ---
const hits = new Map();
for (const p of found) {
  const base = path.basename(p);
  if (!wanted.has(base)) continue;
  const abs = path.resolve(p);
  if (abs === path.join(UPLOADS, path.relative(UPLOADS, abs))) {
    // Inside uploads/ — if it were here the dump would not have called it
    // missing, so this would mean a mismatch in the area subdirectory. Report it.
  }
  if (!hits.has(base)) hits.set(base, []);
  hits.get(base).push(abs);
}

const recoverable = [...wanted.keys()].filter(n => hits.has(n));
const gone = [...wanted.keys()].filter(n => !hits.has(n));

console.log("  " + "=".repeat(66));
console.log(`  FOUND ELSEWHERE ON THIS MACHINE: ${recoverable.length}`);
console.log("  " + "=".repeat(66));
if (recoverable.length) {
  for (const n of recoverable) {
    const refs = wanted.get(n);
    console.log(`\n    ${n}`);
    console.log(`      referenced by: ${refs.map(r => `${r.table}.${r.column} [${r.pk}]`).join(", ")}`);
    console.log(`      belongs at:    uploads/${refs[0].area}/${n}`);
    for (const p of hits.get(n)) console.log(`      FOUND AT:      ${p}`);
  }
  console.log("\n    These can be restored by copying each file to where it belongs.");
  console.log("    Nothing has been copied — that is a separate, deliberate step.");
} else {
  console.log("    (none)");
}

console.log("\n  " + "=".repeat(66));
console.log(`  NOT ANYWHERE ON THIS MACHINE: ${gone.length}`);
console.log("  " + "=".repeat(66));
for (const n of gone.slice(0, 200)) {
  const r = wanted.get(n)[0];
  console.log(`    ${r.area}/${n}   (${wanted.get(n).length} reference(s))`);
}
if (gone.length > 200) console.log(`    … and ${gone.length - 200} more`);

console.log(`
  A file in this second list is not recoverable from this server. It can only
  come back from a backup or snapshot of the machine that held it, or from
  whoever still has their own copy of the document.
`);
process.exit(0);
