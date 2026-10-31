import { useEffect, useState, lazy, Suspense } from "react";
import { Inbox, Eye, KanbanSquare, ArrowRight, FileText, FileSpreadsheet, Clock, CircleCheck, User, Briefcase, Layers } from "lucide-react";
import { api } from "../../api.js";
import { ModalShell } from "../../components/ModalShell.jsx";
import { Tile } from "../../components/Tile.jsx";
import { BackHeader } from "../../components/BackHeader.jsx";
import { fmtWhen } from "./time.js";

const DocPreview = lazy(() => import("../../viewer.jsx").then(m => ({ default: m.DocPreview })));
const PAGE = 20;

// ============================================================
//   FILES FOR SENIOR EXECUTIVE MANAGEMENT
//   ------------------------------------------------------------
//   Every document an employee has sent for signature to an executive this
//   assistant supports (their Delegation links). The request still goes to the
//   executive exactly as before; from here the assistant reviews it, sees whom
//   the employee asked, and puts it on one of their boards.
//
//   Opens as a DASHBOARD — a tile per executive and per state — never one long
//   list; each tile opens its own page, as Approved requests does on the main
//   dashboard (owner, 2026-10-31: "remove this list … I should get the page as
//   what I receive under the main dashboard").
// ============================================================
export function ExecInbox({ boards, notify, onPlaced, onOpenBoard }) {
  const [data, setData] = useState(null);       // { executives, items }
  const [view, setView] = useState(null);       // null = dashboard | { key, title, filter }
  const [shownCount, setShownCount] = useState(PAGE);
  const [preview, setPreview] = useState(null); // item
  const [placing, setPlacing] = useState(null); // item

  const load = () => api.eaInbox().then(setData)
    .catch((e) => { notify(e.message || "Could not load the files", "error"); setData({ executives: [], items: [] }); });
  useEffect(() => { load(); }, []);

  const modals = (
    <>
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
    </>
  );

  if (data === null) return <div className="card p-10 text-sm opacity-50 text-center">Loading…</div>;
  const { executives, items } = data;
  const forWho = (it) => it.steps.flatMap((st) => st.signers).filter((s) => s.mine).map((s) => s.name);
  // Whose turn it is right now — the executive, or someone before them.
  const theirTurn = (it, name) => it.awaiting === name;

  // ---- a list, on its own page ----
  if (view) {
    const list = items.filter(view.filter);
    const page = list.slice(0, shownCount);
    return (
      <div>
        <BackHeader back={() => { setView(null); setShownCount(PAGE); }} title={view.title}
          step={`${list.length} document${list.length === 1 ? "" : "s"}`} />
        <div className="card p-2 sm:p-3 mt-5">
          {list.length === 0 ? (
            <div className="text-sm opacity-50 py-8 text-center">
              <Inbox size={20} className="mx-auto mb-2 opacity-40" />Nothing here right now.
            </div>
          ) : page.map((it) => (
            <InboxRow key={it.requestId} it={it} boards={boards}
              onOpen={() => setPreview(it)} onPlace={() => setPlacing(it)} onOpenBoard={onOpenBoard} />
          ))}
          {list.length > page.length && (
            <div className="text-center py-3">
              <button className="btn-ghost text-xs" onClick={() => setShownCount((n) => n + PAGE)}>
                Show {Math.min(PAGE, list.length - page.length)} more of {list.length - page.length}
              </button>
            </div>
          )}
        </div>
        {modals}
      </div>
    );
  }

  // ---- the dashboard ----
  const notOnBoard = items.filter((it) => !it.onBoard).length;
  const onBoard = items.length - notOnBoard;
  const tiles = [
    ...executives.map((e) => {
      const mine = items.filter((it) => forWho(it).includes(e.name));
      const now = mine.filter((it) => theirTurn(it, e.name)).length;
      return {
        key: `ex:${e.id}`, icon: Briefcase, color: "var(--c-gold)", badge: mine.length,
        title: e.name,
        desc: mine.length ? `${now} awaiting ${e.name.split(" ")[0]} now · ${mine.length - now} with others first` : "Nothing sent to them right now.",
        view: { key: `ex:${e.id}`, title: e.name, filter: (it) => forWho(it).includes(e.name) },
      };
    }),
    { key: "not-on-board", icon: Inbox, badge: notOnBoard, title: "Not on a board yet",
      desc: "Files you have not routed yet — review them and put them on a board.",
      view: { key: "not-on-board", title: "Not on a board yet", filter: (it) => !it.onBoard } },
    { key: "on-board", icon: KanbanSquare, badge: onBoard, title: "On your boards",
      desc: "Files already routed — each shows its board and stage.",
      view: { key: "on-board", title: "On your boards", filter: (it) => !!it.onBoard } },
    { key: "all", icon: Layers, badge: items.length, title: "All files",
      desc: "Everything employees have sent to your executives.",
      view: { key: "all", title: "All files", filter: () => true } },
  ];

  return (
    <div className="space-y-5">
      <div>
        <div className="font-display text-2xl">Files for Senior Executive Management</div>
        <div className="text-xs opacity-60 mt-0.5">
          {items.length
            ? `${items.length} document${items.length === 1 ? "" : "s"} employees have sent for signature to your executives.`
            : "Nothing has been sent to your executives right now."}
          {" "}They still reach the executive as usual — open a tile to review them and route them from here.
        </div>
      </div>

      {executives.length === 0 ? (
        <div className="card p-8 text-center text-sm opacity-70">
          <User size={18} className="mx-auto mb-2 opacity-50" />
          No executives are linked to you with document access yet. The executive (or IT Admin) can add you under <span className="font-medium">Delegation</span>, with “View documents” on.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          {tiles.map((t) => <Tile key={t.key} icon={t.icon} title={t.title} desc={t.desc} badge={t.badge} color={t.color}
            onClick={() => { setShownCount(PAGE); setView(t.view); }} />)}
        </div>
      )}
      {modals}
    </div>
  );
}

// One file: what it is, who sent it, whom they asked — and what can be done.
function InboxRow({ it, boards, onOpen, onPlace, onOpenBoard }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-3 py-3 border-b last:border-0" style={{ borderColor: "var(--c-ink-08)" }}>
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
        {it.onBoard && (
          <button className="pill pill-approved" style={{ textTransform: "none", letterSpacing: 0 }}
            onClick={() => onOpenBoard(it.onBoard.boardId)} title="Open that board">
            <KanbanSquare size={10} /> {it.onBoard.boardName} · {it.onBoard.stageName}
          </button>
        )}
        <button className="btn-ghost text-xs" onClick={onOpen}><Eye size={13} /> Open</button>
        {!it.onBoard && (
          <button className="btn-primary text-xs" onClick={onPlace} disabled={!boards.length}
            title={boards.length ? "Put it on one of your boards" : "Create a board first"}>
            <KanbanSquare size={13} /> Put on a board
          </button>
        )}
      </div>
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
