// ============================================================
//   Workflow template validity — the "needs attention" logic.
//   A team MEMBER (no explicit authority) is a valid signer, matching the
//   builder and the approval step. Genuine breakage is still flagged, with a
//   specific reason. Needs the API on :5001.
//   Run: node server/test/workflow-validity.integration.mjs
// ============================================================
import { config } from "dotenv"; config({ path: "server/.env" });
import bcrypt from "bcryptjs";
const { initDb, execute } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
await initDb();

const B = "http://127.0.0.1:5001";
const fail = []; const ck = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fail.push(m); };
const H = { Authorization: "Bearer " + signToken("u_wf_owner"), "Content-Type": "application/json" };
const J = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });

const clean = async () => {
  await execute("DELETE FROM workflow_templates WHERE owner_id = 'u_wf_owner'");
  await execute("DELETE FROM signing_authority WHERE team_id = 't_wf'");
  await execute("DELETE FROM users WHERE id IN ('u_wf_owner','u_wf_member','u_wf_auth','u_wf_ghost')");
  await execute("DELETE FROM teams WHERE id = 't_wf'");
};
await clean();

const now = Date.now();
await execute("INSERT INTO teams (id,name,created_at) VALUES ('t_wf','HR & Facilities',?)", [now]);
await execute("INSERT INTO users (id,email,password_hash,name,role,created_at,active) VALUES ('u_wf_owner','u_wf_owner@hqhb.in',?,'WF Owner','requestor',?,1)", [bcrypt.hashSync("x", 4), now]);
// A MEMBER of the team (team_id set) WITHOUT any signing_authority row — the
// exact case behind the reported "needs attention".
await execute("INSERT INTO users (id,email,password_hash,name,role,team_id,created_at,active) VALUES ('u_wf_member','u_wf_member@hqhb.in',?,'Adnan Member','approver','t_wf',?,1)", [bcrypt.hashSync("x", 4), now]);
// An authority holder (belt and braces).
await execute("INSERT INTO users (id,email,password_hash,name,role,created_at,active) VALUES ('u_wf_auth','u_wf_auth@hqhb.in',?,'Fatema Auth','approver',?,1)", [bcrypt.hashSync("x", 4), now]);
await execute("INSERT INTO signing_authority (user_id,team_id) VALUES ('u_wf_auth','t_wf')");
// A soon-to-be-deactivated user, to prove genuine breakage is still caught.
await execute("INSERT INTO users (id,email,password_hash,name,role,team_id,created_at,active) VALUES ('u_wf_ghost','u_wf_ghost@hqhb.in',?,'Ghost Gone','approver','t_wf',?,1)", [bcrypt.hashSync("x", 4), now]);

const save = async (signers) => J(await fetch(B + "/api/workflow-templates", {
  method: "POST", headers: H,
  body: JSON.stringify({ name: "Testing", steps: [{ teamId: "t_wf", signers }] }) }));

// ---------- 1. a member + an authority holder — the reported setup ----------
let r = await save(["u_wf_member", "u_wf_auth"]);
ck(r.status === 200, "workflow saved (" + r.status + ")");
const tpl = r.body.template;
ck(tpl.valid === true, "*** a member-signer workflow is VALID — no false 'needs attention' ***");
ck(tpl.steps[0].signers.every(s => s.reason == null), "no signer carries a problem reason");

// ---------- 2. deactivating a signer flags it, with a clear reason ----------
await execute("UPDATE users SET active = 0 WHERE id = 'u_wf_ghost'");
r = await save(["u_wf_member", "u_wf_ghost"]);
ck(r.body.template.valid === false, "a deactivated signer makes the workflow invalid");
const ghost = r.body.template.steps[0].signers.find(s => s.userId === "u_wf_ghost");
ck(/deactivated/i.test(ghost?.reason || ""), "…with a specific reason: " + ghost?.reason);
const memberStill = r.body.template.steps[0].signers.find(s => s.userId === "u_wf_member");
ck(memberStill?.valid === true && memberStill.reason == null, "…the innocent member is still fine");

// ---------- 3. someone with NO tie to the team is flagged ----------
await execute("UPDATE users SET team_id = NULL WHERE id = 'u_wf_member'");   // no longer a member, no authority
r = await save(["u_wf_member"]);
ck(r.body.template.valid === false, "a user with no authority AND no membership is invalid");
ck(/no longer on/i.test(r.body.template.steps[0].signers[0]?.reason || ""),
   "…reason names the team tie: " + r.body.template.steps[0].signers[0]?.reason);

// ---------- 4. a deleted team is flagged at the step level ----------
await execute("UPDATE users SET team_id = 't_wf' WHERE id = 'u_wf_member'");
r = await save(["u_wf_member"]);
const tplId = r.body.template.id;
await execute("DELETE FROM signing_authority WHERE team_id = 't_wf'");
await execute("UPDATE users SET team_id = NULL WHERE team_id = 't_wf'");
await execute("DELETE FROM teams WHERE id = 't_wf'");
r = await J(await fetch(B + "/api/workflow-templates", { headers: H }));
const deleted = r.body.templates.find(t => t.id === tplId);
ck(deleted && deleted.valid === false && /deleted/i.test(deleted.steps[0].reason || ""),
   "a deleted team is flagged with a reason: " + deleted?.steps?.[0]?.reason);

console.log(fail.length ? `\n${fail.length} check(s) failed` : "\nWORKFLOW VALIDITY E2E PASSED");
await clean();
process.exit(fail.length ? 1 : 0);
