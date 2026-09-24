// ============================================================
//   THE FOLDER STRIP
//   ------------------------------------------------------------
//   One tile per folder above the list: its name, how many documents are in
//   it, and — while something is being dragged — a drop target. Click a tile
//   to open the folder; inside, the strip becomes a breadcrumb and a "Main
//   list" target for dragging documents back out.
//
//   Creating and renaming happen INLINE, in the tile itself, so the person
//   never leaves the list they were tidying. Deleting confirms, and says what
//   it will do: the folder name goes, the documents do not.
// ============================================================
import { useEffect, useRef, useState } from "react";
import { Folder, FolderOpen, FolderPlus, Check, X, Ellipsis, Pencil, Trash2, ChevronRight } from "lucide-react";
import { useConfirmation } from "../lib/useConfirm.jsx";

const DRAG_TYPE = "text/x-request-id";

/** The text box used for both a new name and a rename. Enter saves, Escape cancels. */
function NameBox({ initial = "", placeholder, onSave, onCancel }) {
  const [value, setValue] = useState(initial);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const save = () => { const v = value.replace(/\s+/g, " ").trim(); if (v) onSave(v); else onCancel(); };
  return (
    <div className="flex items-center gap-1">
      <input ref={ref} value={value} maxLength={60} placeholder={placeholder}
        className="text-sm px-2 py-1 rounded" style={{ minWidth: 140 }}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") onCancel(); }}
        onBlur={save} />
      <button className="btn-ghost text-xs px-1" title="Save" onMouseDown={(e) => e.preventDefault()} onClick={save}><Check size={12} /></button>
      <button className="btn-ghost text-xs px-1" title="Cancel" onMouseDown={(e) => e.preventDefault()} onClick={onCancel}><X size={12} /></button>
    </div>
  );
}

/** A tile that accepts a dragged row. `onDropRequest(requestId)` is called with what landed. */
function DropTile({ active, onDropRequest, onClick, children, title }) {
  const [over, setOver] = useState(false);
  return (
    <button type="button" title={title} onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
      style={{
        border: `1px solid ${over ? "var(--c-gold)" : "var(--c-ink-10)"}`,
        backgroundColor: over ? "rgba(184,137,74,.16)" : active ? "rgba(184,137,74,.10)" : "var(--c-paper)",
        outline: over ? "2px solid rgba(184,137,74,.35)" : "none",
      }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (!over) setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData(DRAG_TYPE); if (id) onDropRequest(id); }}>
      {children}
    </button>
  );
}

/**
 * @param folders      [{ id, name, count }]
 * @param current      id of the open folder, or null for the main list
 * @param creating     whether the "new folder" box is showing (owned by the parent, which also owns the title button)
 * @param onOpen(id|null), onCreate(name), onRename(id, name), onDelete(id), onMove(requestId, folderId|null)
 */
export function FolderStrip({ folders, current, creating, onCreatingChange, onOpen, onCreate, onRename, onDelete, onMove }) {
  const confirm = useConfirmation();
  const [renaming, setRenaming] = useState(null);   // folder id
  const [menuFor, setMenuFor] = useState(null);     // folder id with the ⋯ menu open
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menuFor) return;
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuFor(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuFor]);

  const open = current ? folders.find((f) => f.id === current) : null;

  // Nothing to show, nothing being made: the screen looks exactly as it always did.
  if (!folders.length && !creating) return null;

  const remove = async (f) => {
    setMenuFor(null);
    const ok = await confirm({
      title: `Delete "${f.name}"?`,
      message: f.count
        ? `Its ${f.count} document${f.count === 1 ? "" : "s"} go back to the main list. Nothing else is deleted.`
        : "The folder is empty. Nothing else is deleted.",
      confirmLabel: "Delete folder",
      destructive: true,
    });
    if (ok) { if (current === f.id) onOpen(null); onDelete(f.id); }
  };

  // Inside a folder: a breadcrumb, and one target for dragging documents out.
  if (open) {
    return (
      <div className="mt-6 flex items-center gap-2 flex-wrap text-sm">
        <DropTile title="Drop here to move a document back to the main list" onClick={() => onOpen(null)} onDropRequest={(id) => onMove(id, null)}>
          <Folder size={14} className="opacity-60" /> Main list
        </DropTile>
        <ChevronRight size={14} className="opacity-40" />
        <span className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: "rgba(184,137,74,.12)", border: "1px solid var(--c-gold)" }}>
          <FolderOpen size={14} style={{ color: "var(--c-gold)" }} />
          {renaming === open.id
            ? <NameBox initial={open.name} placeholder="Folder name" onSave={(v) => { setRenaming(null); if (v !== open.name) onRename(open.id, v); }} onCancel={() => setRenaming(null)} />
            : <><span className="font-medium">{open.name}</span><span className="opacity-50 text-xs">{open.count}</span></>}
        </span>
        <button className="btn-ghost text-xs" onClick={() => setRenaming(open.id)}><Pencil size={12} /> Rename</button>
        <button className="btn-ghost text-xs" onClick={() => remove(open)}><Trash2 size={12} /> Delete</button>
      </div>
    );
  }

  // The main list: every folder as a tile, plus the new-folder box when asked for.
  return (
    <div className="mt-6 flex items-center gap-2 flex-wrap">
      {folders.map((f) => (
        <div key={f.id} className="relative flex items-center" ref={menuFor === f.id ? menuRef : null}>
          {renaming === f.id ? (
            <span className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ border: "1px solid var(--c-gold)" }}>
              <Folder size={14} className="opacity-60" />
              <NameBox initial={f.name} placeholder="Folder name"
                onSave={(v) => { setRenaming(null); if (v !== f.name) onRename(f.id, v); }}
                onCancel={() => setRenaming(null)} />
            </span>
          ) : (
            <DropTile title={`Open ${f.name} — or drop a document here to file it`} onClick={() => onOpen(f.id)} onDropRequest={(id) => onMove(id, f.id)}>
              <Folder size={14} className="opacity-60" />
              <span className="font-medium truncate" style={{ maxWidth: 180 }}>{f.name}</span>
              <span className="opacity-50 text-xs">{f.count}</span>
            </DropTile>
          )}
          {renaming !== f.id && (
            <button className="btn-ghost text-xs px-1 ml-0.5" title="Rename or delete" aria-label={`Options for ${f.name}`}
              onClick={() => setMenuFor(menuFor === f.id ? null : f.id)}>
              <Ellipsis size={13} />
            </button>
          )}
          {menuFor === f.id && (
            <div className="absolute left-0 top-full mt-1 z-20 rounded-lg overflow-hidden text-sm"
              style={{ backgroundColor: "var(--c-paper)", border: "1px solid var(--c-ink-10)", boxShadow: "0 8px 24px rgba(15,26,46,.16)", minWidth: 150 }}>
              <button className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-black/5" onClick={() => { setMenuFor(null); setRenaming(f.id); }}>
                <Pencil size={13} className="opacity-70" /> Rename
              </button>
              <button className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-black/5" style={{ color: "var(--c-rust-deep)" }} onClick={() => remove(f)}>
                <Trash2 size={13} className="opacity-80" /> Delete
              </button>
            </div>
          )}
        </div>
      ))}
      {creating && (
        <span className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ border: "1px solid var(--c-gold)" }}>
          <FolderPlus size={14} style={{ color: "var(--c-gold)" }} />
          <NameBox placeholder="New folder name"
            onSave={(v) => { onCreatingChange(false); onCreate(v); }}
            onCancel={() => onCreatingChange(false)} />
        </span>
      )}
    </div>
  );
}
