import { useState, useEffect, lazy, Suspense } from "react";
import { Eye, CheckCircle, ShieldCheck, EyeOff, X } from "lucide-react";
import { api } from "../api.js";
import { RequestRow } from "../components/RequestRow.jsx";

// Pulls in pdfjs only when a document is actually opened.
const DocPreview = lazy(() => import("../viewer.jsx").then(m => ({ default: m.DocPreview })));

// The assistant's dashboard: every executive they support, each with that
// executive's signing queue. Documents are always viewable; the Approve action
// appears only when the executive has switched on "Can approve" (canApprove).
export function ExecutiveAssistantView(props) {
  const { user, users, teams, notify } = props;
  const [execs, setExecs] = useState(null);
  const [queues, setQueues] = useState({});   // executiveId -> requests[]
  const [preview, setPreview] = useState(null); // request being viewed
  const [busyId, setBusyId] = useState(null);

  const loadExecs = async () => {
    try { setExecs(await api.assistExecutives()); }
    catch (e) { notify(e.message || "Could not load your executives", "error"); setExecs([]); }
  };
  const loadQueue = async (executiveId) => {
    try { const rs = await api.assistRequests(executiveId); setQueues(q => ({ ...q, [executiveId]: rs })); }
    catch (e) { notify(e.message || "Could not load documents", "error"); }
  };
  useEffect(() => { loadExecs(); }, []);
  useEffect(() => { (execs || []).forEach(e => loadQueue(e.id)); }, [execs]);

  const approve = async (executiveId, reqId) => {
    setBusyId(reqId);
    try {
      await api.assistApprove(executiveId, reqId);
      notify("Approved on behalf of the executive.", "success");
      await loadQueue(executiveId);
    } catch (e) { notify(e.message || "Approval failed", "error"); }
    finally { setBusyId(null); }
  };

  if (execs === null) return <div className="card p-10 text-sm opacity-50 text-center">Loading…</div>;

  return (
    <div className="space-y-6">
      <div>
        <div className="font-display text-2xl sm:text-3xl">Welcome, {user.name.split(" ")[0]}</div>
        <div className="text-sm opacity-60">Documents for the executives you support.</div>
      </div>

      {execs.length === 0 && (
        <div className="card p-8 text-center text-sm opacity-60">
          No executives are assigned to you yet. Ask an administrator (or the executive) to link you.
        </div>
      )}

      {execs.map(ex => {
        const rs = queues[ex.id] || [];
        const pending = rs.filter(r => r.status === "pending");
        return (
          <div key={ex.id} className="card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="min-w-0">
                <div className="font-display text-lg truncate">{ex.name}</div>
                <div className="text-xs opacity-50 truncate">{ex.email}</div>
              </div>
              <span className="text-[11px] px-2.5 py-1 rounded-full inline-flex items-center gap-1 shrink-0"
                style={ex.canApprove
                  ? { backgroundColor: "rgba(22,120,60,.10)", color: "#16783c" }
                  : { backgroundColor: "rgba(15,26,46,.06)", color: "var(--c-ink)" }}>
                {ex.canApprove ? <ShieldCheck size={13} /> : <EyeOff size={13} />}
                {ex.canApprove ? "Can approve" : "View only"}
              </span>
            </div>

            {pending.length === 0 ? (
              <div className="text-sm opacity-40 py-2">No documents awaiting signature.</div>
            ) : (
              <div>
                {pending.map((r, i) => (
                  <RequestRow key={r.id} r={r} teams={teams} users={users} i={i}
                    actions={
                      <div className="flex items-center gap-2">
                        <button className="btn-ghost text-xs" onClick={() => setPreview(r)}>
                          <Eye size={14} /> View
                        </button>
                        {ex.canApprove && (
                          <button className="btn-primary text-xs" disabled={busyId === r.id}
                            onClick={() => approve(ex.id, r.id)}>
                            <CheckCircle size={14} /> {busyId === r.id ? "Signing…" : "Approve"}
                          </button>
                        )}
                      </div>
                    }
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {preview && <AssistPreview req={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

// Read-only, full-screen document preview.
function AssistPreview({ req, onClose }) {
  const [fileUrl, setFileUrl] = useState(null);
  useEffect(() => {
    let url;
    api.getRequestFileBlob(req.id).then(u => { url = u; setFileUrl(u); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [req.id]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: "rgba(15,26,46,.75)" }} onClick={onClose}>
      <div className="bg-white m-auto rounded-lg overflow-hidden w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="text-sm font-medium truncate pr-4">{req.fileName || "Document"}</div>
          <button className="btn-ghost text-xs" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="overflow-auto p-3" style={{ backgroundColor: "#f3f4f6" }}>
          {fileUrl
            ? <Suspense fallback={<div className="p-10 text-sm opacity-50 text-center">Loading viewer…</div>}>
                <DocPreview file={fileUrl} fill />
              </Suspense>
            : <div className="p-10 text-sm opacity-50 text-center">Loading document…</div>}
        </div>
      </div>
    </div>
  );
}
