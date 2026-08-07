import sgMail from "@sendgrid/mail";
import { execute, query } from "./db.js";
import { redactEmailBody } from "./redact.js";

const apiKey = process.env.SENDGRID_API_KEY;
const fromEmail = process.env.SENDGRID_FROM_EMAIL || "noreply@hqhb.in";
const fromName = process.env.SENDGRID_FROM_NAME || "HQHB SignFlow";

if (apiKey) {
  sgMail.setApiKey(apiKey);
  console.log("[email] SendGrid configured — emails will be delivered.");
} else {
  console.log("[email] No SENDGRID_API_KEY. Emails will be logged to DB only (visible in Admin → SendGrid log).");
}

// ────────────────────────────────────────────────────────────────────────────
//  BRAND — edit these to restyle every email at once.
//  Colours mirror the app's design tokens (client StyleTag.jsx). The logo is a
//  hosted PNG (email clients can't render the SVG); it sits on the navy header
//  band, so we use the CREAM ("light") logo. Override any of these via env.
// ────────────────────────────────────────────────────────────────────────────
const BRAND = {
  appUrl: (process.env.APP_PUBLIC_URL || "https://signflow.umooriqtesadiyah.org").replace(/\/+$/, ""),
  logoUrl: process.env.EMAIL_LOGO_URL || "",   // defaults to <appUrl>/signflow-logo-light.png below
  fromName,
  greeting: "Afzalus Salaam,",   // salutation before the recipient's name — edit to taste
  navy:  "#0F1A2E",
  gold:  "#B8894A",
  cream: "#F5F1E8",
  paper: "#FAF7F0",
  shell: "#EFEAE0",   // outer page background
  ink:   "#0F1A2E",
  body:  "#2C3646",   // paragraph text
  muted: "#8A8577",   // labels / captions
  line:  "#ECE7DB",   // hairline borders
};
BRAND.logoUrl = BRAND.logoUrl || `${BRAND.appUrl}/signflow-logo-light.png`;

// HTML-escape every piece of personalization we drop into markup.
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// A status chip (matches the app's pills).
function pill(text, kind) {
  const map = {
    pending:  { bg: "#F4E4C1", fg: "#8B6914" },
    approved: { bg: "#C8D9C5", fg: "#2D5F2F" },
    rejected: { bg: "#E8C5C5", fg: "#7A2222" },
    neutral:  { bg: "#E7E1D3", fg: "#1B2A4A" },
  };
  const c = map[kind] || map.neutral;
  return `<span style="display:inline-block;padding:5px 12px;border-radius:999px;background:${c.bg};color:${c.fg};font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;">${esc(text)}</span>`;
}

// A body paragraph. `inner` may contain trusted inline HTML (e.g. <strong>);
// callers escape any personalization before embedding it.
const p = (inner) => `<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.62;color:${BRAND.body};">${inner}</p>`;

// A small caption line (muted, smaller).
const caption = (inner) => `<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:${BRAND.muted};">${inner}</p>`;

// The greeting line: the salutation (BRAND.greeting, which carries its own
// punctuation) followed by the recipient's name.
const greet = (name) => p(`${esc(BRAND.greeting)} ${esc(name)}`);

// Deep link to a specific request in the app. Falls back to the app root when no
// requestId is in the context, so the button is always a valid link.
const requestUrl = (c) => (c && c.requestId ? `${BRAND.appUrl}/?request=${encodeURIComponent(c.requestId)}` : BRAND.appUrl);

