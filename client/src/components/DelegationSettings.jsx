import { useState, useEffect } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { ModalShell } from "./ModalShell.jsx";
import { api } from "../api.js";

// Manage executive ↔ assistant links. An executive sees/edits only their own
// links (backend-scoped); an admin sees and manages every link and also picks
// which executive a link is for. Each link carries the executive's delegation
// settings: the can-approve toggle and whose signature is stamped.
export function DelegationSettings({ user, notify, onClose }) {
  const isAdmin = user.role === "admin";
  const [links, setLinks] = useState(null);
  const [assistants, setAssistants] = useState([]);
  const [executives, setExecutives] = useState([]);
  const [newAssistant, setNewAssistant] = useState("");
  const [newExecutive, setNewExecutive] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [l, a] = await Promise.all([api.execAssistLinks(), api.assistantCandidates()]);
      setLinks(l); setAssistants(a);
      if (isAdmin) setExecutives(await api.executiveCandidates());
    } catch (e) { notify(e.message || "Could not load assistants", "error"); setLinks([]); }
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!newAssistant || (isAdmin && !newExecutive)) return;
    setBusy(true);
    try {
      await api.createExecAssistLink(isAdmin ? { executiveId: newExecutive, assistantId: newAssistant } : { assistantId: newAssistant });
      setNewAssistant(""); setNewExecutive("");
      await load();
      notify("Assistant linked.", "success");
    } catch (e) { notify(e.message || "Could not link assistant", "error"); }
    finally { setBusy(false); }
  };

  const patch = async (id, body) => {
    try { await api.updateExecAssistLink(id, body); await load(); }
    catch (e) { notify(e.message || "Update failed", "error"); }
  };
  const remove = async (id) => {
    try { await api.deleteExecAssistLink(id); await load(); notify("Assistant unlinked.", "success"); }
    catch (e) { notify(e.message || "Could not remove", "error"); }
  };

  return (
    <ModalShell title={isAdmin ? "Executive assistants" : "My assistant"} onClose={onClose}>
      <div className="text-sm opacity-60 mb-4">
        {isAdmin
          ? "Link an assistant to an executive. Each link's owner (the executive or you) controls whether the assistant may approve, and whose signature is stamped."
          : "Link an assistant who can view your documents. They stay view-only until you switch on “Can approve” — then they can sign on your behalf."}
      </div>

      {/* add row */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {isAdmin && (
          <select className="input text-sm" value={newExecutive} onChange={e => setNewExecutive(e.target.value)} style={{ minWidth: 140 }}>
            <option value="">Executive…</option>
            {executives.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        )}
        <select className="input text-sm" value={newAssistant} onChange={e => setNewAssistant(e.target.value)} style={{ minWidth: 160 }}>
          <option value="">Choose an assistant…</option>
          {assistants.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button className="btn-primary text-sm" onClick={add} disabled={busy || !newAssistant || (isAdmin && !newExecutive)}>
          <UserPlus size={15} /> Link
        </button>
      </div>

      {/* existing links */}
      {links === null ? (
        <div className="text-sm opacity-50">Loading…</div>
      ) : links.length === 0 ? (
        <div className="text-sm opacity-50">No assistants linked yet.</div>
      ) : (
        <div className="space-y-3">
          {links.map(l => (
            <div key={l.id} className="rounded-lg p-3" style={{ backgroundColor: "rgba(15,26,46,.04)" }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{l.assistantName}</div>
                  <div className="text-xs opacity-50 truncate">
                    {l.assistantEmail}{isAdmin ? ` · for ${l.executiveName}` : ""}
                  </div>
                </div>
                <button className="text-xs opacity-60 hover:opacity-100 shrink-0" onClick={() => remove(l.id)} title="Unlink">
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={l.canApprove} onChange={e => patch(l.id, { canApprove: e.target.checked })} />
                  Can approve on my behalf
                </label>
                <label className="flex items-center gap-2 text-xs opacity-80">
                  Sign with:
                  <select className="input text-xs" value={l.signatureSource} onChange={e => patch(l.id, { signatureSource: e.target.value })} disabled={!l.canApprove}>
                    <option value="executive">Executive's signature</option>
                    <option value="assistant">Assistant's own signature</option>
                  </select>
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  );
}
