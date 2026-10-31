import { useState, useEffect, lazy, Suspense } from "react";
import { Eye, CheckCircle, ShieldCheck, EyeOff, X, PenTool, User, Briefcase, XCircle, KanbanSquare, Stamp, Hourglass, Inbox } from "lucide-react";
import { api } from "../api.js";
import { RequestRow } from "../components/RequestRow.jsx";
import { SignatureModal } from "../components/SignatureModal.jsx";
import { Tile } from "../components/Tile.jsx";
import { BackHeader } from "../components/BackHeader.jsx";
import { FolderedList } from "../components/FolderedList.jsx";
import { ModalShell } from "../components/ModalShell.jsx";
import { nextPendingSigner } from "../lib/turn.js";
import { FlowTab } from "./ea-flow/FlowTab.jsx";

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
  const { user, users, teams, notify, PersonalView, ReviewDrawer, orgId } = props;
  const [execs, setExecs] = useState(null);
  const [active, setActive] = useState("me"); // "me" | executiveId | "flow"
  // The document flow (boards of stages, dashboard) exists on HQHB only; the
  // server refuses it elsewhere, this just keeps the tab out of the way.
  const flowOn = orgId === "hqhb";

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
        {flowOn && <SwitchTab active={active === "flow"} onClick={() => setActive("flow")} icon={KanbanSquare} label="Document flow" />}
        {execs.length === 0 && (
          <span className="text-xs opacity-50">No executives linked yet — an administrator (or the executive) can add you from their “My assistant” menu.</span>
        )}
      </div>

      {active === "me"
        ? (PersonalView ? <PersonalView {...props} /> : null)
        : active === "flow" && flowOn
          ? <FlowTab notify={notify} />
          : current ? <ExecutivePanel key={current.id} ex={current} user={user} users={users} teams={teams} notify={notify} ReviewDrawer={ReviewDrawer} /> : null}
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