// A label/value detail box. Rows with an empty value are dropped.
function details(rows, { mono = false, accent = false } = {}) {
  const list = rows.filter((r) => r && r.value);
  if (!list.length) return "";
  const valFont = mono ? "'Courier New',monospace" : "Arial,Helvetica,sans-serif";
  const trs = list.map((r) => `
        <tr>
          <td style="padding:7px 16px 7px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${BRAND.muted};white-space:nowrap;vertical-align:top;">${esc(r.label)}</td>
          <td style="padding:7px 0;font-family:${valFont};font-size:14px;color:${BRAND.ink};font-weight:bold;word-break:break-word;">${esc(r.value)}</td>
        </tr>`).join("");
  const bg = accent ? "#FBF7EE" : BRAND.paper;
  const border = accent ? BRAND.gold : BRAND.line;
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px;background:${bg};border:1px solid ${border};border-radius:8px;">
        <tr><td style="padding:12px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${trs}
          </table>
        </td></tr>
      </table>`;
}

// A call-to-action button (bulletproof table cell; Outlook shows a solid rect).
function button(label, url, kind = "gold") {
  const bg = kind === "navy" ? BRAND.navy : kind === "green" ? "#2D8A46" : BRAND.gold;
  return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 6px;">
        <tr><td align="center" bgcolor="${bg}" style="border-radius:8px;">
          <a href="${esc(url)}" target="_blank" style="display:inline-block;padding:13px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:${BRAND.cream};text-decoration:none;border-radius:8px;">${esc(label)}</a>
        </td></tr>
      </table>`;
}

