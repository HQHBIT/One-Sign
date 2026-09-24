// ============================================================
//   A PERSON'S FOLDERS, IN THE BROWSER
//   ------------------------------------------------------------
//   One load gives both the folders and where each document sits. Every change
//   is OPTIMISTIC: the screen moves first and the server is told after, so
//   dragging feels like moving a thing rather than submitting a form. If the
//   server refuses, the previous state comes back and a toast says why — and
//   a fresh load follows, so the screen never drifts from the truth for long.
// ============================================================
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";

const byName = (a, b) => a.name.localeCompare(b.name);

export function useFolders({ notify } = {}) {
  const [folders, setFolders] = useState([]);
  const [placements, setPlacements] = useState({});
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.folders();
      setFolders((r.folders || []).slice().sort(byName));
      setPlacements(r.placements || {});
    } catch (e) {
      notify?.(e.message || "Could not load your folders", "error");
    } finally {
      setLoaded(true);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  // Undo on screen, say why, and reload so the screen matches the server.
  const refused = (e, fallback) => { notify?.(e?.message || fallback, "error"); load(); };

  const createFolder = async (name) => {
    try {
      const f = await api.createFolder(name);
      setFolders((fs) => [...fs, { ...f, count: 0 }].sort(byName));
      return f;
    } catch (e) {
      refused(e, "Could not create the folder");
      return null;
    }
  };

  const renameFolder = async (id, name) => {
    const before = folders;
    setFolders((fs) => fs.map((f) => (f.id === id ? { ...f, name } : f)).sort(byName));
    try { await api.renameFolder(id, name); }
    catch (e) { setFolders(before); refused(e, "Could not rename the folder"); }
  };

  const deleteFolder = async (id) => {
    const beforeF = folders, beforeP = placements;
    setFolders((fs) => fs.filter((f) => f.id !== id));
    setPlacements((p) => Object.fromEntries(Object.entries(p).filter(([, fid]) => fid !== id)));
    try { await api.deleteFolder(id); }
    catch (e) { setFolders(beforeF); setPlacements(beforeP); refused(e, "Could not delete the folder"); }
  };

  // folderId null = back to the main list. Counts move with the placement.
  const moveTo = async (requestId, folderId) => {
    const beforeF = folders, beforeP = placements;
    const from = placements[requestId] || null;
    if (from === (folderId || null)) return;
    setPlacements((p) => {
      const next = { ...p };
      if (folderId) next[requestId] = folderId; else delete next[requestId];
      return next;
    });
    setFolders((fs) => fs.map((f) => {
      let count = f.count;
      if (from === f.id) count -= 1;
      if (folderId === f.id) count += 1;
      return count === f.count ? f : { ...f, count };
    }));
    try { await api.fileRequest(requestId, folderId); }
    catch (e) { setFolders(beforeF); setPlacements(beforeP); refused(e, "Could not move the document"); }
  };

  return { folders, placements, loaded, createFolder, renameFolder, deleteFolder, moveTo, reload: load };
}
