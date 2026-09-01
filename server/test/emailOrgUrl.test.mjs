// Does an email link back to the RECIPIENT's organisation?
//
//   node test/emailOrgUrl.test.mjs
//
// SignFlow serves more than one organisation and each has its own address. The
// link in a notification used to come from one process-wide value, so every
// WAQF notification pointed at HQHB's address — a door its recipients cannot
// open. The address now travels with the email, resolved from the recipient.
//
// This runs over EVERY template rather than a chosen few, because the failure
// being guarded against is one template quietly keeping a link of its own: the
// footer, the logo, an approve button, a deep link. One missed call site sends
// a WAQF executive to HQHB and looks fine in the other fourteen.
//
// Pure unit test — no database, no server.
import assert from "node:assert/strict";

// Read before importing: BRAND resolves these once at module load.
delete process.env.APP_PUBLIC_URL;
delete process.env.EMAIL_LOGO_URL;
const { renderTemplate, templateNames } = await import("../src/email.js");

const WAQF = "https://signflow.waqftrust.com";
const HQHB = "https://signflow.umooriqtesadiyah.org";

// Enough context to light up every link a template can carry: the deep link to
// a request, the one-click approve button, and the sign-in links.
const ctx = (appUrl) => ({
  appUrl,
  requestId: "req_test_1",
  approveToken: "tok_test_1",
  approverName: "Approver", requestorName: "Requestor", name: "Person",
  fileName: "Board Minutes.pdf", teamName: "Finance",
  code: "123456", tempPassword: "x", reason: "because", count: 2,
});

const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);

ck(templateNames.length > 0, `there are templates to check (${templateNames.length})`);

// ---- a WAQF recipient is never sent to HQHB ----
for (const name of templateNames) {
  const { html, text } = renderTemplate(name, ctx(WAQF));
  const both = `${html}\n${text}`;
  ck(!both.includes("umooriqtesadiyah"), `${name}: no link back to HQHB`);
  ck(html.includes(WAQF), `${name}: links to WAQF`);
}

// The logo hangs off the same address, or a WAQF email pulls its artwork from
// HQHB's host — which is the same bug wearing a different hat.
{
  const { html } = renderTemplate("new_request", ctx(WAQF));
  ck(html.includes(`${WAQF}/signflow-logo-light.png`), "the logo is served from WAQF too");
}

// ---- and an HQHB recipient is still sent to HQHB ----
for (const name of templateNames) {
  const { html, text } = renderTemplate(name, ctx(HQHB));
  ck(!`${html}\n${text}`.includes("waqftrust"), `${name}: no link back to WAQF`);
  ck(html.includes(HQHB), `${name}: links to HQHB`);
}

// ---- a recipient we cannot place still gets a working link ----
// Unknown addresses (an external signer, a changed address) must not produce a
// broken or empty href; they fall back to the configured default.
{
  const { html } = renderTemplate("new_request", { ...ctx(undefined), appUrl: undefined });
  ck(html.includes(HQHB), "an unplaceable recipient falls back to the default address");
  ck(!html.includes("href=\"\""), "and never renders an empty link");
}

// ---- a trailing slash must not produce a double slash ----
{
  const { html } = renderTemplate("new_request", ctx(WAQF + "/"));
  ck(!html.includes(`${WAQF}//`), "a trailing slash on the stored address is trimmed");
}

for (const p of pass) console.log("  PASS  " + p);
for (const f of fail) console.log("  FAIL  " + f);
console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
