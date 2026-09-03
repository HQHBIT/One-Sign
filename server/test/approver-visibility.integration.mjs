// Does a person see only their own work?
//
//   node --env-file=.env test/approver-visibility.integration.mjs
//
// Needs the API running on :5001, started from THIS build.
//
// This file has been written twice, in opposite directions, and the second one
// is the rule. Listing was briefly widened so every signer received the whole
// board, because an approver on none of a box's routes saw an empty console. In
// production that handed every signer the name, the requestor and the count of
// every document in the organisation.
//
// So it is back to: what was sent to me, and what I sent. What is asserted here
// is the ABSENCE — that a request reaches nobody it does not concern. That is
// the half nobody can check by looking at their own screen, and the half that
// was quietly wrong for two days.
//
// Counts are checked as well as names, because a total is a disclosure too: a
// badge reading 480 says how much work exists even when no row is listed.
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { initDb, execute, query } from "../src/db.js";
import { signToken } from "../src/auth.js";

const B = process.env.TEST_BASE_URL || "http://127.0.0.1:5001";
await initDb();

const now = Date.now();
const ids = ["u_vis_r", "u_vis_a", "u_vis_o"];
const clean = async () => {
  await query("DELETE FROM requests WHERE requestor_id = 'u_vis_r'");
  await query("DELETE FROM signing_authority WHERE team_id IN ('t_vis','t_vis_other')");
  await query(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  await query("DELETE FROM teams WHERE id IN ('t_vis','t_vis_other')");
};
await clean();

await execute("INSERT INTO teams (id,name,created_at) VALUES ('t_vis','Visibility Team',?)", [now]);
await execute("INSERT INTO teams (id,name,created_at) VALUES ('t_vis_other','Other Team',?)", [now]);
const hash = bcrypt.hashSync("x", 4);
for (const [id, email, name, role, team] of [
  ["u_vis_r", "vis.req@demo.local", "Requestor", "requestor", "t_vis"],
  ["u_vis_a", "vis.app@demo.local", "On-route Approver", "approver", "t_vis"],
  // Deliberately in a DIFFERENT department: belonging to one now confers signing
  // rights for it, so an uninvolved person has to belong elsewhere for the
  // boundary being tested to mean anything.
  ["u_vis_o", "vis.other@demo.local", "Uninvolved Approver", "approver", "t_vis_other"],
]) {
  await execute(
    "INSERT INTO users (id,email,password_hash,name,role,team_id,created_at,active,signature_path,signature_aspect) VALUES (?,?,?,?,?,?,?,1,?,1)",
    [id, email, hash, name, role, team, now, `${id}.png`]);
}
await execute("INSERT INTO signing_authority (user_id,team_id) VALUES ('u_vis_a','t_vis')");
const auth = (id) => ({ Authorization: "Bearer " + signToken(id) });

const pdfBytes = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "latin1");

async function raise({ confidential, fileName }) {
  const fd = new FormData();
  fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), fileName);
  fd.append("targetTeamId", "t_vis");
  if (confidential) fd.append("confidential", "true");
  fd.append("marker", JSON.stringify([{ page: 1, x: 40, y: 70, w: 22, h: 6 }]));
  const r = await fetch(B + "/api/requests", { method: "POST", headers: auth("u_vis_r"), body: fd });
  assert.equal(r.status, 200, `request created (${fileName})`);
  return (await r.json()).request.id;
}

const openId = await raise({ confidential: false, fileName: "Quarterly Report.pdf" });
const confId = await raise({ confidential: true, fileName: "Board Minutes.pdf" });

// Finalise both as the on-route approver. What is under test is who can see a
// FINISHED request, not how it came to be finished.
for (const id of [openId, confId]) {
  await execute("UPDATE requests SET status = 'approved', approver_id = 'u_vis_a' WHERE id = ?", [id]);
}

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);

const listFor = async (who) =>
  ((await (await fetch(B + "/api/requests", { headers: auth(who) })).json()).requests || []);

// ---- THE POINT: work that does not concern you never arrives ----
{
  const seen = await listFor("u_vis_o");
  ck(!seen.some(r => r.id === openId), "an approver on no route does not receive an approved request");
  ck(!seen.some(r => r.id === confId), "nor the confidential one");

  // Absent from the PAYLOAD, not merely unrendered. Hiding a row in the client
  // still ships its name and swells a count for anyone who opens devtools.
  const involved = (r) =>
    r.requestorId === "u_vis_o"
    || r.approverId === "u_vis_o"
    || (r.workflow || []).some(st => (st.signers || []).some(s => s.userId === "u_vis_o"));
  const strangers = seen.filter(r => !involved(r) && r.status !== "pending");
  ck(strangers.length === 0,
    `no finished work belonging to others is returned at all (${strangers.length} of ${seen.length})`);
}

// ---- the people it does concern are unaffected ----
{
  const seen = await listFor("u_vis_a");
  const open = seen.find(r => r.id === openId);
  const conf = seen.find(r => r.id === confId);
  ck(!!open, "the approver who signed it still sees it");
  ck(open && open.fileName === "Quarterly Report.pdf", "with its real name");
  ck(conf && conf.fileName === "Board Minutes.pdf",
    "and the confidential one whose route they are on");

  const r = await fetch(`${B}/api/requests/${openId}/file`, { headers: auth("u_vis_a") });
  ck(r.status === 200, `and can still open the document (${r.status})`);
}

{
  const seen = await listFor("u_vis_r");
  ck(seen.some(r => r.id === openId), "the requestor sees what they sent");
  ck(seen.some(r => r.id === confId), "including the confidential one they raised");
}

// ---- and the document was never reachable regardless ----
// Unchanged by any of this, and worth stating: listing and authorisation are
// separate gates. Narrowing the first must not be mistaken for the second having
// been absent all along.
{
  let r = await fetch(`${B}/api/requests/${openId}/file`, { headers: auth("u_vis_o") });
  ck(r.status === 403, `an uninvolved approver cannot open the document (${r.status})`);
  r = await fetch(`${B}/api/requests/${confId}/file`, { headers: auth("u_vis_o") });
  ck(r.status === 403, `nor the confidential one (${r.status})`);
}

for (const p of pass) console.log("  PASS  " + p);
for (const f of fail) console.log("  FAIL  " + f);
await clean();
console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
