// ============================================================
//   A LIST OF FINISHED DOCUMENTS, WITH FOLDERS
//   ------------------------------------------------------------
//   Wraps a finished-document list with the folder behaviour, so the two
//   screens that show such lists share one implementation rather than each
//   growing its own. The parent still decides how a row looks; this decides
//   which rows show (main list = unfiled; inside a folder = that folder's),
//   and gives the row its "Move to…" control.
// ============================================================
import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { BackHeader } from "./BackHeader.jsx";
import { Empty } from "./Empty.jsx";
import { FolderStrip } from "./FolderStrip.jsx";
import { MoveToMenu } from "./MoveToMenu.jsx";
import { useFolders } from "../lib/useFolders.js";

/**
 * @param items        the finished documents this screen lists (all of them; filtering happens here)
 * @param renderRow    (r, i, moveMenu) => <RequestRow …/> — the parent supplies the row; `moveMenu` goes among its actions
 * @param countLabel   what the title count says, e.g. "signed"
 */
export function FolderedList({ items, title, back, notify, emptyIcon, emptyText, countLabel = "signed", renderRow }) {
  const { folders, placements, createFolder, renameFolder, deleteFolder, moveTo } = useFolders({ notify });
  const [current, setCurrent] = useState(null);       // open folder id, or null
  const [creating, setCreating] = useState(false);

  const folderIds = new Set(folders.map((f) => f.id));
  const visible = current
    ? items.filter((r) => placements[r.id] === current)
    : items.filter((r) => !placements[r.id] || !folderIds.has(placements[r.id]));
  const openFolder = current ? folders.find((f) => f.id === current) : null;

  const createAndMove = async (name, requestId) => {
    const f = await createFolder(name);
    if (f) moveTo(requestId, f.id);
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
          <button className="btn-ghost text-xs" onClick={() => { setCurrent(null); setCreating(true); }} disabled={creating}>
            <FolderPlus size={12} /> New folder
          </button>
        )} />

      <FolderStrip folders={folders} current={current} creating={creating} onCreatingChange={setCreating}
        onOpen={setCurrent} onCreate={createFolder} onRename={renameFolder} onDelete={deleteFolder} onMove={moveTo} />

      {visible.length === 0 ? empty : (
        <div className="card mt-6 overflow-hidden">
          {visible.map((r, i) => renderRow(r, i, (
            <MoveToMenu folders={folders} currentFolderId={placements[r.id] || null}
              onMove={(folderId) => moveTo(r.id, folderId)}
              onCreateAndMove={(name) => createAndMove(name, r.id)} />
          )))}
        </div>
      )}
      {openFolder && visible.length > 0 && (
        <div className="text-xs opacity-50 mt-3">Drag a document onto "Main list" above to take it out of {openFolder.name}.</div>
      )}
    </div>
  );
}
