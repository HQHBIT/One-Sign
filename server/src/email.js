import sgMail from "@sendgrid/mail";
import { execute } from "./db.js";

const apiKey = process.env.SENDGRID_API_KEY;
const fromEmail = process.env.SENDGRID_FROM_EMAIL || "noreply@hqhb.in";
const fromName = process.env.SENDGRID_FROM_NAME || "HQHB SignFlow";

if (apiKey) {
  sgMail.setApiKey(apiKey);
  console.log("[email] SendGrid configured — emails will be delivered.");
} else {
  console.log("[email] No SENDGRID_API_KEY. Emails will be logged to DB only (visible in Admin → SendGrid log).");
}

const templates = {
  new_request: c => ({
    subject: `New signature request: ${c.fileName}`,
    body: `Hello ${c.approverName},\n\n${c.requestorName} has submitted "${c.fileName}" for your approval.\nTeam: ${c.teamName}\n\nPlease log in to review.\n\n— HQHB SignFlow`
  }),
  approved: c => ({
    subject: `Approved: ${c.fileName}`,
    body: `Hello ${c.requestorName},\n\nYour document "${c.fileName}" has been approved by ${c.approverName}.\nThe signed file is available under Approved Requests.\n\n— HQHB SignFlow`
  }),
  rejected: c => ({
    subject: `Rejected: ${c.fileName}`,
    body: `Hello ${c.requestorName},\n\nYour document "${c.fileName}" was rejected by ${c.approverName}${c.reason ? `.\nReason: ${c.reason}` : "."}\n\n— HQHB SignFlow`
  }),
  reminder: c => ({
    subject: `Reminder: "${c.fileName}" awaiting approval`,
    body: `Hello ${c.approverName},\n\nThis is a reminder from ${c.requestorName} about "${c.fileName}" pending your approval.\n\n— HQHB SignFlow`
  })
};

export async function sendEmail({ to, template, ctx }) {
  if (!to) return;
  const t = templates[template];
  if (!t) throw new Error(`Unknown template: ${template}`);
  const { subject, body } = t(ctx);
  const sentAt = Date.now();

  if (!apiKey) {
    await execute(
      "INSERT INTO emails (to_email, subject, body, template, sent_at, delivered, error) VALUES (?, ?, ?, ?, ?, 0, NULL)",
      [to, subject, body, template, sentAt]
    );
    return { delivered: false, logged: true };
  }

  try {
    await sgMail.send({ to, from: { email: fromEmail, name: fromName }, subject, text: body });
    await execute(
      "INSERT INTO emails (to_email, subject, body, template, sent_at, delivered, error) VALUES (?, ?, ?, ?, ?, 1, NULL)",
      [to, subject, body, template, sentAt]
    );
    return { delivered: true };
  } catch (err) {
    const msg = err?.response?.body?.errors?.[0]?.message || err.message || "Unknown SendGrid error";
    console.error("[email] Send failed:", msg);
    await execute(
      "INSERT INTO emails (to_email, subject, body, template, sent_at, delivered, error) VALUES (?, ?, ?, ?, ?, 0, ?)",
      [to, subject, body, template, sentAt, msg]
    );
    return { delivered: false, error: msg };
  }
}
