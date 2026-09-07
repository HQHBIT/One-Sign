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

// ---------- Upload size ----------
// One number, because it was previously written out in six places — a validator
// and a caption in each of three files — and they are only ever correct together.
//
// This is the limit a person meets, but it is NOT the only ceiling. Two others
// sit in front of it and the SMALLEST always wins:
//
//   nginx client_max_body_size   on each box, and its default is 1 MB
//   multer fileSize              in server/src/routes/requests.js
//
// nginx rejects an oversized body before the application is ever reached, so a
// box without that directive caps uploads at 1 MB no matter what this says. If
// you raise this, raise those too, or the UI will promise something the server
// refuses after the user has waited for the whole upload.
export const MAX_UPLOAD_MB = 20;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