// One executive's workspace, scoped by the rights they granted — laid out like
// the approver's own dashboard: what is waiting for the executive first, then a
// tile per list, each opening on its own page (owner, 2026-10-31: one long page
// "breaks the UI"; "the same UI/UX as our dashboard … and approved requests").
function ExecutivePanel({ ex, user, users, teams, notify, ReviewDrawer }) {
  const [data, setData] = useState(null); // { requests, scope }
  const [forInfo, setForInfo] = useState([]); // sent to the executive to read
  const [view, setView] = useState("home"); // home | awaiting | others | for-review | approved | rejected
  const [preview, setPreview] = useState(null);
  const [readPreview, setReadPreview] = useState(null);
  const [sigOpen, setSigOpen] = useState(false);
  // The document open in the review drawer — the approver's own drawer
  // (Preview & approve, Go to signature, Approve, Recommend changes, Reject),
  // acting for this executive.
  const [reviewing, setReviewing] = useState(null);

  const load = () => api.assistRequests(ex.id)
    .then(setData)
    .catch(e => { notify(e.message || "Could not load documents", "error"); setData({ requests: [], scope: "pending" }); });
  const loadForInfo = () => api.assistForInfo(ex.id).then(setForInfo).catch(() => setForInfo([]));
  useEffect(() => { load(); loadForInfo(); setView("home"); }, [ex.id]);

  // The three decisions, each on the executive's behalf. Same signatures as the
  // approver's own handlers, so the drawer cannot tell the difference.
  const approveRequest = async (reqId, instant, _sigId, addDate) => {
    try {
      await api.assistApprove(ex.id, reqId, { instant, addDate });
      notify(`Approved on behalf of ${ex.name}. They've been notified.`, "success");
      await load();
    } catch (e) { notify(e.message || "Approval failed", "error"); }
  };
  const rejectRequest = async (reqId, reason, voice) => {
    try {
      await api.assistReject(ex.id, reqId, reason, voice);
      notify(`Rejected on behalf of ${ex.name}. They've been notified.`, "success");
      await load();
    } catch (e) { notify(e.message || "Could not reject", "error"); throw e; }
  };
  const recommendChanges = async (reqId, text) => {
    try {
      await api.assistRecommend(ex.id, reqId, text);
      notify(`Sent back for changes on behalf of ${ex.name}. They've been notified.`, "success");
      await load();
      return true;
    } catch (e) { notify(e.message || "Could not send it back", "error"); return false; }
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

  const first = String(ex.name || "").split(" ")[0];
  const rs = data?.requests || [];
  // Whose turn: a workflow's next pending signer; a single-team request is the
  // executive's as soon as it is pending.
  const theirTurn = (r) => r.status === "pending" && (!(r.workflow?.length) || nextPendingSigner(r)?.userId === ex.id);
  const awaiting = rs.filter(theirTurn);
  const others = rs.filter((r) => r.status === "pending" && !theirTurn(r));
  const approved = rs.filter(r => r.status === "approved" || r.status === "approved_pending");
  const rejected = rs.filter(r => r.status === "rejected");
  const unreadForInfo = forInfo.filter((d) => !d.viewedAt).length;

  const actionsFor = (r) => (
    <div className="flex items-center gap-2">
      {/* Approving opens the approver's own drawer: read it, Go to signature,
          preview the stamp, then Approve — or Recommend changes / Reject. */}
      {ex.canApprove && theirTurn(r) && ReviewDrawer && !r.confidential ? (
        <button className="btn-primary text-xs" onClick={() => setReviewing(r)}>
          <Eye size={14} /> Preview & approve
        </button>
      ) : (
        <button className="btn-ghost text-xs" onClick={() => setPreview(r)}><Eye size={14} /> View</button>
      )}
    </div>
  );
  const listPage = (items, title, countLabel, emptyText) => (
    <FolderedList items={items} title={`${title} — ${ex.name}`} back={() => setView("home")} notify={notify}
      emptyIcon={Inbox} emptyText={emptyText} countLabel={countLabel}
      renderRow={(r, i, moveMenu, rowProps) => (
        <RequestRow key={r.id} r={r} teams={teams} users={users} i={i} {...rowProps}
          actions={<div className="flex flex-wrap gap-2">{actionsFor(r)}{moveMenu}</div>} />
      )} />
  );

  const drawers = (
    <>
      {preview && <AssistPreview req={preview} onClose={() => setPreview(null)} />}
      {readPreview && <ForInfoPreview ex={ex} doc={readPreview} onClose={() => setReadPreview(null)} />}
      {reviewing && ReviewDrawer && (
        <ReviewDrawer req={reviewing}
          // The drawer works out whose turn it is from `user`: here, the executive.
          user={{ ...user, id: ex.id, name: ex.name }}
          users={users} teams={teams} notify={notify}
          approveRequest={approveRequest} rejectRequest={rejectRequest} recommendChanges={recommendChanges}
          onClose={() => setReviewing(null)}
          actingFor={{ name: ex.name, canAct: !!ex.canApprove, signatureBlob: () => api.assistSignatureBlob(ex.id) }} />
      )}
      {sigOpen && <SigModal ex={ex} notify={notify} onClose={() => setSigOpen(false)} />}
    </>
  );

  // ---- a list, on its own page ----
  if (view !== "home") {
    let page = null;
    if (view === "awaiting") page = listPage(awaiting, `Awaiting ${first}`, "waiting", `Nothing is waiting for ${ex.name}.`);
    if (view === "others") page = listPage(others, "With others first", "waiting", "Nothing is waiting on someone else first.");
    if (view === "approved" && ex.canDashboard) page = listPage(approved, "Approved", "approved", "Nothing approved yet.");
    if (view === "rejected" && ex.canDashboard) page = listPage(rejected, "Rejected", "rejected", "Nothing rejected.");
    if (view === "for-review") page = (
      <ForInfoList ex={ex} items={forInfo} back={() => setView("home")} onOpen={setReadPreview} />
    );
    return <div>{page}{drawers}</div>;
  }

  // ---- home ----
  const tiles = [
    { key: "awaiting", icon: Stamp, title: `Awaiting ${first}`, desc: `Documents whose turn it is for ${ex.name} to sign.`, badge: awaiting.length, color: "var(--c-gold)" },
    { key: "others", icon: Hourglass, title: "With others first", desc: `${ex.name} signs later — someone earlier in the route signs first.`, badge: others.length },
    { key: "for-review", icon: Eye, title: "For review", desc: `Documents shared with ${ex.name} to read — and whether they have opened them.`, badge: unreadForInfo, color: "var(--c-gold)" },
    ...(ex.canDashboard ? [
      { key: "approved", icon: CheckCircle, title: "Approved", desc: `Documents ${ex.name} has signed.`, badge: approved.length },
      { key: "rejected", icon: XCircle, title: "Rejected", desc: `Documents ${ex.name} has rejected.`, badge: rejected.length },
    ] : []),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display text-2xl truncate">{ex.name}</div>
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

      {/* What is waiting for the executive — first, never buried; at most five. */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="font-display text-xl">Awaiting {first}</h3>
          {awaiting.length > 5 && (
            <button className="text-xs tracking-wider uppercase opacity-60 hover:opacity-100 underline" onClick={() => setView("awaiting")}>
              See all {awaiting.length}
            </button>
          )}
        </div>
        {data === null ? (
          <div className="card p-5 text-sm opacity-40">Loading…</div>
        ) : awaiting.length === 0 ? (
          <div className="card p-5 text-sm opacity-50 flex items-center gap-2"><CheckCircle size={15} /> Nothing waiting for {ex.name}.</div>
        ) : (
          <div className="card overflow-hidden">
            {awaiting.slice(0, 5).map((r, i) => (
              <RequestRow key={r.id} r={r} teams={teams} users={users} i={i} actions={actionsFor(r)} />
            ))}
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {tiles.map((t) => <Tile key={t.key} {...t} onClick={() => setView(t.key)} />)}
      </div>

      {drawers}
    </div>
  );
}

// What the executive was sent to read — and whether THEY have opened it. The
// assistant opening it here does not mark it read for the executive.
function ForInfoList({ ex, items, back, onOpen }) {
  const unread = items.filter((d) => !d.viewedAt).length;
  return (
    <div>
      <BackHeader back={back} title={`For review — ${ex.name}`} step={items.length ? `${unread} not opened by ${String(ex.name).split(" ")[0]}` : "nothing shared"} />
      <div className="card overflow-hidden mt-5">
        {items.length === 0 ? (
          <div className="p-8 text-sm opacity-50 text-center">Nothing has been shared with {ex.name} to read.</div>
        ) : items.map((d) => (
          <div key={d.id + d.notifiedAt} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 sm:px-5 py-4 border-b last:border-0" style={{ borderColor: "var(--c-ink-08)" }}>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm" style={{ overflowWrap: "anywhere" }}>{d.title}</div>
              <div className="text-xs opacity-60 mt-0.5">
                {d.stageName} · {d.boardName} · from {d.fromName} · {new Date(d.notifiedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {d.viewedAt
                ? <span className="pill pill-approved" title={new Date(d.viewedAt).toLocaleString("en-IN")}><Eye size={10} /> Opened by {String(ex.name).split(" ")[0]}</span>
                : <span className="pill pill-pending"><Hourglass size={10} /> Not opened yet</span>}
              <button className="btn-ghost text-xs" onClick={() => onOpen(d)}><Eye size={14} /> Open</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ForInfoPreview({ ex, doc, onClose }) {
  const [file, setFile] = useState(null);
  const [failed, setFailed] = useState(null);
  useEffect(() => {
    let url;
    api.assistForInfoFileUrl(ex.id, doc.id)
      .then((u) => { url = u; setFile({ name: doc.fileName, base64: u, ext: doc.fileType === "pdf" ? "pdf" : "xlsx" }); })
      .catch((e) => setFailed(e?.message || "This document could not be opened"));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [doc.id]);
  return (
    <ModalShell title={doc.title} subtitle={`Shared with ${ex.name} · from ${doc.fromName}`} size="xl" onClose={onClose}>
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-ink-10)", minHeight: 320 }}>
        {file
          ? <Suspense fallback={<div className="p-10 text-sm opacity-50 text-center">Opening…</div>}><DocPreview file={file} /></Suspense>
          : <div className="p-10 text-sm text-center" style={failed ? { color: "var(--c-rust)" } : { opacity: 0.5 }}>{failed || "Opening the document…"}</div>}
      </div>
    </ModalShell>
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
  const [failed, setFailed] = useState(null);
  useEffect(() => {
    let url;
    // The signed copy once there is one, as the approver's own preview does.
    const isPdf = req.fileType === "pdf";
    const kind = req.hasSignedFile && isPdf ? "signed" : "file";
    // A refusal used to be swallowed, leaving "Loading document…" for ever.
    // DocPreview needs a file DESCRIPTION — name, type, data — not a bare
    // link: given only a link it could not tell a PDF from a spreadsheet and
    // drew an empty page (owner, 2026-10-31).
    api.getRequestFileBlob(req.id, kind)
      .then(u => { url = u; setFileUrl({ name: req.fileName, base64: u, ext: isPdf ? "pdf" : "xlsx" }); })
      .catch((e) => setFailed(e?.message || "This document could not be opened"));
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
            : <div className="p-10 text-sm text-center" style={failed ? { color: "var(--c-rust)" } : { opacity: 0.5 }}>{failed || "Loading document…"}</div>}
        </div>
      </div>
    </div>
  );
}
