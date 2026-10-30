import { useState } from "react";
import { PenLine, Eye } from "lucide-react";
import { ModalShell } from "../../components/ModalShell.jsx";
import { ROLE_LABELS } from "../../lib/constants.js";

// Add or edit one stage: its name, and whether entering it should ask someone
// to sign. `executives` (a historical name) is everyone who may be NAMED by a
// signature stage — every active Approver and Executive, not only the people
// this assistant is linked to, and not only the Executive role. Entering the
// stage raises an ordinary direct request to whoever is named.
// What a stage can ask of the person it names. Kept here rather than inline so
// the copy explaining each one lives next to the value it describes.
const KINDS = [
  ["plain", "Nothing — just a step", "A holding place on the board. Nobody is asked for anything."],
  ["signature", "Needs a signature", "Moving a document here sends it to that person to sign, exactly like a normal request. It can move on once they have signed."],
  ["cc", "For information only (CC)", "That person is shown the document and told it is for information. They do not sign, and the card is free to move on straight away."],
];

export function StageEditor({ stage, executives, onSave, onClose }) {
  const [name, setName] = useState(stage?.name || "");
  // An older board row has no kind; requiresSignature is what it had.
  const [kind, setKind] = useState(stage?.kind || (stage?.requiresSignature ? "signature" : "plain"));
  const [signerId, setSignerId] = useState(stage?.signer?.id || executives[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const namesSomeone = kind !== "plain";
  const ok = name.trim().length > 0 && (!namesSomeone || !!signerId);

  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      await onSave({
        name: name.trim(),
        kind,
        // Still sent so a server mid-deploy, which knows only this flag, cannot
        // read a CC stage as one that demands a signature.
        requiresSignature: kind === "signature",
        signerId: namesSomeone ? signerId : null,
      });
    } finally { setBusy(false); }
  };

  return (
    <ModalShell title={stage ? "Edit stage" : "New stage"} onClose={onClose}>
      <div className="space-y-4">
        <label className="block">
          <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1">Stage name</div>
          <input autoFocus value={name} maxLength={60} placeholder="e.g. With the CEO" className="w-full"
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
        </label>

        <div>
          <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1.5">What this stage asks for</div>
          <div className="space-y-1.5">
            {KINDS.map(([value, label, blurb]) => {
              // Only "plain" works without somebody to name, so the other two
              // are disabled rather than silently failing on save.
              const blocked = value !== "plain" && executives.length === 0;
              return (
                <label key={value} className="flex items-start gap-3 cursor-pointer rounded-lg p-2"
                  style={kind === value ? { backgroundColor: "rgba(184,137,74,.10)" } : undefined}>
                  <input type="radio" name="stage-kind" className="mt-1" checked={kind === value} disabled={blocked}
                    onChange={() => setKind(value)} style={{ accentColor: "var(--c-gold)" }} />
                  <span>
                    <span className="text-sm font-medium inline-flex items-center gap-1.5">
                      {value === "signature" && <PenLine size={13} />}
                      {value === "cc" && <Eye size={13} />}
                      {label}
                    </span>
                    <span className="block text-xs opacity-60 mt-0.5">
                      {blurb}
                      {blocked && " — nobody can be named yet: this needs an active Approver or Executive account."}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {namesSomeone && (
          <label className="block">
            <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1">
              {kind === "cc" ? "Who should see it" : "Whose signature"}
            </div>
            <select value={signerId} onChange={(e) => setSignerId(e.target.value)} className="w-full">
              {/* The role is shown because two signatories can share a name, and
                  because it explains why someone appears here at all. */}
              {executives.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}{x.role && x.role !== "executive" ? ` · ${ROLE_LABELS[x.role] || x.role}` : ""}
                </option>
              ))}
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