// The shared shell: navy header + cream logo + gold rule, white body, footer.
function layout({ preheader, pillHtml, heading, contentHtml }) {
  const host = BRAND.appUrl.replace(/^https?:\/\//, "");
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${esc(BRAND.fromName)}</title>
<style>
  @media only screen and (max-width:620px){ .sf-pad{padding-left:24px!important;padding-right:24px!important;} }
</style>
</head>
<body style="margin:0;padding:0;background:${BRAND.shell};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${BRAND.shell};">${esc(preheader || "")}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.shell};">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden;">
        <tr><td align="center" style="background:${BRAND.navy};padding:30px 40px 26px;">
          <img src="${esc(BRAND.logoUrl)}" alt="${esc(BRAND.fromName)}" width="146" style="display:block;width:146px;max-width:58%;height:auto;border:0;outline:none;text-decoration:none;">
        </td></tr>
        <tr><td style="height:4px;line-height:4px;font-size:0;background:${BRAND.gold};">&nbsp;</td></tr>
        <tr><td class="sf-pad" style="padding:34px 40px 30px;">
          ${pillHtml ? `<div style="margin:0 0 14px;">${pillHtml}</div>` : ""}
          <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:1.25;color:${BRAND.ink};font-weight:normal;">${esc(heading)}</h1>
          ${contentHtml}
        </td></tr>
        <tr><td class="sf-pad" style="background:${BRAND.paper};padding:22px 40px;border-top:1px solid ${BRAND.line};">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#9A9484;">
            Automated message from ${esc(BRAND.fromName)} — please don't reply to this email.<br>
            <a href="${esc(BRAND.appUrl)}" target="_blank" style="color:${BRAND.gold};text-decoration:none;">${esc(host)}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ────────────────────────────────────────────────────────────────────────────
//  TEMPLATES — each returns { subject, html, text }.
//  `text` is the plain-text fallback (sent alongside the HTML for deliverability
//  and stored — redacted — in the Email log). Keep the "Password:" / "New
//  password:" labels at line start so redact.js can mask them in the log.
// ────────────────────────────────────────────────────────────────────────────
const templates = {
  new_request: (c) => ({
    subject: `New signature request: ${c.requestorName}`,
    html: layout({
      preheader: `${c.requestorName} sent "${c.fileName}" for your approval`,
      pillHtml: pill("Awaiting your approval", "pending"),
      heading: "New signature request",
      contentHtml:
        greet(c.approverName) +
        p(`<strong>${esc(c.requestorName)}</strong> has submitted a document for your approval.`) +
        details([
          { label: "Document", value: c.fileName },
          { label: "Team", value: c.teamName },
          { label: "Requested by", value: c.requestorName },
        ]) +
        (c.approveToken
          ? button("Approve", `${BRAND.appUrl}/?approveToken=${encodeURIComponent(c.approveToken)}`, "green")
          : "") +
        button(c.approveToken ? "View the document" : "Review & sign", requestUrl(c), "gold") +
        caption(c.approveToken
          ? "Approve signs it with your signature on file and notifies the requestor — or open the document to review it first."
          : "Sign in to SignFlow to review and sign the document."),
    }),
    text: [
      `${BRAND.greeting} ${c.approverName}`, ``,
      `${c.requestorName} has submitted "${c.fileName}" for your approval.`,
      c.teamName ? `Team: ${c.teamName}` : null, ``,
      c.approveToken ? `Approve directly: ${BRAND.appUrl}/?approveToken=${encodeURIComponent(c.approveToken)}` : null,
      `View the document: ${requestUrl(c)}`, ``, `— ${BRAND.fromName}`,
    ].filter((x) => x !== null).join("\n"),
  }),

  // Mid-workflow hand-off: the previous signer has signed and it is now THIS
  // person's turn. Names the signer explicitly so the recipient knows why the
  // document has reached them.
  your_turn: (c) => ({
    subject: `Your signature is next: ${c.fileName}`,
    html: layout({
      preheader: `${c.previousSignerName || "The previous signer"} has signed — it's now your turn`,
      pillHtml: pill("Awaiting your signature", "pending"),
      heading: "It's your turn to sign",
      contentHtml:
        greet(c.approverName) +
        p(`<strong>${esc(c.previousSignerName || "The previous signer")}</strong> has signed the document, and it is now waiting for your approval.`) +
        details([
          { label: "Document", value: c.fileName },
          { label: "Signed by", value: c.previousSignerName },
          { label: "Raised by", value: c.requestorName },
        ]) +
        button("Review & sign", requestUrl(c), "gold") +
        caption("Sign in to SignFlow to review and sign the document."),
    }),
    text: [
      `${BRAND.greeting} ${c.approverName}`, ``,
      `${c.previousSignerName || "The previous signer"} has signed "${c.fileName}", and it is now waiting for your approval.`,
      c.requestorName ? `Raised by: ${c.requestorName}` : null, ``,
      `Review & sign: ${requestUrl(c)}`, ``, `— ${BRAND.fromName}`,
    ].filter((x) => x !== null).join("\n"),
  }),

  approved: (c) => ({
    subject: `Approved: ${c.fileName}`,
    html: layout({
      preheader: `${c.approverName} approved "${c.fileName}"`,
      pillHtml: pill("Approved", "approved"),
      heading: "Your document was approved",
      contentHtml:
        greet(c.requestorName) +
        p(`Your document has been approved by <strong>${esc(c.approverName)}</strong>. The signed file is available under Approved Requests.`) +
        details([
          { label: "Document", value: c.fileName },
          { label: "Approved by", value: c.approverName },
        ]) +
        button("View document", requestUrl(c), "gold"),
    }),
    text: [
      `${BRAND.greeting} ${c.requestorName}`, ``,
      `Your document "${c.fileName}" has been approved by ${c.approverName}.`,
      `The signed file is available under Approved Requests.`, ``,
      `View the document: ${requestUrl(c)}`, ``, `— ${BRAND.fromName}`,
    ].join("\n"),
  }),

  // To the EXECUTIVE when their assistant acts on their behalf — names the
  // assistant and the action so delegation is never invisible to the owner.
  ea_action: (c) => ({
    subject: `${c.assistantName} ${c.action} "${c.fileName}" on your behalf`,
    html: layout({
      preheader: `${c.assistantName} ${c.action} "${c.fileName}" on your behalf`,
      pillHtml: pill("On your behalf", "neutral"),
      heading: "Your assistant acted on your behalf",
      contentHtml:
        greet(c.executiveName) +
        p(`Your assistant <strong>${esc(c.assistantName)}</strong> has <strong>${esc(c.action)}</strong> the document below on your behalf.`) +
        details([
          { label: "Document", value: c.fileName },
          { label: "Action", value: c.action },
          { label: "Performed by", value: c.assistantName },
        ]) +
        button("Review the document", requestUrl(c), "navy"),
    }),
    text: [
      `${BRAND.greeting} ${c.executiveName}`, ``,
      `Your assistant ${c.assistantName} has ${c.action} the document "${c.fileName}" on your behalf.`, ``,
      `Review it: ${requestUrl(c)}`, ``, `— ${BRAND.fromName}`,
    ].join("\n"),
  }),

  rejected: (c) => ({
    subject: `Rejected: ${c.fileName}`,
    html: layout({
      preheader: `${c.approverName} rejected "${c.fileName}"`,
      pillHtml: pill("Rejected", "rejected"),
      heading: "Your document was rejected",
      contentHtml:
        greet(c.requestorName) +
        p(`Your document was rejected by <strong>${esc(c.approverName)}</strong>.`) +
        details([
          { label: "Document", value: c.fileName },
          { label: "Rejected by", value: c.approverName },
          { label: "Reason", value: c.reason || "" },
        ]) +
        button("View document", requestUrl(c), "navy"),
    }),
    text: [
      `${BRAND.greeting} ${c.requestorName}`, ``,
      `Your document "${c.fileName}" was rejected by ${c.approverName}${c.reason ? `.\nReason: ${c.reason}` : "."}`, ``,
      `View the document: ${requestUrl(c)}`, ``, `— ${BRAND.fromName}`,
    ].join("\n"),
  }),

  reminder: (c) => ({
    subject: `Reminder: "${c.fileName}" awaiting approval`,
    html: layout({
      preheader: `Reminder: "${c.fileName}" is pending your approval`,
      pillHtml: pill("Awaiting your approval", "pending"),
      heading: "A document is awaiting your approval",
      contentHtml:
        greet(c.approverName) +
        p(`This is a gentle reminder from <strong>${esc(c.requestorName)}</strong> about a document pending your approval.`) +
        details([{ label: "Document", value: c.fileName }]) +
        button("Review & sign", requestUrl(c), "gold"),
    }),
    text: [
      `${BRAND.greeting} ${c.approverName}`, ``,
      `This is a reminder from ${c.requestorName} about "${c.fileName}" pending your approval.`, ``,
      `Review & sign: ${requestUrl(c)}`, ``, `— ${BRAND.fromName}`,
    ].join("\n"),
  }),

  welcome: (c) => {
    const url = c.signInUrl || BRAND.appUrl;
    return {
      subject: `Welcome to ${BRAND.fromName} — your account is ready`,
      html: layout({
        preheader: "Your SignFlow account is ready — here are your sign-in details",
        pillHtml: pill("Account ready", "neutral"),
        heading: "Welcome to SignFlow",
        contentHtml:
          greet(c.name) +
          p(`An account has been created for you on <strong>${esc(BRAND.fromName)}</strong>.` +
            (c.teamName ? ` You've been added to the <strong>${esc(c.teamName)}</strong> team${c.isApprover ? " as a signing authority" : ""}.` : "")) +
          details([
            { label: "Sign-in URL", value: url },
            { label: "Email", value: c.email },
            { label: "Password", value: c.password },
          ], { mono: true, accent: true }) +
          p(`Please sign in and change your password once you're set up.`) +
          (c.isApprover ? caption("As an approver, you'll also need to register your signature on first sign-in.") : "") +
          button("Sign in", url, "gold"),
      }),
      text: [
        `${BRAND.greeting} ${c.name}`, ``,
        `An account has been created for you on ${BRAND.fromName}.`,
        c.teamName ? `You have been added to the ${c.teamName} team${c.isApprover ? " as a signing authority" : ""}.` : null, ``,
        `Sign-in URL:  ${url}`,
        `Email:        ${c.email}`,
        `Password:     ${c.password}`, ``,
        `Please sign in and change your password once you're set up.`,
        c.isApprover ? `As an approver, you will also need to register your signature on first sign-in.` : null, ``,
        `— ${BRAND.fromName}`,
      ].filter((x) => x !== null).join("\n"),
    };
  },

  reset_password: (c) => {
    const url = c.signInUrl || BRAND.appUrl;
    return {
      subject: `Your ${BRAND.fromName} password has been reset`,
      html: layout({
        preheader: "Your SignFlow password has been reset",
        pillHtml: pill("Password reset", "neutral"),
        heading: "Your password was reset",
        contentHtml:
          greet(c.name) +
          p(c.byAdmin
            ? `An administrator has reset your password on <strong>${esc(BRAND.fromName)}</strong>.`
            : `You (or someone with your email) requested a password reset on <strong>${esc(BRAND.fromName)}</strong>.`) +
          details([
            { label: "Sign-in URL", value: url },
            { label: "Email", value: c.email },
            { label: "New password", value: c.password },
          ], { mono: true, accent: true }) +
          caption("If you didn't request this, contact your administrator immediately — your old password no longer works.") +
          button("Sign in", url, "gold"),
      }),
      text: [
        `${BRAND.greeting} ${c.name}`, ``,
        c.byAdmin
          ? `An administrator has reset your password on ${BRAND.fromName}.`
          : `You (or someone with your email) requested a password reset on ${BRAND.fromName}.`, ``,
        `Sign-in URL:  ${url}`,
        `Email:        ${c.email}`,
        `New password: ${c.password}`, ``,
        `If you didn't request this, please contact your administrator immediately —`,
        `your old password will no longer work.`, ``,
        `— ${BRAND.fromName}`,
      ].join("\n"),
    };
  },

  // Self-service password reset: a one-time code the user enters to set a new
  // password themselves. The code is NEVER put in the subject (subjects are logged
  // unredacted) and sits on a "Reset code:" line in the text version so redact.js
  // masks it in the Email log — keeping the reset the user's alone.
  password_otp: (c) => ({
    subject: `Your ${BRAND.fromName} password reset code`,
    html: layout({
      preheader: "Your one-time password reset code",
      pillHtml: pill("Password reset", "neutral"),
      heading: "Your password reset code",
      contentHtml:
        greet(c.name) +
        p(`Use the one-time code below to reset your <strong>${esc(BRAND.fromName)}</strong> password. It's valid for ${esc(String(c.minutes))} minutes.`) +
        details([{ label: "Reset code", value: c.otp }], { mono: true, accent: true }) +
        caption("Enter this code on the reset screen, then choose your new password. If you didn't request this, ignore this email — your password won't change."),
    }),
    text: [
      `${BRAND.greeting} ${c.name}`, ``,
      `You requested a password reset on ${BRAND.fromName}.`, ``,
      `Reset code: ${c.otp}`,
      `This code is valid for ${c.minutes} minutes.`, ``,
      `Enter it on the reset screen, then choose a new password.`,
      `If you didn't request this, ignore this email — your password won't change.`, ``,
      `— ${BRAND.fromName}`,
    ].join("\n"),
  }),
};

// Render a template without sending — used by the preview generator + tests.
export function renderTemplate(template, ctx) {
  const t = templates[template];
  if (!t) throw new Error(`Unknown template: ${template}`);
  return t(ctx);
}

export async function sendEmail({ to, template, ctx, _isAssistantCopy }) {
  if (!to) return;
  // Assistants with the "receive notifications" right get a copy of every email
  // their executive receives (the executive still gets theirs — both receive).
  // _isAssistantCopy stops a copy from fanning out again.
  if (!_isAssistantCopy) {
    try {
      const eas = await query(`
        SELECT a.email FROM executive_assistants ea
        JOIN users e ON e.id = ea.executive_id
        JOIN users a ON a.id = ea.assistant_id
        WHERE LOWER(e.email) = LOWER(?) AND ea.can_notify = 1 AND a.active = 1
      `, [to]);
      for (const r of eas) {
        sendEmail({ to: r.email, template, ctx, _isAssistantCopy: true }).catch(() => {});
      }
    } catch { /* copies must never block the primary email */ }
  }
  const { subject, html, text } = renderTemplate(template, ctx);
  // We SEND both `html` (branded) and `text` (fallback). We LOG only the
  // plain-text version, redacted — never the HTML, never a plaintext password.
  const logBody = redactEmailBody(text);
  const sentAt = Date.now();

  if (!apiKey) {
    await execute(
      "INSERT INTO emails (to_email, subject, body, template, sent_at, delivered, error) VALUES (?, ?, ?, ?, ?, 0, NULL)",
      [to, subject, logBody, template, sentAt]
    );
    return { delivered: false, logged: true };
  }

  try {
    await sgMail.send({ to, from: { email: fromEmail, name: fromName }, subject, text, html });
    await execute(
      "INSERT INTO emails (to_email, subject, body, template, sent_at, delivered, error) VALUES (?, ?, ?, ?, ?, 1, NULL)",
      [to, subject, logBody, template, sentAt]
    );
    return { delivered: true };
  } catch (err) {
    const msg = err?.response?.body?.errors?.[0]?.message || err.message || "Unknown SendGrid error";
    console.error("[email] Send failed:", msg);
    await execute(
      "INSERT INTO emails (to_email, subject, body, template, sent_at, delivered, error) VALUES (?, ?, ?, ?, ?, 0, ?)",
      [to, subject, logBody, template, sentAt, msg]
    );
    return { delivered: false, error: msg };
  }
}
