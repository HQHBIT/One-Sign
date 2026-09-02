// Which SignFlow instance on this box holds the real data?
//
//   node scripts/audit-instances.mjs
//
// STRICTLY READ-ONLY, and prints no credentials — only paths and counts.
//
// A box can end up running more than one copy of this application: an older
// checkout left behind by a manual install, and the one a deploy manages. They
// have separate .env files, so they can point at different databases and at
// different uploads directories entirely.
//
// That matters before a migration more than at any other time. The uploads
// folder and the database have to belong to the SAME instance, or files get
// copied for rows that do not reference them and the rows that do are left
// behind — with every step reporting success.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

// Parse an .env without importing it, so reading one instance's configuration
// cannot disturb the environment this script is running in.
function readEnv(file) {
  const out = {};
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

// Every plausible checkout: the standard location plus anything alongside it.
const HOME = process.env.HOME || "/home/ubuntu";
const candidates = new Set([path.join(HOME, "OneSign", "server")]);
try {
  for (const d of fs.readdirSync(HOME, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = path.join(HOME, d.name, "server");
    if (fs.existsSync(path.join(p, ".env"))) candidates.add(p);
  }
} catch { /* an unreadable home directory is not fatal */ }

const countFiles = async (dir) => {
  let n = 0, bytes = 0;
  const walk = async (d) => {
    let entries = [];
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else {
        n++;
        try { bytes += (await fsp.stat(full)).size; } catch { /* ignore */ }
      }
    }
  };
  await walk(dir);
  return { n, mb: (bytes / 1048576).toFixed(1) };
};

console.log("");
for (const dir of candidates) {
  console.log("  " + "=".repeat(72));
  console.log(`  ${dir}`);
  const env = readEnv(path.join(dir, ".env"));
  if (!env) { console.log("    no .env — not a configured instance"); continue; }

  // Configuration facts that are not secrets: which port it serves, which
  // organisation it declares, whether a bucket is configured at all.
  console.log(`    PORT=${env.PORT || "(unset)"}   ORG_SLUG=${env.ORG_SLUG || "(unset)"}` +
    `   bucket=${env.STORAGE_BUCKET ? "configured" : "NOT configured"}`);

  const up = await countFiles(path.join(dir, "uploads"));
  console.log(`    uploads/: ${up.n} file(s), ${up.mb} MB`);

  try {
    const c = await mysql.createConnection({
      host: env.DB_HOST || "localhost",
      port: parseInt(env.DB_PORT || "3306", 10),
      user: env.DB_USER || "root",
      password: env.DB_PASSWORD || "",
      database: env.DB_NAME || "signflow",
    });
    const one = async (sql) => (await c.execute(sql))[0][0].n;
    const users = await one("SELECT COUNT(*) AS n FROM users");
    const reqs = await one("SELECT COUNT(*) AS n FROM requests");
    const teams = await one("SELECT COUNT(*) AS n FROM teams");
    // The migration question in one number: how many rows still point at a bare
    // filename rather than a bucket key.
    const bare = await one(
      "SELECT COUNT(*) AS n FROM requests WHERE file_path IS NOT NULL AND file_path NOT LIKE '%/%'");
    console.log(`    database: ${users} user(s), ${teams} team(s), ${reqs} request(s)`);
    console.log(`    rows still pointing at a bare filename (need repointing): ${bare}`);
    await c.end();
  } catch (e) {
    console.log(`    database: UNREACHABLE with this instance's .env (${e.code || e.message})`);
  }
}
console.log("  " + "=".repeat(72));
console.log("");
process.exit(0);
