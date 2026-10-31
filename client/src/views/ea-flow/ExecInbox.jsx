import { useEffect, useState, lazy, Suspense } from "react";
import { Inbox, Eye, KanbanSquare, ArrowRight, FileText, FileSpreadsheet, Clock, CircleCheck, User } from "lucide-react";
import { api } from "../../api.js";
import { ModalShell } from "../../components/ModalShell.jsx";
import { fmtWhen } from "./time.js";

const DocPreview = lazy(() => import("../../viewer.jsx").then(m => ({ default: m.DocPreview })));

// ============================================================
//   FILES FOR SENIOR EXECUTIVE MANAGEMENT
//   ------------------------------------------------------------
//   Every document an employee has sent for signature to an executive this
//   assistant supports (their Delegation links). The request still goes to the
//   executive exactly as before; from here the assistant reviews it, sees whom
//   the employee asked, and puts it on one of their boards — where it moves
//   through stages, can be sent for review, or on to another executive to sign.
// ============================================================
export function ExecInbox({ boards, notify, onPlaced, onOpenBoard }) {
  const [data, setData] = useState(null);       // { executives, items }
  const [who, setWho] = useState("all");        // executive filter
  const [preview, setPreview] = useState(null); // item
  const [placing, setPlacing] = useState(null); // item

  const load = () => api.eaInbox().then(setData)
    .catch((e) => { notify(e.message || "Could not load the files", "error"); setData({ executives: [], items: [] }); });
  useEffect(() => { load(); }, []);

  if (data === null) return <div className="card p-10 text-sm opacity-50 text-center">Loading…</div>;
  const { executives, items } = data;
  const forWho = (it) => it.steps.flatMap((st) => st.signers).filter((s) => s.mine).map((s) => s.name);
  const shown = who === "all" ? items : items.filter((it) => forWho(it).includes(who));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-display text-2xl">Files for Senior Executive Management</div>
          <div className="text-xs opacity-60 mt-0.5">
            Documents employees have sent for signature to {executives.length ? executives.map((e) => e.name).join(", ") : "your executives"}.
            They still reach the executive as usual — put one on a board to route it from here.
          </div>
        </div>
      </div>

      {executives.length === 0 ? (
        <div className="card p-8 text-center text-sm opacity-70">
          <User size={18} className="mx-auto mb-2 opacity-50" />
          No executives are linked to you with document access yet. The executive (or IT Admin) can add you under <span className="font-medium">Delegation</span>, with “View documents” on.
        </div>
      ) : (
        <>
          {/* Filter by executive — counts say where the work is. */}
          <div className="flex flex-wrap gap-1.5">
            {[["all", `All · ${items.length}`], ...executives.map((e) => [e.name, `${e.name} · ${items.filter((it) => forWho(it).includes(e.name)).length}`])].map(([k, label]) => (
              <button key={k} onClick={() => setWho(k)} className="rounded-full px-3 py-1.5 text-xs"
                style={who === k ? { backgroundColor: "var(--c-ink)", color: "var(--c-cream)" } : { backgroundColor: "rgba(15,26,46,.06)" }}>
                {label}
              </button>
            ))}
          </div>

          <div className="card p-2 sm:p-3">
            {shown.length === 0 ? (
              <div className="text-sm opacity-50 py-8 text-center">
                <Inbox size={20} className="mx-auto mb-2 opacity-40" />
                Nothing waiting for {who === "all" ? "your executives" : who} right now.
              </div>
            ) : shown.map((it) => (
              <div key={it.requestId} className="flex flex-col sm:flex-row sm:items-center gap-3 px-3 py-3 border-b last:border-0" style={{ borderColor: "var(--c-ink-08)" }}>
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(15,26,46,.06)" }}>
                    {it.fileType === "pdf" ? <FileText size={14} /> : <FileSpreadsheet size={14} />}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-sm" style={{ overflowWrap: "anywhere" }}>{it.fileName}</div>
                    <div className="text-xs opacity-60 mt-0.5">
                      From <span className="font-medium">{it.requestorName || "—"}</span> · {fmtWhen(it.createdAt)}
                      {it.teamName ? ` · ${it.teamName}` : ""}
                    </div>
                    <Asked item={it} />
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap shrink-0 sm:justify-end">
                  {it.onBoard ? (
                    <button className="pill pill-approved" style={{ textTransform: "none", letterSpacing: 0 }}
                      onClick={() => onOpenBoard(it.onBoard.boardId)} title="Open that board">
                      <KanbanSquare size={10} /> {it.onBoard.boardName} · {it.onBoard.stageName}
                    </button>
                  ) : null}
                  <button className="btn-ghost text-xs" onClick={() => setPreview(it)}><Eye size={13} /> Open</button>
                  {!it.onBoard && (
                    <button className="btn-primary text-xs" onClick={() => setPlacing(it)} disabled={!boards.length}
                      title={boards.length ? "Put it on one of your boards" : "Create a board first"}>
                      <KanbanSquare size={13} /> Put on a board
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {preview && <InboxPreview item={preview} onClose={() => setPreview(null)} />}
      {placing && (
        <PutOnBoard item={placing} boards={boards} onClose={() => setPlacing(null)}
          onDone={async (doc, board) => {
            setPlacing(null);
            notify(`${placing.fileName} is on "${board.name}"`, "success");
            await load();
            onPlaced?.(board.id, doc);
          }} />
      )}
    </div>
  );
}

// Whom the employee asked, in order, with whose turn it is.
function Asked({ item }) {
  if (!item.steps.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 mt-1.5 text-[11px]">
      <span className="opacity-50 mr-0.5">Asked:</span>
      {item.steps.map((st, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <ArrowRight size={10} className="opacity-40" />}
          {st.signers.map((s, j) => (
            <span key={j} className="rounded-full px-2 py-0.5 inline-flex items-center gap-1"
              style={s.status === "signed"
                ? { backgroundColor: "rgba(22,120,60,.10)", color: "#16783c" }
                : s.status === "pending" && item.awaiting === s.name
                  ? { backgroundColor: "rgba(184,137,74,.16)", color: "var(--c-sand)", fontWeight: 500 }
                  : { backgroundColor: "rgba(15,26,46,.06)" }}>
              {s.status === "signed" ? <CircleCheck size={10} /> : item.awaiting === s.name ? <Clock size={10} /> : null}
              {s.name}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}

function InboxPreview({ item, onClose }) {
  const [file, setFile] = useState(null);
  const [failed, setFailed] = useState(null);
  useEffect(() => {
    let url;
    const isPdf = item.fileType === "pdf";
    api.getRequestFileBlob(item.requestId, "file")
      .then((u) => { url = u; setFile({ name: item.fileName, base64: u, ext: isPdf ? "pdf" : "xlsx" }); })
      .catch((e) => setFailed(e?.message || "This document could not be opened"));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [item.requestId]);
  return (
    <ModalShell title={item.fileName} subtitle={`From ${item.requestorName || "—"} · ${fmtWhen(item.createdAt)}`} size="xl" onClose={onClose}>
      <Asked item={item} />
      <div className="mt-3 rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-ink-10)", minHeight: 320 }}>
        {file
          ? <Suspense fallback={<div className="p-10 text-sm opacity-50 text-center">Opening…</div>}><DocPreview file={file} /></Suspense>
          : <div className="p-10 text-sm text-center" style={failed ? { color: "var(--c-rust)" } : { opacity: 0.5 }}>{failed || "Opening the document…"}</div>}
      </div>
    </ModalShell>
  );
}

// Choose the board and the stage. A stage that asks for a signature is not
// offered: asking another executive to sign is moving the card there afterwards.
function PutOnBoard({ item, boards, onClose, onDone }) {
  const [boardId, setBoardId] = useState(boards[0]?.id || "");
  const board = boards.find((b) => b.id === boardId);
  const open = (board?.stages || []).filter((s) => s.kind !== "signature" && !s.requiresSignature);
  const [stageId, setStageId] = useState(open[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { setStageId(open[0]?.id || ""); }, [boardId]);
  const save = async () => {
    setBusy(true); setErr(null);
    try { const doc = await api.eaInboxToBoard(item.requestId, { boardId, stageId }); onDone(doc, board); }
    catch (e) { setErr(e.message || "Could not put it on the board"); setBusy(false); }
  };
  return (
    <ModalShell title="Put on a board" subtitle={item.fileName} onClose={onClose}>
      <div className="space-y-3">
        <label className="block">
          <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1">Board</div>
          <select className="w-full" value={boardId} onChange={(e) => setBoardId(e.target.value)}>
            {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="block">
          <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1">Stage</div>
          <select className="w-full" value={stageId} onChange={(e) => setStageId(e.target.value)} disabled={!open.length}>
            {(board?.stages || []).map((s) => {
              const signs = s.kind === "signature" || s.requiresSignature;
              return <option key={s.id} value={s.id} disabled={signs}>{s.name}{signs ? " — asks for a signature" : ""}</option>;
            })}
          </select>
        </label>
        <div className="text-xs opacity-60">
          It still reaches {item.awaiting || "the executive"} as the employee sent it. On the board it moves through your stages — send it for review,
          or move it to a stage that asks another executive to sign.
        </div>
        {!open.length && <div className="text-xs" style={{ color: "var(--c-rust)" }}>This board has no stage that does not ask for a signature — add one first.</div>}
        {err && <div className="text-xs" style={{ color: "var(--c-rust)" }}>{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !stageId} onClick={save}><KanbanSquare size={14} /> {busy ? "Putting it on…" : "Put on the board"}</button>
        </div>
      </div>
    </ModalShell>
  );
}
