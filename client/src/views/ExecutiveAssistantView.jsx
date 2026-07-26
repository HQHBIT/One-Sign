import { useState, useEffect, lazy, Suspense } from "react";
import { Eye, CheckCircle, ShieldCheck, EyeOff, X, PenTool, User, Briefcase, Clock, XCircle } from "lucide-react";
import { api } from "../api.js";
import { RequestRow } from "../components/RequestRow.jsx";
import { SignatureModal } from "../components/SignatureModal.jsx";

// Pulls in pdfjs only when a document is actually opened.
const DocPreview = lazy(() => import("../viewer.jsx").then(m => ({ default: m.DocPreview })));

// The assistant's workspace. They sign in with their OWN credentials, then use
// the switcher to move between "My account" — their full personal dashboard,
// identical to any other user's (raise requests, track pending / approved /
// rejected) — and each executive they support. What each executive panel shows
// follows exactly the rights that executive granted (also enforced server-side):
// dashboard = the executive's entire data; view = pending queue; approve /
// update-signature add their buttons. PersonalView is injected from App.jsx (the
// standard requestor dashboard) so both experiences stay identical by
// construction rather than by copy.
export function ExecutiveAssistantView(props) {
  const { user, users, teams, notify, PersonalView } = props;
  const [execs, setExecs] = useState(null);
  const [active, setActive] = useState("me"); // "me" | executiveId

  useEffect(() => {
    api.assistExecutives().then(setExecs).catch(e => { notify(e.message || "Could not load your executives", "error"); setExecs([]); });
  }, []);

  if (execs === null) return <div className="card p-10 text-sm opacity-50 text-center">Loading…</div>;
  const current = execs.find(x => x.id === active);

  return (
    <div className="space-y-5">
      {/* Account switcher */}
      <div className="flex flex-wrap items-center gap-2">
        <SwitchTab active={active === "me"} onClick={() => setActive("me")} icon={User} label="My account" />
        {execs.map(ex => (
          <SwitchTab key={ex.id} active={active === ex.id} onClick={() => setActive(ex.id)} icon={Briefcase} label={ex.name} />
        ))}
        {execs.length === 0 && (
          <span className="text-xs opacity-50">No executives linked yet — an administrator (or the executive) can add you from their “My assistant” menu.</span>
        )}
      </div>

      {active === "me"
        ? (PersonalView ? <PersonalView {...props} /> : null)
        : current ? <ExecutivePanel key={current.id} ex={current} users={users} teams={teams} notify={notify} /> : null}
    </div>
  );
}

function SwitchTab({ active, onClick, icon: Icon, label }) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm tile-hover"
      style={active
        ? { backgroundColor: "var(--c-ink)", color: "var(--c-cream)" }
        : { backgroundColor: "rgba(15,26,46,.06)" }}>
      <Icon size={14} /> <span className="max-w-[12rem] truncate">{label}</span>
    </button>
  );
}

