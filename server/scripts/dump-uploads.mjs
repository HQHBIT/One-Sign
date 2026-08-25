// Inventories every stored file on this server and pairs it with the database
// rows that point at it, so the tree can be uploaded to S3 and the columns
// repointed afterwards without re-deriving anything.
//
//   node --env-file=.env scripts/dump-uploads.mjs               inventory only
//   node --env-file=.env scripts/dump-uploads.mjs --archive     also write a .tar.gz
//   node --env-file=.env scripts/dump-uploads.mjs --out DIR     where to write (default ./dump-<stamp>)
//
// STRICTLY READ-ONLY. It opens its own connection rather than calling initDb(),
// which would run the schema DDL and the seed — neither belongs in a dump. It
// issues SELECTs only, and never opens a file for writing inside uploads/.
//
// Output:
//   manifest.csv    one row per FILE on disk — this is the upload list
//   references.csv  one row per DB REFERENCE — this is what drives the later UPDATEs
//   report.txt      counts, orphans, missing files
//
// S3 keys mirror the directory layout exactly (`documents/<name>`), so the
// value already in each column IS the key suffix. That keeps the eventual
// schema change a concatenation rather than a lookup table.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import mysql from "mysql2/promise";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.join(__dirname, "..", "uploads");
const AREAS = ["documents", "signed", "signatures", "voicenotes"];
const MAGIC = 0xc1; // confidential.js envelope marker — byte 0 of an encrypted file

// Every column in the schema that names a stored file, and the area it lives in.
const REFS = [
  { table: "requests",             pk: "id", column: "file_path",              area: "documents"  },
  { table: "requests",             pk: "id", column: "signed_file_path",       area: "signed"     },
  { table: "requests",             pk: "id", column: "applied_signature_path", area: "signatures" },
  { table: "requests",             pk: "id", column: "reject_voice_path",      area: "voicenotes" },
  { table: "users",                pk: "id", column: "signature_path",         area: "signatures" },
  { table: "user_signatures",      pk: "id", column: "file_path",              area: "signatures" },
  { table: "user_signatures",      pk: "id", column: "original_path",          area: "signatures" },
  { table: "request_step_signers", pk: "id", column: "signature_path",         area: "signatures" }
];

const args = process.argv.slice(2);
const wantArchive = args.includes("--archive");
const outFlag = args.indexOf("--out");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = outFlag !== -1 && args[outFlag + 1]
  ? path.resolve(args[outFlag + 1])
  : path.resolve(`dump-${stamp}`);

const csvCell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

// ---- connect (read-only; same env vars the server uses) ----
const {
  DB_HOST = "localhost", DB_PORT = "3306", DB_USER = "root",
  DB_PASSWORD = "", DB_NAME = "signflow", DB_SOCKET_PATH = ""
} = process.env;

const conn = await mysql.createConnection({
  user: DB_USER, password: DB_PASSWORD, database: DB_NAME, charset: "utf8mb4",
  ...(DB_SOCKET_PATH ? { socketPath: DB_SOCKET_PATH } : { host: DB_HOST, port: parseInt(DB_PORT, 10) })
});

// ---- 1. walk the disk ----
// Keyed "<area>/<name>" — the same string used as the S3 key, so disk and
// database are compared in the one namespace neither can disagree about.
const onDisk = new Map();
for (const area of AREAS) {
  const dir = path.join(UPLOADS, area);
  let names = [];
  try { names = await fs.readdir(dir); }
  catch (e) { if (e.code !== "ENOENT") throw e; continue; }
  for (const name of names) {
    // .gitkeep and friends hold the empty directories open in git. They are not
    // user data and must not become S3 objects.
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const st = await fs.stat(full);
    if (!st.isFile()) continue;
    // Hashed so the S3 copy can be proven byte-identical after upload.
    const bytes = await fs.readFile(full);
    onDisk.set(`${area}/${name}`, {
      area, name, bytes: st.size,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      encrypted: bytes.length > 0 && bytes[0] === MAGIC,
      refs: 0
    });
  }
}

