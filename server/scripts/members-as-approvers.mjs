// Every department member is also an approver of that department.
//
//   node --env-file=.env scripts/members-as-approvers.mjs          report only
//   node --env-file=.env scripts/members-as-approvers.mjs --apply  grant authority
//
// A member appears under Approvers on Teams & authority when they hold that
// team's signing authority, so this grants the missing rows. It only ADDS —
// an authority granted by hand to someone outside the department is never
// removed, and re-running changes nothing.
//
// HQHB only, by product direction: the WAQF box keeps explicit appointment.
import { initDb, query, execute } from "../src/db.js";
import { deploymentOrg } from "../src/org.js";

const apply = process.argv.includes("--apply");
await initDb();

const org = deploymentOrg();
console.log(`box organisation: ${org}`);
if (org !== "hqhb") {
  console.error("Refusing to run: members-as-approvers is for the HQHB organisation only.");
  process.exit(1);
}

// Active members of a team who do not yet hold that team's authority.
const missing = await query(`
  SELECT u.id AS user_id, u.name, u.email, u.team_id, t.name AS team_name
    FROM users u
    JOIN teams t ON t.id = u.team_id
   WHERE u.team_id IS NOT NULL
     AND u.active = 1
     AND NOT EXISTS (
       SELECT 1 FROM signing_authority sa
        WHERE sa.user_id = u.id AND sa.team_id = u.team_id
     )
   ORDER BY t.name, u.name
`);

const teams = await query(`
  SELECT t.id, t.name,
         (SELECT COUNT(*) FROM users u WHERE u.team_id = t.id AND u.active = 1) AS members,
         (SELECT COUNT(*) FROM signing_authority sa WHERE sa.team_id = t.id) AS approvers
    FROM teams t ORDER BY t.name
`);

console.log("\nteam                                     members  approvers  to grant");
const missingByTeam = missing.reduce((acc, m) => ((acc[m.team_id] = (acc[m.team_id] || 0) + 1), acc), {});
for (const t of teams) {
  const grant = missingByTeam[t.id] || 0;
  console.log(`${String(t.name).slice(0, 38).padEnd(40)} ${String(t.members).padStart(7)} ${String(t.approvers).padStart(10)} ${String(grant).padStart(9)}`);
}
console.log(`\nmembers without their own team's authority: ${missing.length}`);

if (!apply) {
  console.log("report only — nothing written. Re-run with --apply to grant.");
  process.exit(0);
}

let granted = 0;
for (const m of missing) {
  try {
    await execute("INSERT IGNORE INTO signing_authority (user_id, team_id) VALUES (?, ?)", [m.user_id, m.team_id]);
    granted++;
  } catch (e) {
    console.error(`  could not grant ${m.name} on ${m.team_name}: ${e.message}`);
  }
}
console.log(`granted: ${granted}`);

const after = await query(`
  SELECT t.name,
         (SELECT COUNT(*) FROM users u WHERE u.team_id = t.id AND u.active = 1) AS members,
         (SELECT COUNT(*) FROM signing_authority sa WHERE sa.team_id = t.id) AS approvers
    FROM teams t ORDER BY t.name
`);
console.log("\nafter — team, members, approvers");
for (const t of after) console.log(`  ${String(t.name).slice(0, 38).padEnd(40)} ${String(t.members).padStart(4)} ${String(t.approvers).padStart(4)}`);
process.exit(0);
