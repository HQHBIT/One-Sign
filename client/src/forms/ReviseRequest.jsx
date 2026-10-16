// ============================================================
//   REVISE & RESUBMIT — the requestor's side of "Recommend changes" (HQHB)
//   ------------------------------------------------------------
//   An approver sent the request back with what to change. Here the requestor
//   reads that, then may:
//     · reply (what they changed),
//     · replace the main document — only while nobody has signed it, because
//       signed copies are rebuilt from it and an earlier signer would otherwise
//       carry a signature onto a version they never saw. The approver's boxes
//       are carried over to the revision and can be moved,
//     · add supporting documents, each either for reading or to be signed by
//       the same approval (with boxes placed here),
//   and resubmit. It goes back to the approver who asked.
// ============================================================
import { useState, useEffect, Suspense, lazy } from "react";
import { X, Send, Upload, Paperclip, Trash2, FileText, FileSpreadsheet, Lock, Stamp } from "lucide-react";
import { api } from "../api.js";
import { fileTooLarge, UPLOAD_LIMIT_TEXT } from "../lib/constants.js";
import { SIGNATURE_HEIGHTS_MM, DEFAULT_SIGNATURE_ASPECT } from "../lib/boxSize.js";
import { nextPendingSigner } from "../lib/turn.js";
import { useBackHandler, useEscapeKey, useScrollLock } from "../lib/useBackHandler.js";
import { UnlockModal, ConfidentialBadge } from "../components/UnlockGate.jsx";
import { StatusPill } from "../components/StatusPill.jsx";
import { RecommendationHistory } from "../components/RecommendationHistory.jsx";
import { FileDrop } from "../components/FileDrop.jsx";

const ViewerModule = () => import("../viewer.jsx");
const DocPreview = lazy(() => ViewerModule().then(m => ({ default: m.DocPreview })));
const ViewerFallback = () => <div className="card p-10 text-sm opacity-50 text-center">Loading viewer…</div>;

// Same cap as the server's, so the requestor learns it here rather than on upload.
const MAX_ATTACHMENTS = 5;
const BOX_SPEC = { heightMm: SIGNATURE_HEIGHTS_MM.standard, aspect: DEFAULT_SIGNATURE_ASPECT };

const extOf = (name) => (String(name || "").split(".").pop() || "").toLowerCase();
const kindOf = (name) => (extOf(name) === "pdf" ? "pdf" : ["xlsx", "xls"].includes(extOf(name)) ? "xlsx" : null);
const asFile = (f) => ({ name: f.name, base64: URL.createObjectURL(f), type: f.type, ext: kindOf(f.name), blob: f });

// Editable signature boxes for DocPreview, kept as a plain {page,x,y,w,h} list.
function useBoxes(initial = []) {
  const [boxes, setBoxes] = useState(initial);
  const idx = (id) => { const m = /^bx-(\d+)$/.exec(id || ""); return m ? Number(m[1]) : -1; };
  const markers = boxes.map((b, i) => ({
    id: "bx-" + i, page: b.page || 1, x: b.x, y: b.y, w: b.w, h: b.h,
    color: "#B8894A", label: boxes.length > 1 ? `Approver sign #${i + 1}` : "Approver signs here",
  }));
  const handlers = {
    onAddMarker: (page, x, y, w, h) => setBoxes(prev => [...prev, { page, x, y, w, h }]),
    onUpdateMarker: (id, patch) => { const i = idx(id); if (i >= 0) setBoxes(prev => prev.map((b, k) => (k === i ? { ...b, ...patch } : b))); },
    onDeleteMarker: (id) => { const i = idx(id); if (i >= 0) setBoxes(prev => prev.filter((_, k) => k !== i)); },
  };
  return { boxes, setBoxes, markers, handlers };
}

// The current approver's boxes on the document as it stands: the next pending
// workflow signer's, or a single-team request's marker.
function approverBoxes(req) {
  if (req.workflow?.length) {
    const s = nextPendingSigner(req);
    if (!s) return [];
    return (s.boxes?.length ? s.boxes : [{ page: s.page || 1, x: s.x, y: s.y, w: s.w, h: s.h }])
      .map(b => ({ page: b.page || 1, x: b.x, y: b.y, w: b.w, h: b.h }));
  }
  const list = Array.isArray(req.marker) ? req.marker : (req.marker ? [req.marker] : []);
  return list.map(b => ({ page: b.page || 1, x: b.x, y: b.y, w: b.w, h: b.h }));
}

