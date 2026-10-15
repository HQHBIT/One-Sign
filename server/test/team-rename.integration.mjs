// Renaming a team.
//
//   node test/team-rename.integration.mjs      (from server/, MySQL running)
//
// Verifies: an admin can rename; a non-admin cannot; the name must not be
// blank; a clash inside the same organisation is refused but the same name in
// the OTHER organisation is fine; the HOD team is refused because the Shz Saab
// dashboard finds it by name; and a rename leaves members and approvers alone,
// because everything else points at the team by id.
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..");
config({ path: path.join(SERVER, ".env") });

const PORT = 5000 + 210 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;
const { initDb, execute, query, queryOne } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
await initDb();

function startApi(port, env) {
  const c = spawn(process.execPath, ["src/index.js"], { cwd: SERVER, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), SENDGRID_API_KEY: "", STORAGE_BUCKET: "", ...env } });
  c.log = ""; c.stdout.on("data", d => (c.log += d)); c.stderr.on("data", d => (c.log += d));
  return c;
}
async function waitFor(base, child) {
  for (let i = 0; i < 180; i++) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {} await new Promise(r => setTimeout(r, 500)); }
  console.log(child.log); throw new Error("API did not start");
}

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);
const T = Date.now().toString(36), now = Date.now();
const ADMIN = `u_tr_adm_${T}`, PLAIN = `u_tr_usr_${T}`, APPROVER = `u_tr_app_${T}`;
const TEAM = `t_tr_${T}`, OTHER = `t_tr_o_${T}`, HOD = `t_tr_hod_${T}`, WAQF = `t_tr_w_${T}`;
const hdr = (id) => ({ Authorization: "Bearer " + signToken(id), "Content-Type": "application/json" });
const j = async r => { try { return await r.json(); } catch { return {}; } };
const rename = (teamId, who, name) =>
  fetch(`${BASE}/api/teams/${teamId}`, { method: "PATCH", headers: hdr(who), body: JSON.stringify({ name }) });

const cleanup = async () => {
  await execute("DELETE FROM signing_authority WHERE team_id IN (?,?,?,?)", [TEAM, OTHER, HOD, WAQF]).catch(() => {});
  await execute("UPDATE users SET team_id = NULL WHERE id IN (?,?,?)", [ADMIN, PLAIN, APPROVER]).catch(() => {});
  await execute("DELETE FROM users WHERE id IN (?,?,?)", [ADMIN, PLAIN, APPROVER]).catch(() => {});
  await execute("DELETE FROM teams WHERE id IN (?,?,?,?)", [TEAM, OTHER, HOD, WAQF]).catch(() => {});
};

let api = null;
try {
  await cleanup();
  const mkTeam = (id, nm, org) => execute("INSERT INTO teams (id, name, created_at, org_id) VALUES (?,?,?,?)", [id, nm, now, org]);
  await mkTeam(TEAM, `Partenrship Department ${T}`, "hqhb");
  await mkTeam(OTHER, `Finance ${T}`, "hqhb");
  await mkTeam(HOD, "HOD", "hqhb");
  await mkTeam(WAQF, `Finance ${T}`, "waqf");   // same name, other organisation — allowed

  const mkUser = (id, nm, role, team) => execute(
    "INSERT INTO users (id,email,password_hash,name,role,team_id,created_at,active,org_id) VALUES (?,?,?,?,?,?,?,1,'hqhb')",
    [id, `${id}@hqhb.test`, bcrypt.hashSync("x", 4), nm, role, team, now]);
  await mkUser(ADMIN, "Admin", "admin", null);
  await mkUser(PLAIN, "Plain Requestor", "requestor", null);
  await mkUser(APPROVER, "Team Approver", "approver", TEAM);
  await execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?,?)", [APPROVER, TEAM]);

  api = startApi(PORT, { ORG_SLUG: "hqhb" });
  await waitFor(BASE, api);

  // 1. The typo is fixed.
  const ok = await rename(TEAM, ADMIN, `Partnership Department ${T}`);
  ck(ok.status === 200, `an admin renames a team (got ${ok.status})`);
  const row = await queryOne("SELECT name FROM teams WHERE id = ?", [TEAM]);
  ck(row?.name === `Partnership Department ${T}`, `the new name is stored (got ${JSON.stringify(row?.name)})`);

  // 2. Members and approvers are untouched — they point at the id.
  const [auth] = await query("SELECT COUNT(*) AS n FROM signing_authority WHERE team_id = ?", [TEAM]);
  const [mem] = await query("SELECT COUNT(*) AS n FROM users WHERE team_id = ?", [TEAM]);
  ck(Number(auth.n) === 1 && Number(mem.n) === 1, "the approver and the member survive the rename");

  // 3. Only an admin may.
  ck((await rename(TEAM, PLAIN, "Hijacked")).status === 403, "a non-admin cannot rename");

  // 4. A blank name is refused.
  ck((await rename(TEAM, ADMIN, "   ")).status === 400, "a blank name is refused");

  // 5. A clash inside the organisation is refused…
  ck((await rename(TEAM, ADMIN, `Finance ${T}`)).status === 409, "a name already used in this organisation is refused");

  // 6. …but the same name in the other organisation is not a clash.
  const stillThere = await queryOne("SELECT name FROM teams WHERE id = ?", [WAQF]);
  ck(stillThere?.name === `Finance ${T}`, "the other organisation keeps its identically named team");

  // 7. The HOD team is protected: the Shz Saab dashboard finds it by name.
  const hodTry = await rename(HOD, ADMIN, "Heads of Department");
  const hodBody = await j(hodTry);
  ck(hodTry.status === 400 && /HOD team cannot be renamed/i.test(hodBody.error || ""),
    `renaming the HOD team is refused (got ${hodTry.status} ${JSON.stringify(hodBody.error || "")})`);
  const hodRow = await queryOne("SELECT name FROM teams WHERE id = ?", [HOD]);
  ck(hodRow?.name === "HOD", "the HOD team keeps its name");

  // 8. A missing team is a 404, not a silent success.
  ck((await rename("t_does_not_exist", ADMIN, "Nope")).status === 404, "renaming an unknown team is 404");
} finally {
  api?.kill();
  await cleanup();
}

for (const p of pass) console.log("PASS  " + p);
for (const f of fail) console.log("FAIL  " + f);
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
