// An approver sees the whole board — and still cannot open what is not theirs.
//
//   node --env-file=.env test/approver-visibility.integration.mjs
//
// Needs the API running on :5001, started from THIS build.
//
// Reported on the WAQF box: three approved requests sat in the database, every
// one of them healthy, and an approver saw an empty console because they were
// on none of the three routes. Signers now receive every request.
//
// The point of this file is the SECOND half of that sentence. Widening a list
// is only safe while it stays a list: the document behind an entry must remain
// authorised per request, and a confidential document must stay unreadable and
// unnamed for anyone off its route. A regression here would not look like a bug
// — the console would simply show more, which is what was asked for — so it is
// worth asserting explicitly rather than trusting that two code paths stay
// independent.
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
  await query("DELETE FROM signing_authority WHERE team_id = 't_vis'");
  await query(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  await query("DELETE FROM teams WHERE id = 't_vis'");
};
await clean();

await execute("INSERT INTO teams (id,name,created_at) VALUES ('t_vis','Visibility Team',?)", [now]);
const hash = bcrypt.hashSync("x", 4);
for (const [id, email, name, role] of [
  ["u_vis_r", "vis.req@demo.local", "Requestor", "requestor"],
  ["u_vis_a", "vis.app@demo.local", "On-route Approver", "approver"],
  // The whole point: an approver on NO route at all.
  ["u_vis_o", "vis.other@demo.local", "Uninvolved Approver", "approver"],
]) {
  await execute(
    "INSERT INTO users (id,email,password_hash,name,role,team_id,created_at,active,signature_path,signature_aspect) VALUES (?,?,?,?,?,?,?,1,?,1)",
    [id, email, hash, name, role, "t_vis", now, "u_vis_a.png"]);
}
// Only the on-route approver holds authority. u_vis_o holds none anywhere.
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

// Finalise both as the on-route approver, without walking the signing UI: what
// is under test is visibility of a FINISHED request, not how it got finished.
for (const id of [openId, confId]) {
  await execute("UPDATE requests SET status = 'approved', approver_id = 'u_vis_a' WHERE id = ?", [id]);
}

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);

const listFor = async (who) =>
  ((await (await fetch(B + "/api/requests", { headers: auth(who) })).json()).requests || []);

// ---- THE FIX: the uninvolved approver now sees finished work ----
{
  const seen = await listFor("u_vis_o");
  const open = seen.find(r => r.id === openId);
  const conf = seen.find(r => r.id === confId);
  ck(!!open, "an approver on no route sees an approved request");
  ck(open && open.fileName === "Quarterly Report.pdf", "and can read its name");
  ck(!!conf, "and sees that a confidential request exists");

  // ---- THE SAFEGUARD: seeing it is not opening it ----
  ck(conf && conf.fileName === "Confidential document",
    `a confidential document off-route is still unnamed (${conf ? conf.fileName : "missing"})`);
  ck(conf && !conf.note && !conf.marker, "and carries no note or marker");

  let r = await fetch(`${B}/api/requests/${openId}/file`, { headers: auth("u_vis_o") });
  ck(r.status === 403, `and cannot open the ordinary document either (${r.status})`);
  r = await fetch(`${B}/api/requests/${confId}/file`, { headers: auth("u_vis_o") });
  ck(r.status === 403, `nor the confidential one (${r.status})`);
  r = await fetch(`${B}/api/requests/${openId}/file?download=1`, { headers: auth("u_vis_o") });
  ck(r.status === 403, `nor download it (${r.status})`);
}

// ---- the people who WERE on the route are unaffected ----
{
  const seen = await listFor("u_vis_a");
  const conf = seen.find(r => r.id === confId);
  ck(conf && conf.fileName === "Board Minutes.pdf",
    "the approver who signed it still sees its real name");

  const r = await fetch(`${B}/api/requests/${openId}/file`, { headers: auth("u_vis_a") });
  ck(r.status === 200, `and can still open the ordinary document (${r.status})`);
}

// ---- the requestor still sees their own ----
{
  const seen = await listFor("u_vis_r");
  ck(seen.some(r => r.id === openId), "the requestor still sees what they raised");
}

for (const p of pass) console.log("  PASS  " + p);
for (const f of fail) console.log("  FAIL  " + f);
await clean();
console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
