// Integration: the multi-organisation migration.
// Runs the real initDb() against the configured database and asserts the
// resulting schema and seed data. Idempotent — safe to run repeatedly, which is
// itself part of what it checks, since migrations run on every boot.
import "dotenv/config";
import assert from "node:assert/strict";
import { initDb, query, queryOne, listOrganisations, getOrganisation } from "../src/db.js";

await initDb();

// ---- organisations exist and are shaped right ----
{
  const orgs = await listOrganisations();
  const ids = orgs.map(o => o.id);
  assert.ok(ids.includes("hqhb"), "HQHB is seeded");
  assert.ok(ids.includes("waqf"), "WAQF is seeded");

  const hqhb = await getOrganisation("hqhb");
  assert.equal(hqhb.name, "HQHB");
  assert.equal(hqhb.allowOneAccess, true, "HQHB may use oneAccess");
  assert.equal(hqhb.allowLocal, true, "HQHB may use local login");

  const waqf = await getOrganisation("waqf");
  assert.equal(waqf.name, "WAQF Department");
  assert.equal(waqf.allowOneAccess, false, "WAQF must never offer SSO");
  assert.equal(waqf.allowLocal, true, "WAQF signs in with a password");

  assert.equal(await getOrganisation("nope"), null, "unknown slug resolves to null");
  assert.equal(await getOrganisation(""), null, "empty slug resolves to null");
}

// ---- each organisation knows the address its own people reach it at ----
// Backfilled rather than seeded, because the rows already exist on every box
// that has run before — an INSERT IGNORE would have skipped them and left the
// column null, which is exactly the state that sent WAQF's mail to HQHB.
{
  const urls = Object.fromEntries(
    (await query("SELECT id, app_url FROM organisations")).map(r => [r.id, r.app_url]));
  assert.equal(urls.hqhb, "https://signflow.umooriqtesadiyah.org", "HQHB's address is set");
  assert.equal(urls.waqf, "https://signflow.waqftrust.com", "WAQF's address is set");

  // The backfill is guarded on empty so a hand-set address survives a reboot.
  await query("UPDATE organisations SET app_url = 'https://example.invalid' WHERE id = 'waqf'");
  await initDb();
  const after = await queryOne("SELECT app_url FROM organisations WHERE id = 'waqf'");
  assert.equal(after.app_url, "https://example.invalid", "a hand-set address is not overwritten on boot");
  await query("UPDATE organisations SET app_url = 'https://signflow.waqftrust.com' WHERE id = 'waqf'");
}

// ---- columns were added, and everything pre-existing became HQHB ----
{
  const cols = async (table) =>
    (await query(
      `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]
    )).map(r => r.c);

  const userCols = await cols("users");
  assert.ok(userCols.includes("org_id"), "users.org_id added");
  assert.ok(userCols.includes("is_global"), "users.is_global added");
  assert.ok((await cols("teams")).includes("org_id"), "teams.org_id added");
  assert.ok((await cols("requests")).includes("org_id"), "requests.org_id added");

  for (const t of ["users", "teams", "requests"]) {
    const orphan = await queryOne(
      `SELECT COUNT(*) AS n FROM \`${t}\` WHERE org_id IS NULL OR org_id = ''`);
    assert.equal(Number(orphan.n), 0, `no ${t} row left without an organisation`);
  }
  const strays = await queryOne(
    `SELECT COUNT(*) AS n FROM users WHERE org_id NOT IN (SELECT id FROM organisations)`);
  assert.equal(Number(strays.n), 0, "every user points at a real organisation");
}

// ---- a team name is unique per organisation, not globally ----
{
  const idx = await query(
    `SELECT INDEX_NAME AS i, COLUMN_NAME AS c, NON_UNIQUE AS nu, SEQ_IN_INDEX AS s
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teams'
      ORDER BY INDEX_NAME, SEQ_IN_INDEX`);

  const composite = idx.filter(r => r.i === "uq_teams_org_name");
  assert.equal(composite.length, 2, "uq_teams_org_name spans two columns");
  assert.equal(Number(composite[0].nu), 0, "and it is unique");
  assert.deepEqual(composite.map(r => r.c), ["org_id", "name"], "on (org_id, name)");

  // The old global unique on name alone must be gone, or the second
  // organisation could never have its own "IT".
  const soleName = idx.filter(r => r.c === "name" && Number(r.nu) === 0 &&
    idx.filter(x => x.i === r.i).length === 1);
  assert.equal(soleName.length, 0, "the global UNIQUE(name) has been dropped");
}

// ---- the same team name is genuinely insertable twice, once per org ----
{
  const name = "__migration_probe_dept";
  await query("DELETE FROM teams WHERE name = ?", [name]);
  await query("INSERT INTO teams (id, name, org_id, created_at) VALUES (?, ?, 'hqhb', ?)",
    [`probe_h_${Date.now()}`, name, Date.now()]);
  await query("INSERT INTO teams (id, name, org_id, created_at) VALUES (?, ?, 'waqf', ?)",
    [`probe_w_${Date.now()}`, name, Date.now()]);

  const both = await queryOne("SELECT COUNT(*) AS n FROM teams WHERE name = ?", [name]);
  assert.equal(Number(both.n), 2, "the same department name exists in both organisations");

  // ...but still cannot be duplicated WITHIN one organisation.
  let rejected = false;
  try {
    await query("INSERT INTO teams (id, name, org_id, created_at) VALUES (?, ?, 'hqhb', ?)",
      [`probe_dup_${Date.now()}`, name, Date.now()]);
  } catch (e) { rejected = e?.code === "ER_DUP_ENTRY"; }
  assert.ok(rejected, "a duplicate name within one organisation is still refused");

  await query("DELETE FROM teams WHERE name = ?", [name]);
}

// ---- hydrateUser surfaces the organisation ----
{
  const row = await queryOne("SELECT * FROM users LIMIT 1");
  if (row) {
    const { hydrateUser } = await import("../src/db.js");
    const u = await hydrateUser(row);
    assert.equal(typeof u.orgId, "string", "hydrated user carries orgId");
    assert.ok(u.orgId.length > 0, "and it is not empty");
    assert.equal(typeof u.isGlobal, "boolean", "hydrated user carries isGlobal");
  } else {
    console.log("  (no users in this database — skipped hydrateUser check)");
  }
}

console.log("organisations migration: all tests passed");
process.exit(0);
