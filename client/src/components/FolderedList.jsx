// ============================================================
//   A LIST OF FINISHED DOCUMENTS, WITH FOLDERS
//   ------------------------------------------------------------
//   Wraps a finished-document list with the folder behaviour, so the two
//   screens that show such lists share one implementation rather than each
//   growing its own. The parent still decides how a row looks; this decides
//   which rows show (main list = unfiled; inside a folder = that folder's),
//   gives the row its "Move to…" control, and — in selection mode — the
//   checkbox and the bar that moves several rows together.
// ============================================================
import { useEffect, useState } from "react";
import { FolderPlus, CheckSquare, X } from "lucide-react";
import { BackHeader } from "./BackHeader.jsx";
import { Empty } from "./Empty.jsx";
import { FolderStrip } from "./FolderStrip.jsx";
import { MoveToMenu } from "./MoveToMenu.jsx";
import { useFolders } from "../lib/useFolders.js";

/**
 * @param items        the finished documents this screen lists (all of them; filtering happens here)
 * @param renderRow    (r, i, moveMenu, rowProps) => <RequestRow …/> — the parent supplies the row; `moveMenu` goes
 *                     among its actions and `rowProps` is spread onto it (drag handle, or checkbox state when selecting)
 * @param countLabel   what the title count says, e.g. "signed"
 */
export function FolderedList({ items, title, back, notify, emptyIcon, emptyText, countLabel = "signed", renderRow }) {
  const { folders, placements, createFolder, renameFolder, deleteFolder, moveTo, moveMany } = useFolders({ notify });
  const [current, setCurrent] = useState(null);       // open folder id, or null
  const [creating, setCreating] = useState(false);
  const [selecting, setSelecting] = useState(false);  // checkboxes showing
  const [selected, setSelected] = useState(() => new Set());

  const folderIds = new Set(folders.map((f) => f.id));
  const visible = current
    ? items.filter((r) => placements[r.id] === current)
    : items.filter((r) => !placements[r.id] || !folderIds.has(placements[r.id]));
  const openFolder = current ? folders.find((f) => f.id === current) : null;

  // Selection belongs to one screen: opening or leaving a folder clears it.
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()); };
  const open = (id) => { stopSelecting(); setCurrent(id); };
  useEffect(() => {
    if (!selecting) return;
    const esc = (e) => { if (e.key === "Escape") stopSelecting(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [selecting]);

  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allVisible = visible.length > 0 && visible.every((r) => selected.has(r.id));
  const selectAll = () => setSelected(new Set(visible.map((r) => r.id)));

  const createAndMove = async (name, requestId) => {
    const f = await createFolder(name);
    if (f) moveTo(requestId, f.id);
  };

  // The bar's move: every ticked row at once, then say what happened and stop selecting.
  const moveSelected = async (folderId) => {
    const ids = [...selected];
    const n = await moveMany(ids, folderId);
    if (n > 0) {
      const where = folderId ? `to ${folders.find((f) => f.id === folderId)?.name || "the folder"}` : "back to the main list";
      notify?.(`${n} document${n === 1 ? "" : "s"} moved ${where}`, "success");
    }
    stopSelecting();
  };
  const createAndMoveSelected = async (name) => {
    const f = await createFolder(name);
    if (f) moveSelected(f.id);
  };

  const filedCount = items.length - (current ? 0 : visible.length);
  const empty = !items.length
    ? <Empty icon={emptyIcon} text={emptyText} />
    : current
      ? <Empty icon={emptyIcon} text="Nothing in this folder yet — drag documents here, or use Move to… on a document." />
      : <Empty icon={emptyIcon} text={`Everything is filed — open a folder above. (${filedCount} filed)`} />;

  return (
    <div>
      <BackHeader back={back} title={title} step={`${items.length} ${countLabel}`}
        actions={(
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {visible.length > 0 && (
              <button className="btn-ghost text-xs" onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
                title="Tick several documents and move them together">
                {selecting ? <><X size={12} /> Done</> : <><CheckSquare size={12} /> Select</>}
              </button>
            )}
            <button className="btn-ghost text-xs" onClick={() => { setCurrent(null); setCreating(true); }} disabled={creating}>
              <FolderPlus size={12} /> New folder
            </button>
          </div>
        )} />

      <FolderStrip folders={folders} current={current} creating={creating} onCreatingChange={setCreating}
        onOpen={open} onCreate={createFolder} onRename={renameFolder} onDelete={deleteFolder} onMove={moveTo} />

      {selecting && (
        <div className="mt-4 px-3 py-2 rounded-lg flex items-center gap-2 flex-wrap text-sm"
          style={{ backgroundColor: "rgba(184,137,74,.10)", border: "1px solid var(--c-gold)" }}>
          <span className="font-medium">{selected.size} selected</span>
          <span className="opacity-40">·</span>
          <button className="btn-ghost text-xs" onClick={selectAll} disabled={allVisible}>Select all</button>
          <span className="opacity-40">·</span>
          <MoveToMenu folders={folders} currentFolderId={current} primary disabled={selected.size === 0}
            label={selected.size ? `Move ${selected.size} to…` : "Move to…"}
            onMove={moveSelected} onCreateAndMove={createAndMoveSelected} />
          <span className="opacity-40">·</span>
          <button className="btn-ghost text-xs" onClick={stopSelecting}>Cancel</button>
        </div>
      )}

      {visible.length === 0 ? empty : (
        <div className="card mt-6 overflow-hidden">
          {visible.map((r, i) => renderRow(r, i, (
            <MoveToMenu folders={folders} currentFolderId={placements[r.id] || null}
              onMove={(folderId) => moveTo(r.id, folderId)}
              onCreateAndMove={(name) => createAndMove(name, r.id)} />
          ), selecting
            ? { selectable: true, selected: selected.has(r.id), onToggle: () => toggle(r.id) }
            : { draggableId: r.id }))}
        </div>
      )}
      {openFolder && visible.length > 0 && !selecting && (
        <div className="text-xs opacity-50 mt-3">Drag a document onto "Main list" above to take it out of {openFolder.name}.</div>
      )}
    </div>
  );
}
