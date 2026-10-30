import { useState } from "react";
import { Eye } from "lucide-react";
import { ModalShell } from "../../components/ModalShell.jsx";
import { ROLE_LABELS } from "../../lib/constants.js";

// Send ONE paper to someone to read, without touching the board's shape.
//
// A CC stage is the right tool when every document passing a step needs another
// pair of eyes. This is for the other case — this particular paper should be
// seen by this particular person — where making a stage would distort the
// board to record a one-off.
//
// The same tick-list as the stage editor, deliberately: choosing who reads
// something should not feel like two different jobs depending on where you
// started from.
export function SendForReview({ doc, executives, already, onSend, onClose }) {
  const [ids, setIds] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const sentTo = new Set((already || []).map((p) => p.name));

  const toggle = (id) => setIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const send = async () => {
    if (!ids.size || busy) return;
    setBusy(true);
    try { await onSend([...ids]); }
    finally { setBusy(false); }
  };

  return (
    <ModalShell title="Send for review" onClose={onClose}>
      <div className="space-y-4">
        <div className="text-sm opacity-70">
          <span className="font-medium">{doc.title}</span> will be shared with the people you choose
          to <span className="font-medium">read</span>. No signature is asked for, and the card is not
          held — it can move on whenever you like.
        </div>

        <div>
          <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1">
            Who should read it {ids.size > 0 && <span className="opacity-70">· {ids.size} chosen</span>}
          </div>
          <div className="rounded-lg max-h-56 overflow-auto" style={{ border: "1px solid var(--c-ink-10)" }}>
            {executives.map((x) => (
              <label key={x.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer text-sm border-b last:border-0"
                style={{ borderColor: "var(--c-ink-08)" }}>
                <input type="checkbox" checked={ids.has(x.id)} onChange={() => toggle(x.id)}
                  style={{ accentColor: "var(--c-gold)" }} />
                <span className="truncate flex-1">
                  {x.name}
                  {x.role && x.role !== "executive" && <span className="opacity-50"> · {ROLE_LABELS[x.role] || x.role}</span>}
                </span>
                {/* Sending again is allowed — it re-asks — but the assistant
                    should know they are doing it rather than discover it. */}
                {sentTo.has(x.name) && <span className="text-[10px] opacity-50 shrink-0">already sent</span>}
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!ids.size || busy} onClick={send}>
            <Eye size={14} /> {busy ? "Sending…" : `Send to ${ids.size || ""}`.trim()}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
