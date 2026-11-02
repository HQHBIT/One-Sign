// ============================================================
//   SIGN NUMBERS — the register behind every signature (HQHB)
//   ------------------------------------------------------------
//   Owner, 2026-10-31: "a Sign Number which is mapped to each sign being done on
//   the SignFlow application just like Adobe — traceable in future — and the
//   tracing stored in the Admin panel."
//
//   - Every signature gets its own number, SF-<year>-<six digits>, running per
//     calendar year (IST). It is printed under the signature (pdf.js) and listed
//     on the audit page added when the document is fully signed.
//   - One row per (request, signer): a workflow rebuilds its signed PDF from the
//     original on every signature, and each rebuild reuses the numbers already
//     given — a number never changes once a signature has it.
//   - The register keeps who signed, for whom an assistant acted, when, from
//     which address and browser, and the fingerprint (SHA-256) of the signed file
//     that signature produced. Administrators search it (routes/admin.js).
//   - Signatures made before this existed are registered once at start-up
//     (source 'backfill'); their PDFs are left exactly as they were signed.
//   - HQHB only (owner's call). Everywhere else every function is a no-op.
// ============================================================
import crypto from "node:crypto";
import { query, queryOne, execute } from "./db.js";
import { deploymentOrg } from "./org.js";

export const signNumbersOn = () => deploymentOrg() === "hqhb";
export const formatSignNo = (year, seq) => `SF-${year}-${String(seq).padStart(6, "0")}`;
export const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

// The calendar year in India — a signature at 1 a.m. IST on 1 January belongs
// to the new year, whatever UTC says.
const istYear = (ts) => Number(new Date(Number(ts) + 5.5 * 3600 * 1000).toISOString().slice(0, 4));

