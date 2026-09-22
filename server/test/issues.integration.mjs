// Does a submission on the reops form reach the inbox through SignFlow?
//
//   node test/issues.integration.mjs          (from server/, MySQL running)
//
// Starts its own API on a spare port with email switched OFF, so the email is
// written to the log table instead of delivered — the send path is exercised and
// nobody's inbox is used as a fixture.
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..");
config({ path: path.join(SERVER, ".env") });

const PORT = 5000 + 70 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;
const REPORT_TO = "issue-probe@test.local";
const SECRET = "probe-secret-" + Math.random().toString(36).slice(2);

// Migrations first, from here: two processes migrating at once wait on each
// other's locks and the server then looks like it failed to start.
const { initDb, query, execute, queryOne } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
await initDb();

const api = spawn(process.execPath, ["src/index.js"], {
  cwd: SERVER,
  env: { ...process.env, PORT: String(PORT), SENDGRID_API_KEY: "", STORAGE_BUCKET: "",
         ISSUE_REPORT_EMAIL: REPORT_TO, ISSUE_HOOK_SECRET: SECRET },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
api.stdout.on("data", (d) => { log += d; });
api.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
  if (i === 59) { console.log(log); throw new Error("API did not start"); }
}

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);
const T = Date.now().toString(36);
const A = `u_iss_adm_${T}`, U = `u_iss_req_${T}`;
const hook = (body, headers = { "X-Issue-Token": SECRET }) =>
  fetch(`${BASE}/api/issues/hook`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

const cleanup = async () => {
  await execute("DELETE FROM issue_reports WHERE emailed_to = ?", [REPORT_TO]);
  await execute("DELETE FROM emails WHERE to_email = ?", [REPORT_TO]);
  await execute("DELETE FROM users WHERE id IN (?, ?)", [A, U]);
};

try {
  const hash = bcrypt.hashSync("x", 4);
  await execute("INSERT INTO users (id, email, password_hash, name, role, created_at, active) VALUES (?, ?, ?, 'Issue Admin', 'admin', ?, 1)",
    [A, `${A}@issue.test`, hash, Date.now()]);
  await execute("INSERT INTO users (id, email, password_hash, name, role, created_at, active) VALUES (?, ?, ?, 'Issue User', 'requestor', ?, 1)",
    [U, `${U}@issue.test`, hash, Date.now()]);

  // ---- a submission arrives, is recorded and emailed ----
  let r = await hook({
    name: "Mufaddal bhai Tinwala",
    email: "mufaddal.tinwala@hqhb.in",
    description: "The signature box does not appear on page 2 of a scanned PDF.",
    from: "signflow.umooriqtesadiyah.org/#requests",
    id: "FORM-1042",
  });
  const body = await r.json().catch(() => ({}));
  ck(r.status === 200 && body.ok, `a form submission is accepted (${r.status} ${body.error || ""})`);

  const row = await queryOne("SELECT * FROM issue_reports WHERE id = ?", [body.id]);
  ck(row?.message?.includes("signature box does not appear"), "what was written is recorded");
  ck(row?.reporter_name === "Mufaddal bhai Tinwala", `and who wrote it (${row?.reporter_name})`);
  ck(row?.reporter_email === "mufaddal.tinwala@hqhb.in", `and their address (${row?.reporter_email})`);
  ck(row?.page === "signflow.umooriqtesadiyah.org/#requests", `and the screen they came from (${row?.page})`);
  ck(row?.emailed_to === REPORT_TO && Number(row?.emailed) === 1, "and it was emailed to the configured address");

  const mail = await queryOne("SELECT * FROM emails WHERE to_email = ? ORDER BY sent_at DESC LIMIT 1", [REPORT_TO]);
  ck(/Issue reported by Mufaddal bhai Tinwala/.test(mail?.subject || ""), `the email names the reporter (${mail?.subject})`);
  ck(/signature box does not appear/.test(mail?.body || ""), "and carries the report");
  ck(/FORM-1042/.test(mail?.body || ""), "and the form's own reference");

  // ---- whatever the form calls its fields ----
  r = await hook({ "Full Name": "Someone Else", "Email Address": "se@hqhb.in", "Your message": "The page is blank after signing in.", Category: "Enhancement request" });
  const alt = await r.json().catch(() => ({}));
  const altRow = await queryOne("SELECT * FROM issue_reports WHERE id = ?", [alt.id]);
  ck(r.status === 200 && altRow?.reporter_name === "Someone Else", `differently named fields are understood (${altRow?.reporter_name})`);
  ck(altRow?.category === "enhancement", `and an enhancement is labelled as one (${altRow?.category})`);

  // ---- an unexpected question is kept, not dropped ----
  r = await hook({ message: "Cannot upload a 12 MB file.", "Which browser": "Safari on iPhone", Department: "Finance" });
  const extra = await queryOne("SELECT message FROM issue_reports WHERE id = ?", [(await r.json()).id]);
  ck(/Which browser: Safari on iPhone/.test(extra?.message || ""), "an extra question on the form still reaches the email");
  ck(/Department: Finance/.test(extra?.message || ""), "as does another");

  // ---- nobody else can make us send mail ----
  ck((await hook({ message: "forged" }, { "X-Issue-Token": "wrong-secret" })).status === 401, "a wrong token is refused");
  ck((await hook({ message: "forged" }, {})).status === 401, "no token is refused");
  ck((await hook({}, { "X-Issue-Token": SECRET })).status === 400, "a submission with no message is refused");
  const before = (await queryOne("SELECT COUNT(*) AS n FROM issue_reports WHERE emailed_to = ?", [REPORT_TO])).n;
  await hook({ message: "forged" }, { "X-Issue-Token": SECRET.slice(0, -1) });
  ck((await queryOne("SELECT COUNT(*) AS n FROM issue_reports WHERE emailed_to = ?", [REPORT_TO])).n === before,
    "a refused call records nothing");

  // ---- the admin can read what has come in; a requestor cannot ----
  r = await fetch(`${BASE}/api/issues`, { headers: { Authorization: "Bearer " + signToken(A) } });
  const list = await r.json().catch(() => ({}));
  ck(r.status === 200 && list.issues?.length >= 3, `an admin sees the reports (${r.status}, ${list.issues?.length})`);
  ck(list.hookConfigured === true && list.reportTo === REPORT_TO, "and how notifications are configured");
  ck((await fetch(`${BASE}/api/issues`, { headers: { Authorization: "Bearer " + signToken(U) } })).status === 403,
    "a requestor cannot read everyone's reports");
} catch (e) {
  fail.push(`the run stopped early: ${e?.message || e}`);
} finally {
  for (const p of pass) console.log("  PASS  " + p);
  for (const f of fail) console.log("  FAIL  " + f);
  await cleanup().catch((e) => console.log("cleanup:", e.message));
  api.kill();
  console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
  if (fail.length) console.log(log.split("\n").filter((l) => /error|issues/i.test(l)).slice(-10).join("\n"));
  process.exit(fail.length ? 1 : 0);
}
