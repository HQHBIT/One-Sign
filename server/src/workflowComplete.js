// ============================================================
//   Fully signed — tell everyone on the route (HQHB)
//   ------------------------------------------------------------
//   Owner, 2026-10-31: "whenever a requestor sends a document in a multi step
//   workflow, after the document is signed by the last approver all the stages
//   approvers should receive the notification as well as the signed document in
//   their email."
//
//   Called wherever a request becomes `approved` (instant approval, the end of
//   the 1-hour window, batch approval, the scheduler). It:
//     - runs on HQHB only;
//     - covers requests with two or more signers (a multi-step workflow, or one
//       step with several people) — a single approver already has the copy;
//     - writes to every signer on the route, the final one included; the
//       requestor has their own "approved" email;
//     - attaches the signed PDF when it fits an email, and never for a
//       confidential document (notifyUser swaps in the redacted template);
//     - is sent ONCE per request: requests.route_notified_at is claimed
//       atomically, so two paths finalising together cannot both send.
// ============================================================
import { query, queryOne, execute } from "./db.js";
import { deploymentOrg } from "./org.js";
import { readStored } from "./filestore.js";
import { notifyUser } from "./notify.js";

// Base64 grows a file by a third and the provider caps a message near 30 MB.
export const MAX_ATTACH_BYTES = 20 * 1024 * 1024;

export async function notifyRouteOfCompletion(requestId) {
  if (deploymentOrg() !== "hqhb") return { sent: 0, skipped: "not HQHB" };
  const r = await queryOne("SELECT * FROM requests WHERE id = ?", [requestId]);
  if (!r || r.status !== "approved") return { sent: 0, skipped: "not finalised" };

  const signers = await query(
    `SELECT DISTINCT u.* FROM request_step_signers sg
       JOIN request_steps st ON st.id = sg.step_id
       JOIN users u ON u.id = sg.user_id
      WHERE st.request_id = ?`, [r.id]);
  if (signers.length < 2) return { sent: 0, skipped: "single signer" };

  // Claim it — the one place that decides "send" or "already sent".
  const claim = await execute(
    "UPDATE requests SET route_notified_at = ? WHERE id = ? AND route_notified_at IS NULL", [Date.now(), r.id]);
  if (!claim.affectedRows) return { sent: 0, skipped: "already sent" };

  const requestor = await queryOne("SELECT name FROM users WHERE id = ?", [r.requestor_id]);
  let attachment = null;
  if (!r.confidential && r.signed_file_path && !/\.json$/i.test(r.signed_file_path)) {
    try {
      const bytes = await readStored("signed", r.signed_file_path);
      if (bytes.length <= MAX_ATTACH_BYTES) {
        const isPdf = r.file_type === "pdf";
        attachment = {
          bytes,
          filename: String(r.file_name || "document").replace(/(\.[^.]+)?$/, isPdf ? ".signed.pdf" : ".signed.xlsx"),
          type: isPdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        };
      }
    } catch (e) { console.error("[route-complete] could not read the signed copy", r.id, e.message); }
  }

  const names = signers.map((s) => s.name);
  let sent = 0;
  for (const s of signers) {
    if (s.id === r.requestor_id) continue; // has the "approved" email already
    if (Number(s.active) === 0) continue;
    try {
      await notifyUser({
        user: s, requestId: r.id, template: "workflow_complete",
        ctx: {
          name: s.name, fileName: r.file_name, requestorName: requestor?.name || "the requestor",
          signers: names, confidential: !!r.confidential, requestId: r.id,
          attached: !!attachment,
        },
        attachments: attachment ? [attachment] : undefined,
      });
      sent++;
    } catch (e) { console.error("[route-complete] notify failed", r.id, s.id, e.message); }
  }
  return { sent, attached: !!attachment };
}