// ---- 2. collect every database reference ----
const references = [];
const missing = [];
for (const r of REFS) {
  const [rows] = await conn.execute(
    `SELECT \`${r.pk}\` AS pk, \`${r.column}\` AS val FROM \`${r.table}\` WHERE \`${r.column}\` IS NOT NULL AND \`${r.column}\` <> ''`
  );
  for (const row of rows) {
    // Legacy Excel approvals recorded a ".signed.json" manifest instead of a
    // document (see requests.js:754). It is a database artefact, not a file.
    const isJsonManifest = r.column === "signed_file_path" && /\.json$/i.test(row.val);
    const key = `${r.area}/${row.val}`;
    const hit = onDisk.get(key);
    if (hit) hit.refs++;
    else if (!isJsonManifest) missing.push({ ...r, pk: row.pk, val: row.val, key });
    references.push({
      table: r.table, pk_column: r.pk, pk_value: row.pk, column: r.column,
      stored_value: row.val, area: r.area,
      s3_key: isJsonManifest ? "" : key,
      file_exists: hit ? "yes" : (isJsonManifest ? "n/a-json-manifest" : "MISSING"),
      bytes: hit?.bytes ?? "", sha256: hit?.sha256 ?? "",
      encrypted: hit ? (hit.encrypted ? "yes" : "no") : ""
    });
  }
}
await conn.end();

// ---- 3. write the output ----
await fs.mkdir(OUT, { recursive: true });
const files = [...onDisk.values()].sort((a, b) => (a.area + a.name).localeCompare(b.area + b.name));
const orphans = files.filter((f) => f.refs === 0);

await fs.writeFile(path.join(OUT, "manifest.csv"), csv([
  ["s3_key", "area", "file_name", "bytes", "sha256", "encrypted", "db_references"],
  ...files.map((f) => [`${f.area}/${f.name}`, f.area, f.name, f.bytes, f.sha256, f.encrypted ? "yes" : "no", f.refs])
]));

await fs.writeFile(path.join(OUT, "references.csv"), csv([
  ["table", "pk_column", "pk_value", "column", "stored_value", "area", "s3_key", "file_exists", "bytes", "sha256", "encrypted"],
  ...references.map((r) => [r.table, r.pk_column, r.pk_value, r.column, r.stored_value, r.area, r.s3_key, r.file_exists, r.bytes, r.sha256, r.encrypted])
]));

const byArea = (list) => AREAS.map((a) => `    ${a.padEnd(12)} ${list.filter((f) => f.area === a).length}`).join("\n");
const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
const report = `SignFlow upload inventory — ${stamp}
Database: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}
Source:   ${UPLOADS}

FILES ON DISK: ${files.length} (${(totalBytes / 1048576).toFixed(1)} MB)
${byArea(files)}
    encrypted (confidential)  ${files.filter((f) => f.encrypted).length}

DATABASE REFERENCES: ${references.length}

ORPHANS — on disk, referenced by no row: ${orphans.length}
${byArea(orphans)}
${orphans.length ? orphans.map((f) => `    ${f.area}/${f.name}`).join("\n") : "    (none)"}

MISSING — referenced by a row, absent from disk: ${missing.length}
${missing.length ? missing.map((m) => `    ${m.table}.${m.column} [${m.pk}] -> ${m.key}`).join("\n") : "    (none)"}

Upload every key in manifest.csv to the bucket at that exact path.
Verify with the sha256 column before repointing anything.
`;
await fs.writeFile(path.join(OUT, "report.txt"), report);

// ---- 4. optional archive ----
// The CSVs are already on disk, so a tar failure costs nothing but the tarball —
// report it and still print the inventory rather than dying on the last step.
// --force-local: without it GNU tar reads the "C:" in a Windows output path as a
// remote host. Harmless on Linux, where the paths have no colons.
if (wantArchive) {
  const tarball = path.join(OUT, `uploads-${stamp}.tar.gz`);
  try {
    await execFileAsync("tar", ["-czf", tarball, "--force-local", "--exclude=.gitkeep", "-C", path.join(UPLOADS, ".."), "uploads"]);
    const st = await fs.stat(tarball);
    console.log(`\n  Archive: ${tarball} (${(st.size / 1048576).toFixed(1)} MB)`);
  } catch (e) {
    console.error(`\n  Archive FAILED (inventory below is still valid): ${e.message.split("\n")[0]}`);
  }
}

console.log(report);
console.log(`  Written to ${OUT}\n`);
