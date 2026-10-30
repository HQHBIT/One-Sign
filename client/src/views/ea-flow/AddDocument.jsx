import { useRef, useState } from "react";
import { Upload, FileText } from "lucide-react";
import { ModalShell } from "../../components/ModalShell.jsx";
import { PlaceSignature } from "./PlaceSignature.jsx";

// A document enters the board here: the file, a title people will recognise on
// the card, the stage it is actually at, and an optional note that travels with
// it (and is shown to whoever is asked to sign it).
//
// Papers do not always arrive at the beginning — one may turn up already with
// the CEO — so the stage is a choice rather than always the first.
export function AddDocument({ stages, onAdd, onClose }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [stageId, setStageId] = useState(stages?.[0]?.id || "");
  const [placing, setPlacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const stage = (stages || []).find((s) => s.id === stageId) || null;
  const kind = stage?.kind || (stage?.requiresSignature ? "signature" : "plain");

  const pick = (f) => {
    if (!f) return;
    const ext = f.name.split(".").pop().toLowerCase();
    if (!["pdf", "xlsx", "xls"].includes(ext)) return;
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  };

  const submit = async (boxes) => {
    setBusy(true);
    try { await onAdd({ file, title: title.trim(), note: note.trim(), stageId, boxes }); }
    finally { setBusy(false); }
  };

  const add = async () => {
    if (!file || busy) return;
    // A signature stage must know WHERE to sign before the request is raised,
    // so the box is placed on the local file first — the same step as dragging
    // a card into that stage, just before the upload rather than after.
    if (kind === "signature") { setPlacing(true); return; }
    await submit(null);
  };

  if (placing) {
    return (
      <PlaceSignature
        localFile={file}
        stage={stage}
        onClose={() => setPlacing(false)}
        onConfirm={async (boxes) => { await submit(boxes); }}
      />
    );
  }

  return (
    <ModalShell title="Add a document" onClose={onClose}>
      <div className="space-y-4">
        <div
          className="rounded-lg p-6 text-center cursor-pointer"
          style={{ border: "1.5px dashed var(--c-ink-18)", backgroundColor: "rgba(15,26,46,.03)" }}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}>
          <input ref={inputRef} type="file" accept=".pdf,.xlsx,.xls" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          {file ? (
            <div className="inline-flex items-center gap-2 text-sm font-medium"><FileText size={16} /> {file.name}</div>
          ) : (
            <div className="opacity-60 text-sm"><Upload size={20} className="mx-auto mb-2" />Drop a PDF or Excel file here, or click to choose</div>
          )}
        </div>
        <label className="block">
          <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1">Title</div>
          <input value={title} maxLength={120} placeholder="What people will see on the card" className="w-full" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block">
          <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1">Note (optional)</div>
          <textarea value={note} rows={3} maxLength={2000} placeholder="Context for you and for whoever signs it" className="w-full" onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="block">
          <div className="text-[10px] tracking-widest uppercase opacity-50 mb-1">Which stage is it at?</div>
          <select value={stageId} className="w-full" onChange={(e) => setStageId(e.target.value)}>
            {(stages || []).map((s, i) => (
              <option key={s.id} value={s.id}>
                {s.name}{i === 0 ? " (the start)" : ""}
                {(s.kind === "signature" || s.requiresSignature) ? ` · ${s.signer?.name || "signature"} signs` : ""}
                {s.kind === "cc" ? ` · ${s.signer?.name || "someone"} is shown it` : ""}
              </option>
            ))}
          </select>
        </label>
        {/* Said plainly, because adding here does more than file a card: it
            asks a person for something. */}
        {kind === "signature" && (
          <div className="text-xs opacity-60">
            You will place the signature box next, then this goes to <span className="font-medium">{stage?.signer?.name}</span> to sign.
          </div>
        )}
        {kind === "cc" && (
          <div className="text-xs opacity-60">
            <span className="font-medium">{stage?.signer?.name}</span> will be told it is there to read. They do not sign it.
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!file || !stageId || busy} onClick={add}>
            {busy ? "Adding…" : kind === "signature" ? "Place the signature box" : "Add to board"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
