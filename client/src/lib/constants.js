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
  REJECTED: "rejected",
  CHANGES_REQUESTED: "changes_requested" // HQHB: sent back to the requestor
});
export const STATUS_LABELS = Object.freeze({
  [STATUS.PENDING]: "Pending",
  [STATUS.APPROVED]: "Approved!",
  [STATUS.APPROVED_PENDING]: "Approved! · 1h window",
  [STATUS.REJECTED]: "Rejected",
  [STATUS.CHANGES_REQUESTED]: "Changes requested"
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
// Shared by Quick Actions, the NewRequest type picker, and the approver's
// pending-list filter. Keys must match allowedTypesFor() in
// server/src/retention.js, and retentionDays its RETENTION_DAYS (HQHB keeps a
// document that many days after the request is decided; a test checks the two
// agree). `hqhbOnly` types are not offered on the WAQF box, which also keeps
// documents indefinitely. Listed in the order the picker shows them.
export const REQUEST_TYPES = [
  { key: "document",     label: "Document Approval",     desc: "Policies, memos, contracts, letters.",              color: "#1B5A7A", retentionDays: 7 },
  { key: "leave",        label: "Leave Approval",        desc: "Time-off, leave forms, attendance approvals.",      color: "#2D5F2F", retentionDays: 3 },
  { key: "expense",      label: "Expense Approval",      desc: "Reimbursements, advances, vouchers.",               color: "#9B6A2C", retentionDays: 15 },
  { key: "invoice",      label: "Invoices / PO",         desc: "Purchase orders, vendor invoices.",                 color: "#7A4E8C", retentionDays: 15 },
  { key: "project",      label: "Project Approvals",     desc: "Proposals, budgets, milestones and sign-offs.",     color: "#2E6E6A", retentionDays: 30, hqhbOnly: true },
  { key: "workdone",     label: "Work Done",             desc: "Completion certificates and work-done reports.",    color: "#8A5A2B", retentionDays: 7,  hqhbOnly: true },
  { key: "confidential", label: "Confidential Documents", desc: "Encrypted; only you and the signers can open it.", color: "#B8894A", retentionDays: 60, hqhbOnly: true },
  { key: "general",      label: "Others",                desc: "Anything else needing a signature.",                color: "#0F1A2E", retentionDays: 15 },
];
export const requestTypeLabel = (key) => REQUEST_TYPES.find(t => t.key === key)?.label || "Others";
export const requestTypeColor = (key) => REQUEST_TYPES.find(t => t.key === key)?.color || "#0F1A2E";
// The types a deployment offers. Retention periods apply on HQHB only.
export const requestTypesFor = (org) => REQUEST_TYPES.filter(t => org === "hqhb" || !t.hqhbOnly);
// "3 days", "1 month", "2 months".
export const retentionLabel = (days) =>
  !days ? "" : days % 30 === 0 ? `${days / 30} month${days === 30 ? "" : "s"}` : `${days} day${days === 1 ? "" : "s"}`;
