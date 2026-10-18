// ============================================================
//   DOCUMENT RETENTION BY REQUEST TYPE (HQHB)
//   ------------------------------------------------------------
//   Each request type keeps its documents for a set period once the request is
//   decided — approved, rejected or withdrawn; a request still in progress is
//   never touched. Two days before the period ends the requestor is emailed
//   their copy (the signed document attached, or a sign-in link when it is
//   confidential or too large to attach). When it ends the files are removed
//   from disk and the bucket; the request's record — who, what, when, the
//   outcome — stays, marked as removed.
//
//   Applies only to requests created after this shipped: the period is stamped
//   on the request at creation (retention_days, by the INSERT in routes/requests.js), so earlier requests (NULL) are
//   kept indefinitely, and a later change to a period never shortens the life
//   of a request already made.
//
//   Keep RETENTION_DAYS in step with REQUEST_TYPES in client/src/lib/constants.js
//   (test/retention.test.mjs checks they agree).
// ============================================================
import { query, queryOne, execute } from "./db.js";
import { readStored, deleteStored } from "./filestore.js";
import { notifyUser } from "./notify.js";

export const RETENTION_DAYS = Object.freeze({
  document: 7,
  leave: 3,
  expense: 15,
  invoice: 15,
  project: 30,
  workdone: 7,
  confidential: 60,
  general: 15,
});

// WAQF keeps the original five and keeps documents indefinitely.
const BASE_TYPES = ["leave", "document", "expense", "invoice", "general"];
export const allowedTypesFor = (org) => (org === "hqhb" ? Object.keys(RETENTION_DAYS) : BASE_TYPES);
export const retentionDaysFor = (org, type) => (org === "hqhb" ? RETENTION_DAYS[type] ?? null : null);

const DAY = 86_400_000;
export const NOTICE_BEFORE_MS = 2 * DAY;
// Attachments above this go as a link instead: SendGrid caps a whole message at
// 30 MB and base64 adds a third.
export const MAX_ATTACH_BYTES = 15 * 1024 * 1024;

// When the request was decided: finalised, rejected or withdrawn.
const DECIDED_AT = "COALESCE(r.finalized_at, r.rejected_at, r.withdrawn_at)";
const DECIDED = "r.status IN ('approved','rejected','withdrawn')";

/** When a request's files go, or null if they are kept indefinitely / not decided yet. */
export function expiresAt(row) {
  const decided = Number(row.finalized_at || row.rejected_at || row.withdrawn_at || 0);
  if (!row.retention_days || !decided || !["approved", "rejected", "withdrawn"].includes(row.status)) return null;
  return decided + Number(row.retention_days) * DAY;
}

// The requestor's copy: the signed PDF when there is one, else what they sent.
async function copyFor(row) {
  const signed = row.status === "approved" && row.signed_file_path;
  const area = signed ? "signed" : "documents";
  const value = signed ? row.signed_file_path : row.file_path;
  const bytes = await readStored(area, value);
  const isPdf = signed || row.file_type === "pdf";
  const base = String(row.file_name || "document").replace(/\.(pdf|xlsx?|xls)$/i, "");
  return {
    bytes,
    filename: `${base}${signed ? " (signed)" : ""}.${isPdf ? "pdf" : "xlsx"}`,
    type: isPdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

async function sendNotice(row, now) {
  const requestor = await queryOne("SELECT * FROM users WHERE id = ?", [row.requestor_id]);
  const until = expiresAt(row);
  const confidential = !!Number(row.confidential);
  let attachment = null;
  if (!confidential) {
    try {
      const c = await copyFor(row);
      if (c.bytes.length <= MAX_ATTACH_BYTES) attachment = c;
    } catch (e) { console.warn(`[retention] could not read ${row.id} for the notice: ${e.message}`); }
  }
  if (requestor?.email) {
    // Sent even when the requestor has turned workflow emails off: this is
    // their copy of a document about to be removed, not a status update.
    await notifyUser({
      user: { ...requestor, email_notifications: 1 },
      requestId: row.id,
      template: "retention_notice",
      ctx: {
        requestorName: requestor.name, fileName: row.file_name, requestId: row.id,
        confidential, removeOn: until, attached: !!attachment, outcome: row.status,
      },
      attachments: attachment ? [attachment] : undefined,
    });
  }
  await execute("UPDATE requests SET retention_notified_at = ? WHERE id = ? AND retention_notified_at IS NULL", [now, row.id]);
}

async function purge(row, now) {
  const atts = await query("SELECT file_path, signed_file_path FROM request_attachments WHERE request_id = ?", [row.id]);
  const files = [
    ["documents", row.file_path], ["signed", row.signed_file_path], ["voicenotes", row.reject_voice_path],
    ...atts.flatMap(a => [["documents", a.file_path], ["signed", a.signed_file_path]]),
  ].filter(([, v]) => v);
  for (const [area, value] of files) await deleteStored(area, value).catch(() => {});
  await execute("UPDATE requests SET files_purged_at = ? WHERE id = ?", [now, row.id]);
  console.log(`[retention] removed the files of ${row.id} (${row.request_type}, ${row.retention_days} days)`);
}

/** One pass: notify what is due for notice, then remove what has expired.
 *  `ids` limits the pass to those requests (tests). */
export async function retentionTick(now = Date.now(), { ids = null } = {}) {
  if (ids && !ids.length) return { notified: 0, purged: 0 };
  const due = await query(
    `SELECT r.* FROM requests r
      WHERE r.retention_days IS NOT NULL AND r.files_purged_at IS NULL AND ${DECIDED}
        AND ${DECIDED_AT} IS NOT NULL
        AND ${DECIDED_AT} + r.retention_days * ${DAY} - ? <= ?
        ${ids ? `AND r.id IN (${ids.map(() => "?").join(",")})` : ""}`,
    [NOTICE_BEFORE_MS, now, ...(ids || [])]);
  let notified = 0, purged = 0;
  for (const row of due) {
    try {
      if (!row.retention_notified_at) { await sendNotice(row, now); notified++; continue; }
      // Never remove before the notice has had its full two days — even when a
      // short period, or a late first notice, means the clock has already run out.
      const end = Math.max(expiresAt(row), Number(row.retention_notified_at) + NOTICE_BEFORE_MS);
      if (now >= end) { await purge(row, now); purged++; }
    } catch (e) { console.error(`[retention] ${row.id}: ${e.message}`); }
  }
  return { notified, purged };
}

export function startRetention({ everyMs = 10 * 60_000 } = {}) {
  const run = () => retentionTick().catch(e => console.error("[retention]", e.message));
  setInterval(run, everyMs);
  setTimeout(run, 60_000); // after boot settles
}

const fmtIST = (ms) => new Date(Number(ms)).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

/** The 410 body for a file asked for after its request's files were removed. */
export const removedBody = (row) => ({
  error: `This document was removed on ${fmtIST(row.files_purged_at)}, when its storage period ended.`,
  removed: true,
});
