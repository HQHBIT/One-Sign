import { useState, useEffect } from "react";
import { CheckCircle, AlertCircle, ArrowRight } from "lucide-react";
import { api } from "../api.js";

// Landing screen for the green "Approve" button in the new-request email. The
// emailed token authenticates the approver, so no sign-in is needed; a single
// explicit tap performs the same signing as an in-app approval (mail scanners
// prefetch links, so the approval must never fire on page load).
export function EmailApproveScreen({ token, onClose }) {
  const [state, setState] = useState({ phase: "loading" }); // loading | ready | done | already | error

  useEffect(() => {
    api.emailApprovePreview(token)
      .then(p => setState(p.alreadyDone
        ? { phase: "already", ...p }
        : { phase: "ready", ...p }))
      .catch(e => setState({ phase: "error", error: e.message }));
  }, [token]);

  const approve = async () => {
    setState(s => ({ ...s, busy: true }));
    try {
      await api.emailApprove(token);
      setState(s => ({ ...s, phase: "done", busy: false }));
    } catch (e) {
      setState({ phase: "error", error: e.message });
    }
  };

  const Card = ({ children }) => (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: "var(--c-cream)" }}>
      <div className="card p-8 max-w-md w-full text-center">{children}</div>
    </div>
  );

  if (state.phase === "loading") return <Card><div className="text-sm opacity-50">Checking your approval link…</div></Card>;

  if (state.phase === "error") return (
    <Card>
      <AlertCircle size={28} className="mx-auto mb-3" style={{ color: "var(--c-rust-deep)" }} />
      <div className="font-display text-xl mb-2">This link can't be used</div>
      <div className="text-sm opacity-60 mb-6">{state.error || "The approval link is invalid or has expired."}</div>
      <button className="btn-primary w-full justify-center" onClick={onClose}>Open SignFlow <ArrowRight size={15} /></button>
    </Card>
  );

  if (state.phase === "already") return (
    <Card>
      <CheckCircle size={28} className="mx-auto mb-3" style={{ color: "#2D8A46" }} />
      <div className="font-display text-xl mb-2">Already handled</div>
      <div className="text-sm opacity-60 mb-6">“{state.fileName}” is no longer pending — it may have been approved or rejected already.</div>
      <button className="btn-primary w-full justify-center" onClick={onClose}>Open SignFlow <ArrowRight size={15} /></button>
    </Card>
  );

  if (state.phase === "done") return (
    <Card>
      <CheckCircle size={28} className="mx-auto mb-3" style={{ color: "#2D8A46" }} />
      <div className="font-display text-xl mb-2">Signed and approved</div>
      <div className="text-sm opacity-60 mb-6">
        “{state.fileName}” has been signed with your signature on file. The requestor has been notified.
      </div>
      <button className="btn-primary w-full justify-center" onClick={onClose}>Open SignFlow <ArrowRight size={15} /></button>
    </Card>
  );

  return (
    <Card>
      <div className="font-display text-2xl mb-2">Approve this document?</div>
      <div className="text-sm opacity-60 mb-1">Requested by <b>{state.requestorName}</b></div>
      <div className="text-sm font-medium mb-6 truncate">“{state.fileName}”</div>
      <button className="w-full justify-center inline-flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold"
        style={{ backgroundColor: "#2D8A46", color: "#fff" }}
        disabled={state.busy} onClick={approve}>
        <CheckCircle size={16} /> {state.busy ? "Signing…" : `Approve as ${state.approverName}`}
      </button>
      <button className="btn-ghost w-full justify-center mt-3" onClick={onClose}>
        Review it in SignFlow first
      </button>
      <div className="text-[11px] opacity-45 mt-4">
        Approving signs the document with your signature on file and notifies the requestor.
      </div>
    </Card>
  );
}
