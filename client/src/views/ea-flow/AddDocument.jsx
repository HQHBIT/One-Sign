import { useRef, useState } from "react";
import { Upload, FileText } from "lucide-react";
import { ModalShell } from "../../components/ModalShell.jsx";

// A document enters the board here: the file, a title people will recognise
// on the card, and an optional note that travels with it (and is shown to
// whoever is asked to sign it).
export function AddDocument({ firstStageName, onAdd, onClose }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const pick = (f) => {
    if (!f) return;
    const ext = f.name.split(".").pop().toLowerCase();
    if (!["pdf", "xlsx", "xls"].includes(ext)) return;
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  };

  const add = async () => {
    if (!file || busy) return;
    setBusy(true);
    try { await onAdd({ file, title: title.trim(), note: note.trim() }); }
    finally { setBusy(false); }
  };

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
        <div className="text-xs opacity-50">It will start in <span className="font-medium">{firstStageName}</span>.</div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!file || busy} onClick={add}>{busy ? "Adding…" : "Add to board"}</button>
        </div>
      </div>
    </ModalShell>
  );
}
