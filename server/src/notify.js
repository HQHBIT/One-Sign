// ============================================================
//   Workflow notifications — one call, two channels.
//   ------------------------------------------------------------
//   Every workflow event (new request, approved, rejected, reminder) ALWAYS
//   lands as an in-app notification; the matching email is sent only when the
//   recipient's email_notifications toggle is on. Credential emails (welcome,
//   invites, password reset / OTP) do NOT go through here — they always send.
// ============================================================
import { execute, queryOne } from "./db.js";
import { sendEmail, confidentialTemplate } from "./email.js";

const uid = (p = "n") => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// Compact in-app title/body per template, derived from the same ctx the email uses.
function inAppText(template, ctx = {}) {
  // Confidential documents are never named — not in the email, and not in the
  // in-app notification either, which is visible in the bell dropdown.
  const f = ctx.confidential ? "a confidential document" : (ctx.fileName || "a document");
  switch (template) {
    case "new_request":
      return { title: `New signature request: ${f}`, body: `${ctx.requestorName || "Someone"} sent "${f}" for your signature.` };
    case "your_turn":
      return {
        title: `Your signature is next: ${f}`,
        body: `${ctx.previousSignerName || "The previous signer"} has signed — it's now waiting for your approval.`,
      };
    case "approved":
      return { title: `Approved! ${f}`, body: `${ctx.approverName ? `Approved by ${ctx.approverName}. ` : ""}The signed file is ready.` };
    case "rejected":
      return { title: `Rejected: ${f}`, body: ctx.reason ? `Reason: ${ctx.reason}` : `Rejected by ${ctx.approverName || "the approver"}.` };
    case "reminder":
      return { title: `Reminder: ${f}`, body: `Still awaiting your signature${ctx.requestorName ? ` — from ${ctx.requestorName}` : ""}.` };
    default:
      return { title: f, body: null };
  }
}

// user: a users-table ROW (preferred) or a user id.
export async function notifyUser({ user, template, ctx = {}, requestId = null }) {
  const row = typeof user === "string" ? await queryOne("SELECT * FROM users WHERE id = ?", [user]) : user;
  if (!row?.id) return { delivered: false, error: "no recipient" };

  // In-app: always. A failure here must never block the flow.
  try {
    const { title, body } = inAppText(template, ctx);
    await execute(
      "INSERT INTO notifications (id, user_id, type, title, body, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [uid(), row.id, template, title.slice(0, 250), body ? body.slice(0, 480) : null, requestId || ctx.requestId || null, Date.now()]
    );
  } catch (e) { console.error("[notify] in-app insert failed", e.message); }

  // Email: only when the recipient hasn't turned it off (default = on).
  const emailOn = row.email_notifications == null || Number(row.email_notifications) === 1;
  if (!emailOn) return { delivered: false, skipped: "email notifications off" };
  // Confidential requests swap to the redacted template, which carries neither
  // the file name nor the note.
  const tpl = ctx.confidential ? confidentialTemplate(template) : template;
  return sendEmail({ to: row.email, template: tpl, ctx });
}
