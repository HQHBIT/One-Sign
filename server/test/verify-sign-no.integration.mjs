// Public verification of a sign number.
//
//   node test/verify-sign-no.integration.mjs      (from server/, MySQL running)
//
// The point of the feature is that a COPIED tag fails, so that is the case
// asserted hardest. Also: unknown and malformed numbers, a confidential
// document never being named, a bare number verifying but saying it proved
// less, and the whole thing being absent off HQHB.
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..");
config({ path: path.join(SERVER, ".env") });

const PORT = 5000 + 230 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;
const WAQF_PORT = PORT + 5;
const WAQF = `http://127.0.0.1:${WAQF_PORT}`;
const { initDb, execute, queryOne } = await import("../src/db.js");
await initDb();

function startApi(port, env) {
  const c = spawn(process.execPath, ["src/index.js"], { cwd: SERVER, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), SENDGRID_API_KEY: "", STORAGE_BUCKET: "", ...env } });
  c.log = ""; c.stdout.on("data", d => (c.log += d)); c.stderr.on("data", d => (c.log += d));
  return c;
}
async function waitFor(base, child) {
  for (let i = 0; i < 180; i++) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {} await new Promise(r => setTimeout(r, 500)); }
  console.log(child.log); throw new Error("API did not start on " + base);
}

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);
const j = async (r) => { try { return await r.json(); } catch { return {}; } };
const get = (base, no) => fetch(`${base}/api/verify/${encodeURIComponent(no)}`).then(j);

// Two distinct sequences in a year nothing real uses; (year, seq) is unique.
const SEQ = (Date.now() % 900000) + 1;
const no = (n) => "SF-2099-" + String(n).padStart(6, "0");
const OPEN_NO = no(SEQ);
const CONF_NO = no(SEQ + 1);
const NOPE_NO = "SF-2099-999999";

const cleanup = async () => {
  await execute("DELETE FROM sign_register WHERE sign_no IN (?,?)", [OPEN_NO, CONF_NO]).catch(() => {});
};

let hqhb = null, waqf = null;
try {
  await cleanup();
  hqhb = startApi(PORT, { ORG_SLUG: "hqhb" });
  await waitFor(BASE, hqhb);
  waqf = startApi(WAQF_PORT, { ORG_SLUG: "waqf" });
  await waitFor(WAQF, waqf);

  // The server owns the secret, so ask it for the codes rather than guessing.
  const { checkCodeFor } = await import("../src/signRegister.js");
  const openCode = await checkCodeFor(OPEN_NO);
  const confCode = await checkCodeFor(CONF_NO);

  const now = Date.now();
  const row = (no, code, confidential, name) => execute(
    `INSERT INTO sign_register (sign_no, year, seq, request_id, signer_ref, signer_id, signer_name,
       signed_at, source, created_at, document_name, requested_by_name, confidential, doc_sha256, check_code)
     VALUES (?, 2099, ?, ?, ?, ?, ?, ?, 'live', ?, ?, ?, ?, ?, ?)`,
    [no, Number(String(no).slice(-6)), "req_verify_" + no, "sg_" + no, "u_admin", "Shabbar BS",
      now, now, name, "Taha Chunawala", confidential, "a".repeat(64), code]);
  await row(OPEN_NO, openCode, 0, "Budget Approval.pdf");
  await row(CONF_NO, confCode, 1, "Secret Terms.pdf");

  // 1. The genuine article.
  const good = await get(BASE, `${OPEN_NO}-${openCode}`);
  ck(good.valid === true, `a genuine tag verifies (got ${JSON.stringify(good.reason || good.valid)})`);
  ck(good.document === "Budget Approval.pdf", "it names the document the number really belongs to");
  ck(good.assurance === "number-and-code", "it says the code was checked too");
  ck(good.fileSha256 === "a".repeat(64), "it hands back the signed file's fingerprint");

  // 2. THE FORGERY CASE: a real number with a code that does not belong to it.
  const wrong = openCode === "FFFF" ? "0000" : "FFFF";
  const forged = await get(BASE, `${OPEN_NO}-${wrong}`);
  ck(forged.valid === false && forged.reason === "bad-check-code",
    `a tag with the wrong code is refused (got ${JSON.stringify(forged.reason)})`);

  // 3. An invented number.
  const unknown = await get(BASE, NOPE_NO);
  ck(unknown.valid === false && unknown.reason === "unknown", "an invented number is refused");

  // 4. Something that is not a sign number at all.
  const junk = await get(BASE, "NOT-A-NUMBER");
  ck(junk.valid === false && junk.reason === "malformed", "a malformed number is called malformed, not unknown");

  // 5. A bare number still verifies, and says it proved less.
  const bare = await get(BASE, OPEN_NO);
  ck(bare.valid === true && bare.assurance === "number-only",
    `a number without its code verifies but is marked number-only (got ${JSON.stringify(bare.assurance)})`);

  // 6. A confidential document is never named, even to a valid check.
  const conf = await get(BASE, `${CONF_NO}-${confCode}`);
  ck(conf.valid === true, "a signature on a confidential document still verifies");
  ck(conf.document === null && conf.requestedBy === null && conf.confidential === true,
    "the confidential document is never named");

  // 7. Absent entirely off HQHB.
  const off = await fetch(`${WAQF}/api/verify/${OPEN_NO}-${openCode}`);
  ck(off.status === 404, `the route is absent on WAQF (got ${off.status})`);
} finally {
  hqhb?.kill(); waqf?.kill();
  await cleanup();
}

for (const p of pass) console.log("PASS  " + p);
for (const f of fail) console.log("FAIL  " + f);
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