// Who is really signing: the address the request came from (Cloudflare and
// nginx put the client's address in a header) and the browser.
function origin(req) {
  if (!req) return { ip: null, ua: null };
  const h = req.headers || {};
  const fwd = String(h["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = String(h["cf-connecting-ip"] || fwd || req.ip || "").slice(0, 64) || null;
  const ua = String(h["user-agent"] || "").slice(0, 255) || null;
  return { ip, ua };
}

// The next number for a year, atomically: a single statement, so two signatures
// at the same moment can never draw the same one.
async function nextSeq(year) {
  const r = await execute(
    "INSERT INTO sign_counters (year, last_seq) VALUES (?, 1) ON DUPLICATE KEY UPDATE last_seq = LAST_INSERT_ID(last_seq + 1)",
    [year]);
  // A fresh year's first row carries no LAST_INSERT_ID; its number is 1.
  return Number(r.insertId) || 1;
}

/**
 * The number for one signer on one request — the existing one if they already
 * have it, otherwise a new one. `signerRef` is the step signer's id, or
 * "single" for a team request's one approver. Returns null when off.
 */
export async function assignSignNo({ requestId, signerRef, signerId, signerName, stepOrder = null, signedAt, req = null, source = "live" }) {
  if (!signNumbersOn()) return null;
  const existing = await queryOne("SELECT sign_no FROM sign_register WHERE request_id = ? AND signer_ref = ?", [requestId, signerRef]);
  if (existing) return existing.sign_no;
  const at = Number(signedAt) || Date.now();
  const year = istYear(at);
  const seq = await nextSeq(year);
  const signNo = formatSignNo(year, seq);
  const { ip, ua } = origin(req);
  const actor = req?.actingAssistant || null;
  // A snapshot of what was signed, so the entry outlives the document.
  const doc = await queryOne(
    "SELECT r.file_name, r.confidential, u.name AS requestor FROM requests r LEFT JOIN users u ON u.id = r.requestor_id WHERE r.id = ?", [requestId]);
  try {
    await execute(
      `INSERT INTO sign_register (sign_no, year, seq, request_id, signer_ref, signer_id, signer_name,
         acted_by_assistant_id, acted_by_name, step_order, signed_at, ip, user_agent, source, created_at,
         document_name, requested_by_name, confidential)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [signNo, year, seq, requestId, signerRef, signerId, signerName || null,
        actor?.id || null, actor?.name || null, stepOrder, at, ip, ua, source, Date.now(),
        doc?.file_name || null, doc?.requestor || null, Number(doc?.confidential) ? 1 : 0]);
    return signNo;
  } catch (e) {
    // Someone registered this very signer a moment ago — theirs stands.
    if (e?.code === "ER_DUP_ENTRY") {
      const row = await queryOne("SELECT sign_no FROM sign_register WHERE request_id = ? AND signer_ref = ?", [requestId, signerRef]);
      if (row) return row.sign_no;
    }
    throw e;
  }
}

// A signature that failed to stamp never happened: its number is withdrawn.
export async function releaseSignNo(requestId, signerRef) {
  if (!signNumbersOn()) return;
  await execute("DELETE FROM sign_register WHERE request_id = ? AND signer_ref = ? AND source = 'live'", [requestId, signerRef]).catch(() => {});
}

// signer_ref → sign_no, for a rebuild that must reuse every number given so far.
export async function signNumbersFor(requestId) {
  if (!signNumbersOn()) return new Map();
  const rows = await query("SELECT signer_ref, sign_no FROM sign_register WHERE request_id = ?", [requestId]);
  return new Map(rows.map((r) => [r.signer_ref, r.sign_no]));
}

// The fingerprint of the file a signature produced — on the rows still without one.
export async function recordDocHash(requestId, bytes) {
  if (!signNumbersOn()) return;
  await execute("UPDATE sign_register SET doc_sha256 = ? WHERE request_id = ? AND doc_sha256 IS NULL", [sha256(bytes), requestId]).catch(() => {});
}

// Is this the signature that completes the document — nobody left to sign?
export async function completesRoute(requestId) {
  const left = await queryOne(
    `SELECT 1 AS ok FROM request_step_signers sg JOIN request_steps st ON st.id = sg.step_id
      WHERE st.request_id = ? AND sg.status = 'pending' LIMIT 1`, [requestId]);
  return !left;
}

// Everything the audit page prints.
export async function auditFor(row, originalBytes) {
  const requestor = await queryOne("SELECT name FROM users WHERE id = ?", [row.requestor_id]);
  const signatures = await query(
    `SELECT sign_no, signer_name, acted_by_name, step_order, signed_at FROM sign_register
      WHERE request_id = ? ORDER BY signed_at, seq`, [row.id]);
  return {
    documentName: row.file_name,
    documentId: row.id,
    requestedBy: requestor?.name || "—",
    sentAt: Number(row.created_at),
    completedAt: Date.now(),
    originalSha256: sha256(originalBytes),
    signatures: signatures.map((s) => ({
      signNo: s.sign_no, signer: s.signer_name || "—", actedBy: s.acted_by_name || null,
      step: s.step_order, signedAt: Number(s.signed_at),
    })),
  };
}

/**
 * Registers every signature made before Sign Numbers existed, oldest first, so
 * the history is traceable. Their PDFs are not touched. Safe to run on every
 * start: anything already registered is skipped.
 */
export async function backfillRegister() {
  if (!signNumbersOn()) return { added: 0 };
  // Workflow / direct signers who signed.
  const steps = await query(
    `SELECT sg.id AS ref, sg.user_id, u.name, st.request_id, st.step_order, sg.signed_at
       FROM request_step_signers sg
       JOIN request_steps st ON st.id = sg.step_id
       JOIN users u ON u.id = sg.user_id
      WHERE sg.status = 'signed' AND sg.signed_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM sign_register r WHERE r.request_id = st.request_id AND r.signer_ref = sg.id)`);
  // Team requests' single approver (no step signers at all).
  const singles = await query(
    `SELECT 'single' AS ref, r.approver_id AS user_id, u.name, r.id AS request_id, NULL AS step_order, r.approved_at AS signed_at
       FROM requests r JOIN users u ON u.id = r.approver_id
      WHERE r.status IN ('approved', 'approved_pending') AND r.approved_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM request_steps st WHERE st.request_id = r.id)
        AND NOT EXISTS (SELECT 1 FROM sign_register g WHERE g.request_id = r.id AND g.signer_ref = 'single')`);
  const all = [...steps, ...singles].sort((a, b) => Number(a.signed_at) - Number(b.signed_at));
  let added = 0;
  for (const s of all) {
    await assignSignNo({ requestId: s.request_id, signerRef: s.ref, signerId: s.user_id, signerName: s.name,
      stepOrder: s.step_order, signedAt: s.signed_at, source: "backfill" });
    added++;
  }
  if (added) console.log(`[sign-register] registered ${added} earlier signature(s)`);
  return { added };
}
