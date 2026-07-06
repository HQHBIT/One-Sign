import { FileText, FileSpreadsheet, Zap, GitBranch } from "lucide-react";
import { APPROVAL_WINDOW_MS, requestTypeLabel, requestTypeColor } from "../lib/constants.js";
import { fmtShort } from "../lib/format.js";
import { StatusPill } from "./StatusPill.jsx";
import { Countdown } from "./Countdown.jsx";

export function RequestRow({ r, teams, users, i, actions, subtitle }) {
  const requestorName = r.requestorName || users.find(u => u.id === r.requestorId)?.name || "—";
  const approverName = r.approverName || users.find(u => u.id === r.approverId)?.name;
  const team = teams.find(t => t.id === r.targetTeamId);

  // Workflow: find the next pending signer
  let workflowLine = null;
  if (r.workflow && r.workflow.length > 0) {
    const activeStep = r.workflow.find(s => s.status === "active");
    if (activeStep) {
      const next = activeStep.signers.find(s => s.status === "pending");
      const stepTeam = teams.find(t => t.id === activeStep.teamId);
      workflowLine = `Step ${activeStep.order}/${r.workflow.length} · ${stepTeam?.name || ""}${next ? ` · awaiting ${next.userName}` : ""}`;
    } else if (r.status === "approved" || r.status === "approved_pending") {
      const totalSigners = r.workflow.reduce((n, s) => n + s.signers.length, 0);
      workflowLine = `${totalSigners} signature${totalSigners === 1 ? "" : "s"} collected across ${r.workflow.length} step${r.workflow.length === 1 ? "" : "s"}`;
    }
  }

  const typeKey = r.requestType || "general";
  const typeLabel = requestTypeLabel(typeKey);
  const typeColor = requestTypeColor(typeKey);

  return (
    <div className={`px-3 sm:px-5 py-3 sm:py-4 flex items-start sm:items-center gap-3 sm:gap-4 ${i > 0 ? "border-t" : ""}`} style={{ borderColor: "var(--c-ink-08)" }}>
      <div className="w-9 h-9 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(15,26,46,.06)" }}>
        {r.fileType === "pdf" ? <FileText size={15} /> : <FileSpreadsheet size={15} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-sm sm:text-base truncate">{r.fileName}</span>
          {r.instantApproval && <span title="Instant approval" className="shrink-0" style={{ color: "var(--c-gold)" }}><Zap size={11} /></span>}
          {r.workflow?.length > 0 && <span title="Multi-step workflow" className="opacity-60 shrink-0"><GitBranch size={11} /></span>}
        </div>
        <div className="text-xs opacity-60 mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 7px", borderRadius: 4, backgroundColor: `${typeColor}1A`, color: typeColor, fontWeight: 500 }}>
            {typeLabel}
          </span>
          <span className="truncate">{team?.name} · {fmtShort(r.createdAt)}</span>
          <span className="hidden sm:inline">· from {requestorName}</span>
          {approverName && !workflowLine && <span className="hidden md:inline">· {r.status === "rejected" ? "rejected" : "approved"} by {approverName}</span>}
          {r.status === "approved_pending" && r.approvedAt && !r.instantApproval && <span>· <Countdown until={r.approvedAt + APPROVAL_WINDOW_MS} /></span>}
        </div>
        {workflowLine && <div className="text-xs mt-0.5 opacity-70 truncate">{workflowLine}</div>}
        {subtitle && <div className="text-xs mt-1" style={{ color: "var(--c-rust)" }}>{subtitle}</div>}
        {/* On mobile, actions move below content. On desktop they're inline. */}
        <div className="flex sm:hidden items-center gap-2 mt-2">
          <StatusPill status={r.status} />
          <div className="flex-1" />
          {actions}
        </div>
      </div>
      <div className="hidden sm:flex items-center gap-3 shrink-0">
        <StatusPill status={r.status} />
        {actions}
      </div>
    </div>
  );
}
