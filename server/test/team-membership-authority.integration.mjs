// Does belonging to a department let you sign for it?
//
//   node --env-file=.env test/team-membership-authority.integration.mjs
//
// Needs the API running on :5001, started from THIS build.
//
// Reported on HQHB: the Operations Team showed 23 department members and a
// single approver, and only that one person could act. Signing authority was an
// appointment and nothing else, so members counted only when NOBODY had been
// appointed — the moment one existed, the other twenty-two were locked out of
// their own department's work.
//
// Membership now confers the same right. Two things have to hold for that to be
// more than a cosmetic change to a screen:
//
//   the member must actually be able to approve, not merely be listed, and
//   it must stop at the department boundary — someone in another team gains
//   nothing, or this has quietly become "anyone may sign anything".
//
// The member here is deliberately role=requestor, because that is what most of
// those 23 people are. If signing needed the approver ROLE, listing them would
// be a promise the server refuses to keep.
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { initDb, execute, query, queryOne } from "../src/db.js";
import { signToken } from "../src/auth.js";

const B = process.env.TEST_BASE_URL || "http://127.0.0.1:5001";
await initDb();

const now = Date.now();
const ids = ["u_mem_req", "u_mem_mem", "u_mem_apt", "u_mem_out", "u_mem_adm"];
const clean = async () => {
  await query("DELETE FROM requests WHERE requestor_id = 'u_mem_req'");
  await query("DELETE FROM signing_authority WHERE team_id IN ('t_mem','t_other')");
  await query(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  await query("DELETE FROM teams WHERE id IN ('t_mem','t_other')");
};
await clean();

await execute("INSERT INTO teams (id,name,created_at) VALUES ('t_mem','Operations Probe',?)", [now]);
await execute("INSERT INTO teams (id,name,created_at) VALUES ('t_other','Elsewhere Probe',?)", [now]);
const hash = bcrypt.hashSync("x", 4);
for (const [id, email, name, role, team] of [
  ["u_mem_req", "mem.req@demo.local", "Raiser", "requestor", null],
  // A plain member of the department, holding no appointment at all.
  ["u_mem_mem", "mem.member@demo.local", "Department Member", "requestor", "t_mem"],
  // An appointed approver, so the department is NOT in the "nobody appointed"
  // fallback that used to be the only way members counted.
  ["u_mem_apt", "mem.appointed@demo.local", "Appointed Approver", "approver", "t_mem"],
  // Same company, different department. Must gain nothing.
  ["u_mem_out", "mem.outsider@demo.local", "Outsider", "approver", "t_other"],
  ["u_mem_adm", "mem.adm@demo.local", "IT Admin", "admin", null],
]) {
  await execute(
    "INSERT INTO users (id,email,password_hash,name,role,team_id,created_at,active,signature_path,signature_aspect) VALUES (?,?,?,?,?,?,?,1,?,1)",
    [id, email, hash, name, role, team, now, `${id}.png`]);
}
await execute("INSERT INTO signing_authority (user_id,team_id) VALUES ('u_mem_apt','t_mem')");
const auth = (id) => ({ Authorization: "Bearer " + signToken(id) });
const json = (id) => ({ ...auth(id), "Content-Type": "application/json" });

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);

// ---- the screen: a member is listed, and is distinguishable ----
{
  const { teams } = await (await fetch(B + "/api/teams", { headers: auth("u_mem_adm") })).json();
  const t = (teams || []).find(x => x.id === "t_mem");
  ck(!!t, "the team comes back");
  const signers = (t && t.signers) || [];
  const member = signers.find(s => s.id === "u_mem_mem");
  const appointed = signers.find(s => s.id === "u_mem_apt");
  ck(!!member, "a department member appears among the team's signers");
  ck(!!appointed, "alongside the appointed approver");
  ck(member && member.designated === false, "the member is marked as not appointed");
  ck(appointed && appointed.designated === true, "the appointed one is marked as appointed");

  const { users } = await (await fetch(B + "/api/users", { headers: auth("u_mem_adm") })).json();
  const m = (users || []).find(u => u.id === "u_mem_mem");
  ck(m && (m.signingAuthorityTeams || []).includes("t_mem"),
    "the member may sign for their own department");
  ck(m && !(m.appointedTeams || []).includes("t_mem"),
    "but holds no appointment there — the screen can tell them apart");
}

// ---- the substance: the member can actually approve ----
const pdfBytes = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "latin1");

const fd = new FormData();
fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "Ops Memo.pdf");
fd.append("targetTeamId", "t_mem");
fd.append("marker", JSON.stringify([{ page: 1, x: 40, y: 70, w: 22, h: 6 }]));
let r = await fetch(B + "/api/requests", { method: "POST", headers: auth("u_mem_req"), body: fd });
assert.equal(r.status, 200, "request created");
const id = (await r.json()).request.id;

{
  const list = await (await fetch(B + "/api/requests", { headers: auth("u_mem_mem") })).json();
  ck((list.requests || []).some(x => x.id === id), "the member sees the request routed to their department");

  // ---- and the boundary holds ----
  r = await fetch(`${B}/api/requests/${id}/approve`, {
    method: "POST", headers: json("u_mem_out"), body: JSON.stringify({ instant: true }) });
  ck(r.status === 403, `someone in another department still cannot sign it (${r.status})`);

  r = await fetch(`${B}/api/requests/${id}/approve`, {
    method: "POST", headers: json("u_mem_mem"), body: JSON.stringify({ instant: true }) });
  ck(r.status === 200, `the department member signs it (${r.status})`);

  const row = await queryOne("SELECT status, approver_id FROM requests WHERE id = ?", [id]);
  ck(row && row.status === "approved", `and the request is approved (${row && row.status})`);
  ck(row && row.approver_id === "u_mem_mem", "recorded against the member who signed");
}

for (const p of pass) console.log("  PASS  " + p);
for (const f of fail) console.log("  FAIL  " + f);
await clean();
console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
