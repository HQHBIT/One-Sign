// ============================================================
//   Shared enums + design tokens
//   Centralised so we don't repeat magic strings or hex colours
//   across the UI. Importers: const { ROLES } from "./lib/constants"
// ============================================================

// ---------- Roles ----------
export const ROLES = Object.freeze({
  ADMIN: "admin",
  REQUESTOR: "requestor",
  APPROVER: "approver",
  EXECUTIVE: "executive",
  EXECUTIVE_ASSISTANT: "executive_assistant"
});
export const ROLE_LABELS = Object.freeze({
  [ROLES.ADMIN]: "Administrator",
  [ROLES.REQUESTOR]: "Requestor",
  [ROLES.APPROVER]: "Approver",
  [ROLES.EXECUTIVE]: "Executive",
  [ROLES.EXECUTIVE_ASSISTANT]: "Executive Assistant"
});

// ---------- Request statuses ----------
export const STATUS = Object.freeze({
  PENDING: "pending",
  APPROVED_PENDING: "approved_pending", // signed but within the cooling window
  APPROVED: "approved",
  REJECTED: "rejected"
});
export const STATUS_LABELS = Object.freeze({
  [STATUS.PENDING]: "Pending",
  [STATUS.APPROVED]: "Approved!",
  [STATUS.APPROVED_PENDING]: "Approved! · 1h window",
  [STATUS.REJECTED]: "Rejected"
});

// ---------- Timing windows ----------
export const APPROVAL_WINDOW_MS = 60 * 60 * 1000;        // 1 hour cooling-off
export const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000; // once per day

// ---------- Upload size ----------
// Mirrors server/src/uploadLimits.js — change BOTH together. The screen promise
// and the check behind it read from here, so they cannot disagree.
export const PDF_MAX_MB = 30;
export const XLSX_MAX_MB = 14;
export const UPLOAD_LIMIT_TEXT = `PDF up to ${PDF_MAX_MB} MB, Excel (.xlsx) up to ${XLSX_MAX_MB} MB`;
/** null when the file fits its limit, else a message naming the file. */
export function fileTooLarge(f) {
  if (!f) return null;
  const xlsx = /\.xlsx?$/i.test(f.name || "");
  const max = xlsx ? XLSX_MAX_MB : PDF_MAX_MB;
  return f.size > max * 1024 * 1024 ? `${f.name}: over ${max} MB (${xlsx ? "Excel" : "PDF"} limit)` : null;
}

// ---------- Design tokens ----------
// Brand palette — keep in sync with index.css and StyleTag.
export const COLORS = Object.freeze({
  ink: "#0F1A2E",        // navy headings
  inkSoft: "#1B2A4A",    // navy hover
  cream: "#F5F1E8",      // page background
  paper: "#FAF7F0",      // card background
  gold: "#B8894A",       // primary accent
  goldDeep: "#A3763D",   // gold hover
  forest: "#2D5F2F",     // success
  rust: "#9B2C2C",       // error / reject
  rustDeep: "#7F2323",   // error hover
  sand: "#8B6914",       // pill text on gold
  earth: "#8B4A14"       // pill text on approved-pending
});

// Step accent palette for multi-signer workflows
export const STEP_COLORS = ["#B8894A", "#2D5F2F", "#7A4E8C", "#1B5A7A", "#9B6A2C", "#5A2D5F"];

// ---------- Request-type taxonomy ----------
// Shared by Quick Actions, NewRequest type picker, and the approver's
// pending-list filter. Keys must match the allowedTypes list on the server.
export const REQUEST_TYPES = [
  { key: "leave",    label: "Leave Approval",    desc: "Time-off, leave forms, attendance approvals.", color: "#2D5F2F" },
  { key: "document", label: "Document Approval", desc: "Policies, memos, contracts, letters.",         color: "#1B5A7A" },
  { key: "expense",  label: "Expense Approval",  desc: "Reimbursements, advances, vouchers.",          color: "#9B6A2C" },
  { key: "invoice",  label: "Invoice / PO",      desc: "Purchase orders, vendor invoices.",            color: "#7A4E8C" },
  { key: "general",  label: "Other",             desc: "Anything else needing a signature.",           color: "#0F1A2E" }
];
export const requestTypeLabel = (key) => REQUEST_TYPES.find(t => t.key === key)?.label || "Other";
export const requestTypeColor = (key) => REQUEST_TYPES.find(t => t.key === key)?.color || "#0F1A2E";
