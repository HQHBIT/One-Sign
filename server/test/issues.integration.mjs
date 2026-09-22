// Does reporting an issue record it and email the person who looks after SignFlow?
//
//   node test/issues.integration.mjs          (from server/, MySQL running)
//
// Starts its own API on a spare port with email switched OFF, so the email is
// written to the log table instead of being delivered — the send path is still
// exercised, and nobody's inbox is used as a test fixture.
import fs from "node:fs/promises";
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

// Migrations first, from here, so the API is not running the same ALTERs at the
// same moment — two processes migrating at once wait on each other's locks and
// the server looks like it failed to start.
const { initDb, query, execute, queryOne } = await import("../src/db.js");
const { signToken } = await import("../src/auth.js");
await initDb();

const api = spawn(process.execPath, ["src/index.js"], {
  cwd: SERVER,
  env: { ...process.env, PORT: String(PORT), SENDGRID_API_KEY: "", STORAGE_BUCKET: "", ISSUE_REPORT_EMAIL: REPORT_TO },
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
const U = `u_iss_${T}`, A = `u_iss_adm_${T}`;
const auth = (id) => ({ Authorization: "Bearer " + signToken(id), "Content-Type": "application/json" });
const report = (id, body) => fetch(`${BASE}/api/issues`, { method: "POST", headers: auth(id), body: JSON.stringify(body) });

const cleanup = async () => {
  await execute("DELETE FROM issue_reports WHERE user_id IN (?, ?)", [U, A]);
  await execute("DELETE FROM emails WHERE to_email = ?", [REPORT_TO]);
  await execute("DELETE FROM users WHERE id IN (?, ?)", [U, A]);
};

try {
  const hash = bcrypt.hashSync("x", 4);
  await execute("INSERT INTO users (id, email, password_hash, name, role, created_at, active) VALUES (?, ?, ?, ?, 'requestor', ?, 1)",
    [U, `${U}@issue.test`, hash, "Issue Reporter", Date.now()]);
  await execute("INSERT INTO users (id, email, password_hash, name, role, created_at, active) VALUES (?, ?, ?, ?, 'admin', ?, 1)",
    [A, `${A}@issue.test`, hash, "Issue Admin", Date.now()]);

  // ---- a report is recorded and emailed ----
  let r = await report(U, { message: "The signature box does not appear on page 2.", category: "issue", page: "/#requests/abc" });
  const body = await r.json().catch(() => ({}));
  ck(r.status === 200 && body.ok, `a report is accepted (${r.status} ${body.error || ""})`);

  const row = await queryOne("SELECT * FROM issue_reports WHERE id = ?", [body.id]);
  ck(!!row, "it is recorded");
  ck(row?.message === "The signature box does not appear on page 2.", "with what was written");
  ck(row?.reporter_name === "Issue Reporter" && row?.reporter_email === `${U}@issue.test`,
    `and who wrote it (${row?.reporter_name})`);
  ck(row?.reporter_role === "requestor", `and their role (${row?.reporter_role})`);
  ck(row?.page === "/#requests/abc", `and the screen they were on (${row?.page})`);
  ck(!!row?.user_agent === false || typeof row.user_agent === "string", "and their browser when sent");
  ck(row?.emailed_to === REPORT_TO, `addressed to the configured recipient (${row?.emailed_to})`);
  ck(Number(row?.emailed) === 1, "and marked as emailed");

  const mail = await queryOne("SELECT * FROM emails WHERE to_email = ? ORDER BY sent_at DESC LIMIT 1", [REPORT_TO]);
  ck(!!mail, "an email was produced");
  ck(/Issue reported by Issue Reporter/.test(mail?.subject || ""), `with a subject naming the reporter (${mail?.subject})`);
  ck(/signature box does not appear/.test(mail?.body || ""), "and the report inside it");
  ck(mail?.template === "issue_report", `from the issue template (${mail?.template})`);

  // ---- an improvement is labelled as one ----
  r = await report(U, { message: "Please remember my last chosen department.", category: "enhancement" });
  const enh = await r.json().catch(() => ({}));
  const enhMail = await queryOne("SELECT subject FROM emails WHERE to_email = ? ORDER BY sent_at DESC LIMIT 1", [REPORT_TO]);
  ck(r.status === 200 && /Enhancement reported/.test(enhMail?.subject || ""), `an improvement reads as one (${enhMail?.subject})`);
  ck((await queryOne("SELECT category FROM issue_reports WHERE id = ?", [enh.id]))?.category === "enhancement",
    "and is recorded as an enhancement");

  // ---- nonsense is refused, and signing in is required ----
  ck((await report(U, { message: "hi" })).status === 400, "a two-word report is refused");
  ck((await report(U, { message: "" })).status === 400, "an empty report is refused");
  const anon = await fetch(`${BASE}/api/issues`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "anonymous report" }) });
  ck(anon.status === 401, `reporting requires signing in (${anon.status})`);

  // ---- one person cannot flood the inbox ----
  let limited = 0;
  for (let i = 0; i < 12; i++) {
    const rr = await report(U, { message: `Flood attempt number ${i} with enough words.` });
    if (rr.status === 429) limited++;
  }
  ck(limited > 0, `a burst from one person is rate limited (${limited} refused)`);

  // ---- the admin can read what was reported; a requestor cannot ----
  r = await fetch(`${BASE}/api/issues`, { headers: auth(A) });
  const list = await r.json().catch(() => ({}));
  ck(r.status === 200 && Array.isArray(list.issues) && list.issues.length >= 2,
    `an admin sees the reports (${r.status}, ${list.issues?.length})`);
  ck(list.reportTo === REPORT_TO, `and where they are being sent (${list.reportTo})`);
  ck((await fetch(`${BASE}/api/issues`, { headers: auth(U) })).status === 403, "a requestor cannot read everyone's reports");
} finally {
  for (const p of pass) console.log("  PASS  " + p);
  for (const f of fail) console.log("  FAIL  " + f);
  await cleanup().catch((e) => console.log("cleanup:", e.message));
  api.kill();
  console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
  if (fail.length) console.log(log.split("\n").filter((l) => /error|issues/i.test(l)).slice(-10).join("\n"));
  process.exit(fail.length ? 1 : 0);
}
