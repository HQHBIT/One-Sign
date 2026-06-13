import { GitBranch, Zap, Check, Clock } from "lucide-react";
import { STEP_COLORS } from "../lib/constants.js";

export function WorkflowSummary({ req, teams }) {
  return (
    <div className="card p-4 mb-4">
      <div className="text-[10px] tracking-widest uppercase opacity-50 mb-3 flex items-center gap-2">
        <GitBranch size={11} /> Approval workflow
        {req.instantApproval && <span style={{ color: "var(--c-gold)" }} className="flex items-center gap-1"><Zap size={10} /> Instant</span>}
      </div>
      <div className="space-y-2">
        {req.workflow.map((step, si) => {
          const team = teams.find(t => t.id === step.teamId);
          const c = STEP_COLORS[si % STEP_COLORS.length];
          return (
            <div key={step.id} className="flex gap-3">
              <div style={{ width: 4, borderRadius: 2, backgroundColor: c }} />
              <div className="flex-1 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Step {step.order} · {team?.name}</span>
                  <StepStatusPill status={step.status} />
                </div>
                <div className="text-xs opacity-70 mt-1">
                  {step.signers.map(s => (
                    <span key={s.id} className="inline-flex items-center gap-1 mr-3">
                      {s.status === "signed" ? <Check size={10} style={{ color: "var(--c-forest)" }} /> : <Clock size={10} className="opacity-50" />}
                      {s.userName}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepStatusPill({ status }) {
  const map = {
    pending: { c: "pill-pending", l: "Waiting" },
    active: { c: "pill-approved-pending", l: "Active" },
    done: { c: "pill-approved", l: "Done" },
    rejected: { c: "pill-rejected", l: "Rejected" }
  }[status] || { c: "pill-pending", l: status };
  return <span className={`pill ${map.c} text-[9px]`}>{map.l}</span>;
}
