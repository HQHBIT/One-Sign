import { useState } from "react";
import { PenLine } from "lucide-react";
import { ModalShell } from "../../components/ModalShell.jsx";

// Add or edit one stage: its name, and whether entering it should ask one of
// the assistant's executives to sign. `executives` are the people this
// assistant is linked to — the only ones a stage may name.
export function StageEditor({ stage, executives, onSave, onClose }) {
  const [name, setName] = useState(stage?.name || "");
  const [needsSig, setNeedsSig] = useState(!!stage?.requiresSignature);
  const [signerId, setSignerId] = useState(stage?.signer?.id || executives[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const ok = name.trim().length > 0 && (!needsSig || !!signerId);

  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try { await onSave({ name: name.trim(), requiresSignature: needsSig, signerId: needsSig ? signerId : null }); }
    finally { setBusy(false); }
  };

  return (
    <ModalShell title={stage ? "Edit stage" : "New stage"} onClose={onClose}>
      <div className="space-y-4">
        <label className="block">
          <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1">Stage name</div>
          <input autoFocus value={name} maxLength={60} placeholder="e.g. With the CEO" className="w-full"
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" className="mt-1" checked={needsSig} onChange={(e) => setNeedsSig(e.target.checked)}
            disabled={executives.length === 0} style={{ accentColor: "var(--c-gold)" }} />
          <span>
            <span className="text-sm font-medium inline-flex items-center gap-1.5"><PenLine size={13} /> This stage needs a signature</span>
            <span className="block text-xs opacity-60 mt-0.5">
              Moving a document here sends it to the executive to sign, exactly like a normal request. It can move on once they have signed.
              {executives.length === 0 && " — no executive is linked to you yet."}
            </span>
          </span>
        </label>

        {needsSig && (
          <label className="block">
            <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1">Whose signature</div>
            <select value={signerId} onChange={(e) => setSignerId(e.target.value)} className="w-full">
              {executives.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!ok || busy} onClick={save}>{stage ? "Save" : "Add stage"}</button>
        </div>
      </div>
    </ModalShell>
  );
}