export function ReviseRequest({ req, users, markers = [], onClose, onDone, notify }) {
  useScrollLock();
  useBackHandler(true, onClose);
  useEscapeKey(true, onClose);

  const [file, setFile] = useState(null);
  const [locked, setLocked] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  // Replacement main document.
  const [newDoc, setNewDoc] = useState(null);
  const [newPages, setNewPages] = useState(0);
  const main = useBoxes([]);

  // Supporting documents: those already on the request, and one being added.
  const [atts, setAtts] = useState([]);
  const [adding, setAdding] = useState(null);       // { doc, needsSignature }
  const [addBusy, setAddBusy] = useState(false);
  const extra = useBoxes([]);

  const requestorName = req.requestorName || users.find(u => u.id === req.requestorId)?.name || "You";
  const askerId = [...(req.recommendations || [])].reverse().find(r => !r.resubmittedAt)?.requestedBy;
  const askerName = users.find(u => u.id === askerId)?.name
    || [...(req.recommendations || [])].reverse().find(r => !r.resubmittedAt)?.requestedByName || "the approver";
  // The main document may be replaced only while nobody has signed it.
  const someoneSigned = (req.workflow || []).some(st => (st.signers || []).some(s => s.status === "signed"));

  useEffect(() => {
    if (locked) { setFile(null); return; }
    let url = null;
    (async () => {
      try {
        url = await api.getRequestFileBlob(req.id, "file");
        setFile({ name: req.fileName, base64: url, ext: req.fileType === "pdf" ? "pdf" : "xlsx" });
      } catch (e) {
        if (e.needsUnlock) setLocked(true); else console.error(e);
      }
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [req.id, locked]);

  const loadAtts = () => api.attachments(req.id).then(setAtts).catch(() => setAtts([]));
  useEffect(() => { loadAtts(); }, [req.id]);

  // Object URLs made here are released when replaced or on close.
  useEffect(() => () => { if (newDoc?.base64) URL.revokeObjectURL(newDoc.base64); }, [newDoc]);
  useEffect(() => () => { if (adding?.doc?.base64) URL.revokeObjectURL(adding.doc.base64); }, [adding?.doc]);

  const pickReplacement = (f) => {
    if (!f) return;
    const tooBig = fileTooLarge(f);
    if (tooBig) { notify(tooBig, "error"); return; }
    if (kindOf(f.name) !== req.fileType) {
      notify(`The revised document must be ${req.fileType === "pdf" ? "a PDF" : "an Excel file"}, like the original`, "error");
      return;
    }
    setNewPages(0);
    setNewDoc(asFile(f));
    // Carry the approver's boxes over; the requestor moves them if the layout changed.
    main.setBoxes(approverBoxes(req));
  };

  const pickSupporting = (f) => {
    if (!f) return;
    const tooBig = fileTooLarge(f);
    if (tooBig) { notify(tooBig, "error"); return; }
    if (!kindOf(f.name)) { notify("Supporting documents must be PDF or Excel", "error"); return; }
    extra.setBoxes([]);
    setAdding({ doc: asFile(f), needsSignature: false });
  };

  const addSupporting = async () => {
    if (!adding) return;
    if (adding.needsSignature && !extra.boxes.length) {
      notify("Place at least one box where the approver should sign", "error");
      return;
    }
    setAddBusy(true);
    try {
      await api.addAttachment(req.id, adding.doc.blob, atts.length + 1,
        adding.needsSignature ? { needsSignature: true, boxes: extra.boxes } : {});
      setAdding(null);
      extra.setBoxes([]);
      await loadAtts();
    } catch (e) { notify(e.message || "Could not add the document", "error"); }
    finally { setAddBusy(false); }
  };

  const removeAtt = async (a) => {
    try { await api.removeAttachment(req.id, a.id); await loadAtts(); }
    catch (e) { notify(e.message || "Could not remove it", "error"); }
  };

  const submit = async () => {
    if (adding) { notify("Add or discard the supporting document you picked first", "error"); return; }
    if (newDoc?.ext === "pdf") {
      if (!main.boxes.length) { notify(`Place where ${askerName} signs on the revised document`, "error"); return; }
      if (newPages && main.boxes.some(b => (b.page || 1) > newPages)) {
        notify(`A signature box is on a page the revised document doesn't have — move it`, "error");
        return;
      }
    }
    setBusy(true);
    try {
      await api.resubmitRequest(req.id, {
        reply: reply.trim(),
        file: newDoc?.blob || null,
        boxes: newDoc?.ext === "pdf" ? main.boxes : null,
      });
      notify(`Resubmitted — it's back with ${askerName}.`, "success");
      await onDone?.();
      onClose();
    } catch (e) { notify(e.message || "Could not resubmit", "error"); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-end" style={{ backgroundColor: "rgba(15,26,46,.5)" }} onClick={onClose}>
      <div className="w-full max-w-4xl flex flex-col anim-in" style={{ backgroundColor: "var(--c-cream)" }} onClick={e => e.stopPropagation()}>
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-2 border-b shrink-0"
          style={{ borderColor: "var(--c-ink-10)", paddingTop: "max(12px, env(safe-area-inset-top))" }}>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] sm:text-xs tracking-wider uppercase opacity-50">Revise &amp; resubmit</div>
            <div className="font-display text-base sm:text-xl truncate">{req.fileName}</div>
          </div>
          {req.confidential && <ConfidentialBadge />}
          <StatusPill status={req.status} />
          <button onClick={onClose} className="btn-ghost text-xs"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <RecommendationHistory recs={req.recommendations} requestorName={requestorName} />

          {/* ---- 1. the main document ---- */}
          <div className="text-xs tracking-wider uppercase opacity-50 mb-2 mt-2">Your document</div>
          {locked ? (
            <div className="card p-8 text-center mb-4">
              <Lock size={20} className="mx-auto mb-2" style={{ color: "var(--c-gold)" }} />
              <div className="text-sm font-medium">This document is locked</div>
              <div className="text-xs opacity-60 mt-1">Enter the emailed code to view it.</div>
            </div>
          ) : newDoc ? (
            <div className="mb-4">
              <div className="card p-3 mb-2 text-xs flex flex-wrap items-center gap-2">
                <span className="font-medium">Replacing with {newDoc.name}</span>
                {newDoc.ext === "pdf" && <span className="opacity-60">· move the box to where {askerName} signs, or add another</span>}
                <span className="flex-1" />
                <button className="btn-ghost text-xs" onClick={() => { setNewDoc(null); main.setBoxes([]); }}>Keep the original</button>
              </div>
              <Suspense fallback={<ViewerFallback />}>
                {newDoc.ext === "pdf"
                  ? <DocPreview key={newDoc.base64} file={newDoc} markers={main.markers} editable boxSpec={BOX_SPEC}
                      onPages={setNewPages} {...main.handlers} />
                  : <DocPreview key={newDoc.base64} file={newDoc} markers={[]} fill />}
              </Suspense>
              {(req.workflow || []).some(st => st.signers.length > 1) || (req.workflow || []).length > 1
                ? <div className="text-xs opacity-60 mt-2">Other signers' boxes stay where they were on the page.</div> : null}
            </div>
          ) : file ? (
            <div className="mb-4">
              <Suspense fallback={<ViewerFallback />}>
                <DocPreview file={file} markers={markers} fill />
              </Suspense>
            </div>
          ) : <div className="text-sm opacity-50 mb-4">Loading…</div>}

          {!newDoc && !locked && (
            someoneSigned ? (
              <div className="card p-3 mb-6 text-xs opacity-70">
                Someone has already signed this document, so it can't be replaced. Add what's needed as a supporting document below.
              </div>
            ) : (
              <FileDrop multiple={false} onFiles={fs => pickReplacement(fs[0])} title="Choose the revised file, or drag it here"
                className="btn-ghost text-xs mb-6 inline-flex cursor-pointer">
                <Upload size={13} /> Replace with a revised {req.fileType === "pdf" ? "PDF" : "Excel file"}
                <input type="file" className="hidden" accept={req.fileType === "pdf" ? ".pdf" : ".xlsx,.xls"}
                  onChange={e => { pickReplacement(e.target.files?.[0]); e.target.value = ""; }} />
              </FileDrop>
            )
          )}

          {/* ---- 2. supporting documents ---- */}
          <div className="text-xs tracking-wider uppercase opacity-50 mb-2 mt-2">Supporting documents</div>
          {atts.length > 0 && (
            <div className="card overflow-hidden mb-3">
              {atts.map((a, i) => (
                <div key={a.id} className={`px-4 py-3 flex items-center gap-3 text-sm ${i ? "border-t" : ""}`} style={{ borderColor: "var(--c-ink-08)" }}>
                  {a.fileType === "pdf" ? <FileText size={14} /> : <FileSpreadsheet size={14} />}
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{a.fileName}</div>
                    <div className="text-xs opacity-60">
                      {a.needsSignature ? `Signed by the approver too · ${a.boxes.length} box${a.boxes.length === 1 ? "" : "es"}` : "For reading only"}
                    </div>
                  </div>
                  <button className="btn-ghost text-xs" title="Remove" onClick={() => removeAtt(a)}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}

          {adding ? (
            <div className="card p-4 mb-4">
              <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
                <Paperclip size={14} /> <span className="font-medium truncate">{adding.doc.name}</span>
                <span className="flex-1" />
                {adding.doc.ext === "pdf" ? (
                  <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                    <input type="checkbox" checked={adding.needsSignature}
                      onChange={e => { setAdding(a => ({ ...a, needsSignature: e.target.checked })); if (!e.target.checked) extra.setBoxes([]); }} />
                    <Stamp size={12} /> The approver must sign this too
                  </label>
                ) : <span className="text-xs opacity-60">Excel — for reading only</span>}
              </div>
              {adding.needsSignature && (
                <div className="text-xs opacity-60 mb-2">Place a signature box where the approver should sign. One approval signs this and your main document together.</div>
              )}
              <Suspense fallback={<ViewerFallback />}>
                {adding.needsSignature
                  ? <DocPreview key={adding.doc.base64 + "-e"} file={adding.doc} markers={extra.markers} editable boxSpec={BOX_SPEC} {...extra.handlers} />
                  : <DocPreview key={adding.doc.base64} file={adding.doc} markers={[]} fill />}
              </Suspense>
              <div className="flex justify-end gap-2 mt-3">
                <button className="btn-ghost text-xs" onClick={() => { setAdding(null); extra.setBoxes([]); }} disabled={addBusy}>Discard</button>
                <button className="btn-primary text-xs" onClick={addSupporting} disabled={addBusy}>
                  <Paperclip size={12} /> {addBusy ? "Adding…" : "Add document"}
                </button>
              </div>
            </div>
          ) : atts.length < MAX_ATTACHMENTS ? (
            <FileDrop multiple={false} onFiles={fs => pickSupporting(fs[0])} title={`${UPLOAD_LIMIT_TEXT} — or drag it here`}
              className="btn-ghost text-xs mb-6 inline-flex cursor-pointer">
              <Paperclip size={13} /> Add a supporting document
              <input type="file" className="hidden" accept=".pdf,.xlsx,.xls"
                onChange={e => { pickSupporting(e.target.files?.[0]); e.target.value = ""; }} />
            </FileDrop>
          ) : <div className="text-xs opacity-60 mb-6">Up to {MAX_ATTACHMENTS} supporting documents per request.</div>}

          {/* ---- 3. reply ---- */}
          <div className="text-xs tracking-wider uppercase opacity-50 mb-2 mt-2">Your reply to {askerName}</div>
          <textarea rows={3} className="w-full" maxLength={4000} value={reply} onChange={e => setReply(e.target.value)}
            placeholder="What did you change? (optional)" />
        </div>

        <div className="shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-t flex items-center justify-between gap-3"
          style={{ borderColor: "var(--c-ink-10)", backgroundColor: "var(--c-cream)", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <div className="text-xs opacity-60 hidden sm:block">It goes back to {askerName}{someoneSigned ? "; earlier signatures stay" : ""}.</div>
          <div className="flex gap-2 shrink-0 ml-auto">
            <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn-primary" onClick={submit} disabled={busy || locked}>
              <Send size={14} /> {busy ? "Resubmitting…" : "Resubmit"}
            </button>
          </div>
        </div>
      </div>
      {locked && <UnlockModal requestId={req.id} onUnlocked={() => setLocked(false)} onCancel={onClose} />}
    </div>
  );
}
