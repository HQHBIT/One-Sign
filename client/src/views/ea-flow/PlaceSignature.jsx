import { useEffect, useState, lazy, Suspense } from "react";
import { PenLine } from "lucide-react";
import { api } from "../../api.js";
import { ModalShell } from "../../components/ModalShell.jsx";

const DocPreview = lazy(() => import("../../viewer.jsx").then(m => ({ default: m.DocPreview })));

// Moving a card into a signature stage: the assistant marks where the
// executive signs, on the card's CURRENT file (the already-signed copy when an
// earlier stage collected a signature), then the move raises the request.
export function PlaceSignature({ doc, stage, onConfirm, onClose }) {
  const [file, setFile] = useState(null);
  const [boxes, setBoxes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let url = null;
    api.eaDocumentFileUrl(doc.id)
      .then((u) => { url = u; setFile({ name: doc.fileName, ext: doc.fileType === "pdf" ? "pdf" : "xlsx", base64: u }); })
      .catch((e) => setErr(e.message || "Could not open the document"));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [doc.id]);

  const markers = boxes.map((b, i) => ({ ...b, id: `b${i}`, color: "#B8894A", label: boxes.length > 1 ? `${stage.signer?.name} #${i + 1}` : `${stage.signer?.name} signs here` }));
  const onAddMarker = (page, x, y, w, h) => setBoxes((bs) => [...bs, { page, x, y, w, h }]);
  const onUpdateMarker = (id, patch) => setBoxes((bs) => bs.map((b, i) => (`b${i}` === id ? { ...b, ...patch } : b)));
  const onDeleteMarker = (id) => setBoxes((bs) => bs.filter((_, i) => `b${i}` !== id));

  const confirm = async () => {
    if (!boxes.length || busy) return;
    setBusy(true); setErr(null);
    try { await onConfirm(boxes); }
    catch (e) { setErr(e.message || "Could not send for signature"); setBusy(false); }
  };

  return (
    <ModalShell title={`Send to ${stage.signer?.name || "the executive"} to sign`} onClose={onClose}>
      <div className="space-y-4">
        <div className="text-sm opacity-70">
          Click-drag (or press and hold on a phone) where <span className="font-medium">{stage.signer?.name}</span> should sign
          <span className="font-medium"> {doc.title}</span>. {doc.currentFile === "signed" ? "This is the already-signed copy from the earlier stage." : ""}
        </div>
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-ink-10)", minHeight: 320 }}>
          {file ? (
            <Suspense fallback={<div className="p-10 text-sm opacity-50 text-center">Opening the document…</div>}>
              <DocPreview file={file} markers={markers} editable
                onAddMarker={onAddMarker} onUpdateMarker={onUpdateMarker} onDeleteMarker={onDeleteMarker} />
            </Suspense>
          ) : <div className="p-10 text-sm opacity-50 text-center">{err || "Opening the document…"}</div>}
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs opacity-60">
            {boxes.length ? `${boxes.length} signature box${boxes.length > 1 ? "es" : ""} placed` : "No box placed yet"}
            {boxes.length > 0 && <button className="ml-3 underline" onClick={() => setBoxes([])}>Clear</button>}
          </div>
          {err && file && <div className="text-xs" style={{ color: "var(--c-rust)" }}>{err}</div>}
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-gold" disabled={!boxes.length || busy} onClick={confirm}>
              <PenLine size={14} /> {busy ? "Sending…" : `Send to ${stage.signer?.name?.split(" ")[0] || "sign"}`}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
