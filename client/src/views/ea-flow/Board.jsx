import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { Plus, Ellipsis, Pencil, Trash2, ChevronLeft, ChevronRight, PenLine, Clock, Eye, Download, FolderInput, FileText, FileSpreadsheet, CircleCheck, CircleAlert, Hourglass, GripVertical } from "lucide-react";
import { api } from "../../api.js";
import { useConfirmation } from "../../lib/useConfirm.jsx";
import { ModalShell } from "../../components/ModalShell.jsx";
import { StageEditor } from "./StageEditor.jsx";
import { AddDocument } from "./AddDocument.jsx";
import { PlaceSignature } from "./PlaceSignature.jsx";
import { fmtDuration, fmtWhen, stageColour } from "./time.js";

const DocPreview = lazy(() => import("../../viewer.jsx").then(m => ({ default: m.DocPreview })));
const DRAG = "text/x-ea-document";

// One board: a column per stage, a card per document. Drag a card onto a
// column, or use Move to… (the only way on a phone). Every move goes through
// `move`, which knows when a destination needs a signature first.
export function Board({ board, executives, notify, onBoardChanged }) {
  const confirm = useConfirmation();
  const [docs, setDocs] = useState(null);
  const [stageModal, setStageModal] = useState(null);   // { stage } | { stage: null }
  const [adding, setAdding] = useState(false);
  const [placing, setPlacing] = useState(null);         // { doc, stage }
  const [preview, setPreview] = useState(null);         // { doc, file }
  const [menuFor, setMenuFor] = useState(null);         // stage id with ⋯ open
  const [tick, setTick] = useState(0);                  // re-render the "in stage for" chips
  const menuRef = useRef(null);

  const stages = board.stages;
  const load = () => api.eaDocuments(board.id).then(setDocs).catch((e) => { notify(e.message || "Could not load the board", "error"); setDocs([]); });
  useEffect(() => { load(); }, [board.id]);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!menuFor) return;
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuFor(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuFor]);

  // ---- stages ----
  const saveStage = async (body) => {
    try {
      if (stageModal.stage) await api.eaUpdateStage(stageModal.stage.id, body);
      else await api.eaAddStage(board.id, body);
      setStageModal(null); await onBoardChanged();
    } catch (e) { notify(e.message || "Could not save the stage", "error"); }
  };
  const removeStage = async (s) => {
    setMenuFor(null);
    if (s.count > 0) return notify("Move its documents to another stage first", "error");
    if (!(await confirm({ title: `Delete "${s.name}"?`, message: "The stage is empty; nothing else is deleted.", confirmLabel: "Delete stage", destructive: true }))) return;
    try { await api.eaDeleteStage(s.id); await onBoardChanged(); } catch (e) { notify(e.message || "Could not delete the stage", "error"); }
  };
  const shift = async (s, dir) => {
    setMenuFor(null);
    const ids = stages.map((x) => x.id); const i = ids.indexOf(s.id), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await api.eaOrderStages(board.id, ids); await onBoardChanged(); } catch (e) { notify(e.message || "Could not reorder", "error"); }
  };

  // ---- documents ----
  const addDoc = async ({ file, title, note }) => {
    try { await api.eaAddDocument(board.id, { file, title, note }); setAdding(false); notify(`${title || file.name} added to ${stages[0].name}`, "success"); await load(); await onBoardChanged(); }
    catch (e) { notify(e.message || "Could not add the document", "error"); }
  };
  const move = async (doc, stage, boxes) => {
    if (stage.id === doc.stageId) return;
    if (stage.requiresSignature && !boxes) { setPlacing({ doc, stage }); return; }
    try {
      const updated = await api.eaMove(doc.id, { toStageId: stage.id, boxes });
      setDocs((ds) => ds.map((d) => (d.id === doc.id ? updated : d)));
      setPlacing(null);
      notify(stage.requiresSignature ? `Sent to ${stage.signer?.name} to sign` : `${doc.title} moved to ${stage.name}`, "success");
      await onBoardChanged();
    } catch (e) {
      if (placing) throw e; // the placement modal shows it inline
      notify(e.message || "Could not move the document", "error");
    }
  };
  const removeDoc = async (doc) => {
    if (!(await confirm({ title: `Remove "${doc.title}"?`, message: "The card and its trail are removed from this board. Any signature request it raised stays in your requests.", confirmLabel: "Remove", destructive: true }))) return;
    try { await api.eaDeleteDocument(doc.id); setDocs((ds) => ds.filter((d) => d.id !== doc.id)); await onBoardChanged(); }
    catch (e) { notify(e.message || "Could not remove the document", "error"); }
  };
  const open = async (doc) => {
    try { const url = await api.eaDocumentFileUrl(doc.id); setPreview({ doc, file: { name: doc.fileName, ext: doc.fileType === "pdf" ? "pdf" : "xlsx", base64: url } }); }
    catch (e) { notify(e.message || "Could not open the document", "error"); }
  };
  const download = async (doc) => {
    try {
      const url = await api.eaDocumentFileUrl(doc.id);
      const a = document.createElement("a"); a.href = url; a.download = doc.currentFile === "signed" ? doc.fileName.replace(/(\.[^.]+)$/, ".signed$1") : doc.fileName;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { notify(e.message || "Could not download", "error"); }
  };

  if (!stages.length) {
    return (
      <div className="card p-10 text-center">
        <div className="font-display text-2xl mb-2">Set up the stages</div>
        <div className="text-sm opacity-60 max-w-md mx-auto mb-5">Name the steps a document goes through on this board — for example <em>Received</em>, <em>With the CEO</em>, <em>Signed</em>, <em>Filed</em>. A stage can ask an executive to sign.</div>
        <button className="btn-primary" onClick={() => setStageModal({ stage: null })}><Plus size={14} /> Add the first stage</button>
        {stageModal && <StageEditor stage={stageModal.stage} executives={executives} onSave={saveStage} onClose={() => setStageModal(null)} />}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <div className="text-xs opacity-50">{docs ? `${docs.length} document${docs.length === 1 ? "" : "s"} on this board` : "Loading…"} · drag a card onto a stage, or use Move to…</div>
        <div className="flex gap-2">
          <button className="btn-ghost text-xs" onClick={() => setStageModal({ stage: null })}><Plus size={12} /> Stage</button>
          <button className="btn-primary text-xs" onClick={() => setAdding(true)}><Plus size={12} /> Add document</button>
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1" style={{ scrollSnapType: "x proximity" }}>
        {stages.map((s, i) => (
          <StageColumn key={s.id} stage={s} index={i} total={stages.length} colour={stageColour(i)}
            docs={(docs || []).filter((d) => d.stageId === s.id)} stages={stages} tick={tick}
            menuOpen={menuFor === s.id} menuRef={menuFor === s.id ? menuRef : null}
            onMenu={() => setMenuFor(menuFor === s.id ? null : s.id)}
            onEdit={() => { setMenuFor(null); setStageModal({ stage: s }); }}
            onDelete={() => removeStage(s)} onShift={(dir) => shift(s, dir)}
            onDrop={(docId) => { const d = (docs || []).find((x) => x.id === docId); if (d) move(d, s); }}
            onMove={move} onOpen={open} onDownload={download} onRemove={removeDoc} />
        ))}
      </div>

      {stageModal && <StageEditor stage={stageModal.stage} executives={executives} onSave={saveStage} onClose={() => setStageModal(null)} />}
      {adding && <AddDocument firstStageName={stages[0].name} onAdd={addDoc} onClose={() => setAdding(false)} />}
      {placing && <PlaceSignature doc={placing.doc} stage={placing.stage} onConfirm={(boxes) => move(placing.doc, placing.stage, boxes)} onClose={() => setPlacing(null)} />}
      {preview && (
        <ModalShell title={preview.doc.title} onClose={() => { URL.revokeObjectURL(preview.file.base64); setPreview(null); }}>
          <div className="text-xs opacity-50 mb-3">{preview.doc.fileName}{preview.doc.currentFile === "signed" ? " · signed copy" : ""}</div>
          <Suspense fallback={<div className="p-10 text-sm opacity-50 text-center">Opening…</div>}><DocPreview file={preview.file} /></Suspense>
        </ModalShell>
      )}
    </div>
  );
}

function StageColumn({ stage, index, total, colour, docs, stages, tick, menuOpen, menuRef, onMenu, onEdit, onDelete, onShift, onDrop, onMove, onOpen, onDownload, onRemove }) {
  const [over, setOver] = useState(false);
  return (
    <div className="shrink-0 w-72 sm:w-80 flex flex-col rounded-xl transition-colors"
      style={{ backgroundColor: over ? "rgba(184,137,74,.12)" : "rgba(15,26,46,.035)", border: `1px solid ${over ? "var(--c-gold)" : "var(--c-ink-08)"}`, scrollSnapAlign: "start", minHeight: 260 }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (!over) setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData(DRAG); if (id) onDrop(id); }}>
      <div className="px-3 pt-3 pb-2 flex items-center gap-2 relative" ref={menuRef}>
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colour }} />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm truncate">{stage.name}</div>
          {stage.requiresSignature && <div className="text-[11px] opacity-60 inline-flex items-center gap-1"><PenLine size={10} /> {stage.signer?.name} signs</div>}
        </div>
        <span className="text-xs opacity-50 tabular-nums">{docs.length}</span>
        <button className="btn-ghost px-1 py-1 text-xs" aria-label={`Options for ${stage.name}`} onClick={onMenu}><Ellipsis size={13} /></button>
        {menuOpen && (
          <div className="absolute right-2 top-full z-20 rounded-lg overflow-hidden text-sm" style={{ backgroundColor: "var(--c-paper)", border: "1px solid var(--c-ink-10)", boxShadow: "0 8px 24px rgba(15,26,46,.16)", minWidth: 170 }}>
            <button className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-black/5" onClick={onEdit}><Pencil size={13} className="opacity-70" /> Edit stage</button>
            <button className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-black/5" disabled={index === 0} onClick={() => onShift(-1)}><ChevronLeft size={13} className="opacity-70" /> Move left</button>
            <button className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-black/5" disabled={index === total - 1} onClick={() => onShift(1)}><ChevronRight size={13} className="opacity-70" /> Move right</button>
            <button className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-black/5" style={{ color: "var(--c-rust-deep)" }} onClick={onDelete}><Trash2 size={13} className="opacity-80" /> Delete</button>
          </div>
        )}
      </div>
      <div className="px-2 pb-2 space-y-2 flex-1">
        {docs.map((d) => <Card key={d.id} doc={d} stage={stage} stages={stages} tick={tick} onMove={onMove} onOpen={onOpen} onDownload={onDownload} onRemove={onRemove} />)}
        {!docs.length && <div className="text-xs opacity-40 text-center py-8">{index === 0 ? "Add a document to start" : "Drop a card here"}</div>}
      </div>
    </div>
  );
}

