// ============================================================
//   MOVE TO…
//   ------------------------------------------------------------
//   Filing without dragging. On a phone there is no drag-and-drop worth the
//   name, and on a desktop some people would rather click; this is the same
//   move, as a small menu on every row: the person's folders, a way to make a
//   new one on the spot, and — when the document is already filed — a way out.
// ============================================================
import { useEffect, useRef, useState } from "react";
import { Folder, FolderInput, FolderPlus, Check } from "lucide-react";

// `label`, `disabled` and `primary` let the same menu sit on the selection bar
// ("Move 3 to…", greyed until something is ticked) as well as on a row.
export function MoveToMenu({ folders, currentFolderId, onMove, onCreateAndMove, label = "Move to…", disabled = false, primary = false }) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setNaming(false); } };
    const esc = (e) => { if (e.key === "Escape") { setOpen(false); setNaming(false); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const choose = (folderId) => { setOpen(false); setNaming(false); onMove(folderId); };
  const create = () => {
    const v = name.replace(/\s+/g, " ").trim();
    if (!v) return;
    setOpen(false); setNaming(false); setName("");
    onCreateAndMove(v);
  };

  return (
    <div className="relative" ref={ref}>
      <button className={`${primary ? "btn-gold" : "btn-ghost"} text-xs`} disabled={disabled} onClick={() => setOpen((o) => !o)} title="Move to a folder">
        <FolderInput size={12} /> {label}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 rounded-lg overflow-hidden text-sm"
          style={{ backgroundColor: "var(--c-paper)", border: "1px solid var(--c-ink-10)", boxShadow: "0 8px 24px rgba(15,26,46,.16)", minWidth: 200 }}>
          {folders.length === 0 && !naming && (
            <div className="px-3 py-2 text-xs opacity-60">No folders yet.</div>
          )}
          {folders.map((f) => (
            <button key={f.id} className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-black/5"
              onClick={() => choose(f.id)}>
              <Folder size={13} className="opacity-60" />
              <span className="truncate flex-1">{f.name}</span>
              {currentFolderId === f.id && <Check size={12} style={{ color: "var(--c-gold)" }} />}
            </button>
          ))}
          <div className="border-t" style={{ borderColor: "var(--c-ink-10)" }} />
          {naming ? (
            <div className="px-3 py-2 flex items-center gap-1">
              <input autoFocus value={name} maxLength={60} placeholder="New folder name" className="text-sm px-2 py-1 rounded flex-1"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
              <button className="btn-ghost text-xs px-1" onClick={create}><Check size={12} /></button>
            </div>
          ) : (
            <button className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-black/5" onClick={() => setNaming(true)}>
              <FolderPlus size={13} className="opacity-70" /> New folder…
            </button>
          )}
          {currentFolderId && (
            <button className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-black/5 border-t" style={{ borderColor: "var(--c-ink-10)" }}
              onClick={() => choose(null)}>
              Remove from folder
            </button>
          )}
        </div>
      )}
    </div>
  );
}
