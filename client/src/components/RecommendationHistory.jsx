import { MessageSquare } from "lucide-react";
import { fmt } from "../lib/format.js";

// The "Recommend changes" rounds on a request (HQHB), oldest first: what the
// approver asked for and, once resubmitted, the requestor's reply. Shown above
// the document, like the requestor's note, because it explains what to look at.
export function RecommendationHistory({ recs = [], requestorName = "The requestor" }) {
  if (!recs?.length) return null;
  return (
    <div className="card p-4 text-sm mb-4" style={{ borderLeft: "3px solid #d97706" }}>
      <div className="text-xs tracking-wider uppercase opacity-50 mb-3 flex items-center gap-1.5">
        <MessageSquare size={12} /> Changes requested{recs.length > 1 ? ` · ${recs.length} rounds` : ""}
      </div>
      {recs.map((r, i) => (
        <div key={r.id} className={i ? "mt-3 pt-3 border-t" : ""} style={{ borderColor: "var(--c-ink-08)" }}>
          <div className="text-xs opacity-60 mb-1">
            {recs.length > 1 ? `Round ${r.round} · ` : ""}{r.requestedByName || "The approver"} · {fmt(r.requestedAt)}
          </div>
          <div style={{ whiteSpace: "pre-wrap" }}>{r.recommendation}</div>
          {r.resubmittedAt ? (
            <div className="mt-2 pl-3 text-xs" style={{ borderLeft: "2px solid var(--c-ink-10)" }}>
              <div className="opacity-60">
                {requestorName} resubmitted · {fmt(r.resubmittedAt)}{r.documentReplaced ? " · document replaced" : ""}
              </div>
              {r.reply && <div className="mt-1 text-sm" style={{ whiteSpace: "pre-wrap" }}>{r.reply}</div>}
            </div>
          ) : (
            <div className="mt-2 text-xs font-medium" style={{ color: "#b45309" }}>With {requestorName} for changes</div>
          )}
        </div>
      ))}
    </div>
  );
}
