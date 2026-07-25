import { useState } from "react";
import { UserPlus, Stamp, Shield, Briefcase, UserCog, Check } from "lucide-react";
import { ModalShell } from "./ModalShell.jsx";
import { api } from "../api.js";

// Admin changes an existing user's role from a proper dialog — replaces an
// inline dropdown that was too cramped in the table column and unreliable
// across browsers. One step: pick a role card, read the spelled-out side
// effects, hit "Change role".
const ROLE_OPTIONS = [
  { key: "requestor", icon: UserPlus, label: "Requestor", desc: "Submits documents for approval." },
  { key: "approver", icon: Stamp, label: "Approver", desc: "Signs documents for teams they hold authority over." },
  { key: "executive", icon: Briefcase, label: "Executive", desc: "Senior signer — like an approver, and can have an assistant act on their behalf." },
  { key: "executive_assistant", icon: UserCog, label: "Executive Assistant", desc: "Views and (when allowed) signs documents on behalf of executives." },
  { key: "admin", icon: Shield, label: "Administrator", desc: "Full control of users, teams, signatures, and audit." },
];

// What changing FROM the current role TO the picked one will clean up.
function sideEffects(fromRole, toRole) {
  const isSignerRole = (r) => r === "approver" || r === "executive";
  const notes = [];
  if (isSignerRole(fromRole) && !isSignerRole(toRole)) notes.push("Their signing authority will be cleared.");
  if (fromRole === "executive" && toRole !== "executive") notes.push("Their assistant links will be removed.");
  if (fromRole === "executive_assistant" && toRole !== "executive_assistant") notes.push("Their executive links will be removed.");
  return notes;
}

export function RoleChangeModal({ target, notify, onClose, onSaved }) {
  const [picked, setPicked] = useState(target.role);
  const [busy, setBusy] = useState(false);
  const notes = picked !== target.role ? sideEffects(target.role, picked) : [];

  const apply = async () => {
    if (picked === target.role) { onClose(); return; }
    setBusy(true);
    try {
      await api.setUserRole(target.id, picked);
      notify(`${target.name} is now ${ROLE_OPTIONS.find(r => r.key === picked)?.label || picked}`, "success");
      await onSaved?.();
      onClose();
    } catch (e) {
      notify(e.message || "Could not change role", "error");
      setBusy(false);
    }
  };

  return (
    <ModalShell title={`Change role — ${target.name}`} onClose={onClose}>
      <div className="text-sm opacity-60 mb-4">
        Their documents, signature and history stay intact. Current role:{" "}
        <span className="pill pill-pending">{target.role}</span>
      </div>
      <div className="space-y-2 mb-4">
        {ROLE_OPTIONS.map(r => {
          const Icon = r.icon;
          const active = picked === r.key;
          return (
            <button key={r.key} type="button" onClick={() => setPicked(r.key)}
              className={`card p-3 w-full text-left flex items-start gap-3 tile-hover ${active ? "ring-2" : ""}`}
              style={{
                borderColor: active ? "#B8894A" : undefined,
                backgroundColor: active ? "rgba(184,137,74,.08)" : undefined,
              }}>
              <Icon size={16} className="opacity-70 mt-0.5 shrink-0" />
              <span className="min-w-0">
                <span className="font-medium text-sm block">{r.label}{r.key === target.role ? " (current)" : ""}</span>
                <span className="text-xs opacity-60 block mt-0.5">{r.desc}</span>
              </span>
            </button>
          );
        })}
      </div>
      {notes.length > 0 && (
        <div className="text-xs px-3 py-2 rounded mb-4" style={{ backgroundColor: "rgba(184,137,74,.12)" }}>
          {notes.map((n, i) => <div key={i}>{n}</div>)}
        </div>
      )}
      <div className="flex justify-end gap-3">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={apply} disabled={busy || picked === target.role}>
          <Check size={15} /> {busy ? "Changing…" : "Change role"}
        </button>
      </div>
    </ModalShell>
  );
}