// One executive's workspace, scoped by the rights they granted.
function ExecutivePanel({ ex, users, teams, notify }) {
  const [data, setData] = useState(null); // { requests, scope }
  const [tab, setTab] = useState("pending");
  const [preview, setPreview] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [sigOpen, setSigOpen] = useState(false);

  const load = () => api.assistRequests(ex.id)
    .then(setData)
    .catch(e => { notify(e.message || "Could not load documents", "error"); setData({ requests: [], scope: "pending" }); });
  useEffect(() => { load(); }, [ex.id]);

  const approve = async (reqId) => {
    setBusyId(reqId);
    try {
      await api.assistApprove(ex.id, reqId);
      notify(`Approved on behalf of ${ex.name}. They've been notified.`, "success");
      await load();
    } catch (e) { notify(e.message || "Approval failed", "error"); }
    finally { setBusyId(null); }
  };

  if (!ex.canView && !ex.canDashboard) {
    return (
      <div className="card p-8 text-center text-sm opacity-60">
        <EyeOff size={18} className="mx-auto mb-2 opacity-50" />
        {ex.name} hasn't granted you document access yet.
        {ex.canUpdateSignature && <SigButton onClick={() => setSigOpen(true)} />}
        {sigOpen && <SigModal ex={ex} notify={notify} onClose={() => setSigOpen(false)} />}
      </div>
    );
  }

  const rs = data?.requests || [];
  const pending = rs.filter(r => r.status === "pending");
  const approved = rs.filter(r => r.status === "approved" || r.status === "approved_pending");
  const rejected = rs.filter(r => r.status === "rejected");
  const list = ex.canDashboard ? ({ pending, approved, rejected }[tab] || pending) : pending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display text-xl truncate">{ex.name}</div>
          <div className="text-xs opacity-50 truncate">{ex.email}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] px-2.5 py-1 rounded-full inline-flex items-center gap-1"
            style={ex.canApprove ? { backgroundColor: "rgba(22,120,60,.10)", color: "#16783c" } : { backgroundColor: "rgba(15,26,46,.06)" }}>
            {ex.canApprove ? <ShieldCheck size={13} /> : <EyeOff size={13} />}
            {ex.canApprove ? "Can approve" : "View only"}
          </span>
          {ex.canUpdateSignature && <SigButton onClick={() => setSigOpen(true)} />}
        </div>
      </div>

      {/* Every right this executive has granted, at a glance */}
      <div className="flex flex-wrap gap-1.5">
        {[
          [ex.canView || ex.canDashboard, "View documents"],
          [ex.canDashboard, "Full dashboard"],
          [ex.canApprove, "Approve on behalf"],
          [ex.canUpdateSignature, "Update signature"],
          [ex.canNotify, "Receives notifications"],
        ].map(([on, label]) => (
          <span key={label} className="text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
            style={on
              ? { backgroundColor: "rgba(22,120,60,.10)", color: "#16783c" }
              : { backgroundColor: "rgba(15,26,46,.05)", opacity: .55 }}>
            {on ? "✓" : "—"} {label}
          </span>
        ))}
      </div>

      {/* Stats + tabs — only with the dashboard right (the executive's entire data) */}
      {ex.canDashboard && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <StatTile icon={Clock} label="Pending" n={pending.length} active={tab === "pending"} onClick={() => setTab("pending")} />
          <StatTile icon={CheckCircle} label="Approved" n={approved.length} active={tab === "approved"} onClick={() => setTab("approved")} />
          <StatTile icon={XCircle} label="Rejected" n={rejected.length} active={tab === "rejected"} onClick={() => setTab("rejected")} />
        </div>
      )}

      <div className="card p-4 sm:p-5">
        {data === null ? (
          <div className="text-sm opacity-40 py-4 text-center">Loading…</div>
        ) : list.length === 0 ? (
          <div className="text-sm opacity-40 py-4 text-center">No {ex.canDashboard ? tab : "pending"} documents.</div>
        ) : (
          list.map((r, i) => (
            <RequestRow key={r.id} r={r} teams={teams} users={users} i={i}
              actions={
                <div className="flex items-center gap-2">
                  <button className="btn-ghost text-xs" onClick={() => setPreview(r)}><Eye size={14} /> View</button>
                  {ex.canApprove && r.status === "pending" && (
                    <button className="btn-primary text-xs" disabled={busyId === r.id} onClick={() => approve(r.id)}>
                      <CheckCircle size={14} /> {busyId === r.id ? "Signing…" : "Approve"}
                    </button>
                  )}
                </div>
              }
            />
          ))
        )}
      </div>

      {preview && <AssistPreview req={preview} onClose={() => setPreview(null)} />}
      {sigOpen && <SigModal ex={ex} notify={notify} onClose={() => setSigOpen(false)} />}
    </div>
  );
}

function StatTile({ icon: Icon, label, n, active, onClick }) {
  return (
    <button onClick={onClick} className={`card p-3 text-left tile-hover ${active ? "ring-2" : ""}`}
      style={active ? { borderColor: "#B8894A", backgroundColor: "rgba(184,137,74,.08)" } : undefined}>
      <Icon size={14} className="opacity-60 mb-1" />
      <div className="font-display text-xl leading-none">{n}</div>
      <div className="text-[10px] tracking-wider uppercase opacity-50 mt-1">{label}</div>
    </button>
  );
}

const SigButton = ({ onClick }) => (
  <button className="btn-ghost text-xs" onClick={onClick} title="Upload or replace the executive's signature">
    <PenTool size={14} /> Executive's signature
  </button>
);

// Draw/upload a signature FOR the executive (server checks the right again).
function SigModal({ ex, notify, onClose }) {
  return (
    <SignatureModal
      title={`Signature — ${ex.name}`}
      subtitle="This signature is stamped when documents are signed in the executive's name. The executive is notified of the change."
      onCancel={onClose}
      currentUserId={ex.executiveHasSignature ? ex.id : null}
      onSave={async dataUrl => {
        await api.assistSetSignature(ex.id, dataUrl);
        notify(`Signature updated for ${ex.name}. They've been notified.`, "success");
        onClose();
      }}
    />
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
