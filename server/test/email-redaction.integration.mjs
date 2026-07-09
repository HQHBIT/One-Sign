// Verify a password-bearing email is stored REDACTED in the Email log (emails
// table), so the admin's "Email log" never exposes plaintext credentials.
// Needs MySQL reachable (uses the app's own db layer). Run from repo root:
//   node server/test/email-redaction.integration.mjs
import { config } from "dotenv";
config({ path: "server/.env" });
// Dynamic import AFTER dotenv: db.js reads process.env at module load, and
// static imports are hoisted above config(), so load it lazily here.
const { initDb, queryOne, execute } = await import("../src/db.js");
const { sendEmail } = await import("../src/email.js");

let fail = 0;
const check = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fail++; };

await initDb(); // connect + run migrations (incl. the one-time log cleanup)

const TO = "redact.test." + Date.now() + "@example.invalid";
const PW = "Zzz#Secret" + Date.now().toString(36);

// No SENDGRID key locally, so this logs-only; that's the exact path that stores
// the body in the emails table.
await sendEmail({ to: TO, template: "reset_password", ctx: { name: "Redact Test", email: TO, password: PW, byAdmin: true, signInUrl: "https://x" } });

const row = await queryOne("SELECT subject, body FROM emails WHERE to_email = ? ORDER BY sent_at DESC LIMIT 1", [TO]);
check("reset email was logged", !!row);
check("logged body does NOT contain the plaintext password", !!row && !row.body.includes(PW));
check("logged body shows the password line masked", !!row && /New password:\s*••••••••/.test(row.body));
check("logged body keeps the rest of the message (recipient email)", !!row && row.body.includes(TO));

await execute("DELETE FROM emails WHERE to_email = ?", [TO]);
console.log(fail ? `\n${fail} check(s) failed` : "\nAll email-redaction checks passed");
process.exit(fail ? 1 : 0);