function Card({ doc, stage, stages, tick, onMove, onOpen, onDownload, onRemove }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);
  const rq = doc.request;
  const status = rq ? (rq.status === "approved" || rq.status === "approved_pending" ? "signed" : rq.status === "rejected" ? "rejected" : rq.status === "pending" ? "waiting" : "other") : null;
  const inStage = Date.now() - doc.enteredStageAt; void tick;

  return (
    <div className="card p-3 space-y-2" draggable={!doc.waitingForSignature}
      style={{ cursor: doc.waitingForSignature ? "default" : "grab", opacity: doc.waitingForSignature ? 0.92 : 1 }}
      onDragStart={(e) => { e.dataTransfer.setData(DRAG, doc.id); e.dataTransfer.effectAllowed = "move"; }}>
      <div className="flex items-start gap-2">
        <GripVertical size={13} className="opacity-25 shrink-0 mt-0.5 hidden sm:block" aria-hidden="true" />
        <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(15,26,46,.06)" }}>
          {doc.fileType === "pdf" ? <FileText size={13} /> : <FileSpreadsheet size={13} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm leading-snug">{doc.title}</div>
          <div className="text-[11px] opacity-50 truncate">{doc.fileName}{doc.currentFile === "signed" ? " · signed" : ""}</div>
        </div>
      </div>
      {doc.note && <div className="text-xs opacity-60 line-clamp-2">{doc.note}</div>}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="pill" style={{ backgroundColor: "rgba(15,26,46,.06)" }} title={`In ${stage.name} since ${fmtWhen(doc.enteredStageAt)}`}><Clock size={10} /> {fmtDuration(inStage)}</span>
        {doc.completedAt && <span className="pill pill-approved"><CircleCheck size={10} /> Complete</span>}
        {status === "waiting" && <span className="pill pill-pending"><Hourglass size={10} /> Awaiting {rq.signerName?.split(" ")[0]}</span>}
        {status === "signed" && <span className="pill pill-approved"><CircleCheck size={10} /> Signed by {rq.signerName?.split(" ")[0]}</span>}
        {status === "rejected" && <span className="pill pill-rejected" title={rq.rejectReason || ""}><CircleAlert size={10} /> Rejected{rq.rejectReason ? ` — ${rq.rejectReason}` : ""}</span>}
      </div>
      <div className="flex items-center gap-1 pt-1 relative" ref={ref}>
        <button className="btn-ghost text-xs px-2 py-1" onClick={() => onOpen(doc)} title="Preview"><Eye size={12} /></button>
        <button className="btn-ghost text-xs px-2 py-1" onClick={() => onDownload(doc)} title="Download"><Download size={12} /></button>
        <button className="btn-ghost text-xs px-2 py-1 ml-auto" onClick={() => setMenu((m) => !m)} disabled={doc.waitingForSignature}
          title={doc.waitingForSignature ? `Waiting for ${rq?.signerName} to sign` : "Move to another stage"}><FolderInput size={12} /> Move to…</button>
        {menu && (
          <div className="absolute right-0 top-full mt-1 z-20 rounded-lg overflow-hidden text-sm" style={{ backgroundColor: "var(--c-paper)", border: "1px solid var(--c-ink-10)", boxShadow: "0 8px 24px rgba(15,26,46,.16)", minWidth: 200 }}>
            {stages.filter((s) => s.id !== doc.stageId).map((s, i) => (
              <button key={s.id} className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-black/5" onClick={() => { setMenu(false); onMove(doc, s); }}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: stageColour(stages.indexOf(s)) }} />
                <span className="flex-1 truncate">{s.name}</span>
                {s.requiresSignature && <PenLine size={11} className="opacity-50" />}
              </button>
            ))}
            <button className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-black/5 border-t" style={{ borderColor: "var(--c-ink-10)", color: "var(--c-rust-deep)" }} onClick={() => { setMenu(false); onRemove(doc); }}>
              <Trash2 size={13} className="opacity-80" /> Remove from board
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
