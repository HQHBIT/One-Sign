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
  // One signer, because the request a signature stage raises has one signer.
  const [signerId, setSignerId] = useState(stage?.signer?.id || executives[0]?.id || "");
  // Many CC'd people, because a paper is routinely shown to several at once.
  // ccPeople is new; fall back to the single person an older stage recorded.
  const [ccIds, setCcIds] = useState(() => new Set(
    stage?.ccPeople?.length ? stage.ccPeople.map((p) => p.id)
      : (stage?.kind === "cc" && stage?.signer?.id ? [stage.signer.id] : [])
  ));
  const [busy, setBusy] = useState(false);
  const ok = name.trim().length > 0
    && (kind !== "signature" || !!signerId)
    && (kind !== "cc" || ccIds.size > 0);

  const toggleCc = (id) => setCcIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

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
        signerId: kind === "signature" ? signerId : null,
        ccUserIds: kind === "cc" ? [...ccIds] : [],
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

        {/* One signer: a signature stage raises a request, and a request has
            one signer. A dropdown says "exactly one" without needing to. */}
        {kind === "signature" && (
          <label className="block">
            <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1">Whose signature</div>
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

        {/* Many readers: tick boxes rather than a dropdown, because a paper is
            routinely shown to several people at once and the list has to be
            readable at a glance when someone comes back to edit it. */}
        {kind === "cc" && (
          <div>
            <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1">
              Who should see it {ccIds.size > 0 && <span className="opacity-70">· {ccIds.size} chosen</span>}
            </div>
            <div className="rounded-lg max-h-56 overflow-auto" style={{ border: "1px solid var(--c-ink-10)" }}>
              {executives.map((x) => (
                <label key={x.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer text-sm border-b last:border-0"
                  style={{ borderColor: "var(--c-ink-08)" }}>
                  <input type="checkbox" checked={ccIds.has(x.id)} onChange={() => toggleCc(x.id)}
                    style={{ accentColor: "var(--c-gold)" }} />
                  <span className="truncate">
                    {x.name}
                    {x.role && x.role !== "executive" && <span className="opacity-50"> · {ROLE_LABELS[x.role] || x.role}</span>}
                  </span>
                </label>
              ))}
            </div>
            {ccIds.size === 0 && <div className="text-xs mt-1" style={{ color: "var(--c-rust)" }}>Choose at least one person.</div>}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!ok || busy} onClick={save}>{stage ? "Save" : "Add stage"}</button>
        </div>
      </div>
    </ModalShell>
  );
}
