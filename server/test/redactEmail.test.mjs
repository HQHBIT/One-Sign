import { test } from "node:test";
import assert from "node:assert/strict";
import { redactEmailBody } from "../src/redact.js";

test("masks the welcome-email password, keeps everything else", () => {
  const body = [
    "Hello John,",
    "",
    "An account has been created for you on HQHB SignFlow.",
    "Sign-in URL:  https://signflow.hqhb.in",
    "Email:        john@hqhb.in",
    "Password:     Secret#123",
    "",
    "Please sign in and change your password once you're set up.",
  ].join("\n");
  const out = redactEmailBody(body);
  assert.ok(!out.includes("Secret#123"), "plaintext password must be gone");
  assert.match(out, /Password:\s+••••••••/, "label kept, value masked");
  assert.ok(out.includes("john@hqhb.in"), "recipient email preserved");
  assert.ok(out.includes("change your password once"), "prose 'password' must not be touched");
});

test("masks the reset-email 'New password' line", () => {
  const body = "Hello Amy,\n\nNew password: Reset$99\n\nyour old password will no longer work.";
  const out = redactEmailBody(body);
  assert.ok(!out.includes("Reset$99"));
  assert.match(out, /New password: ••••••••/);
  assert.ok(out.includes("your old password will no longer work."), "prose 'password' preserved");
});

test("leaves password-free bodies unchanged", () => {
  const body = 'Hello Bob,\n\nYour document "X.pdf" has been approved.\n\n— HQHB SignFlow';
  assert.equal(redactEmailBody(body), body);
});

test("is idempotent — an already-masked body stays masked", () => {
  const once = redactEmailBody("Password:     Secret#123");
  assert.equal(redactEmailBody(once), once);
  assert.ok(!redactEmailBody(once).includes("Secret#123"));
});

test("handles null / undefined safely", () => {
  assert.equal(redactEmailBody(null), "");
  assert.equal(redactEmailBody(undefined), "");
});

console.log("redactEmailBody: all tests passed");
