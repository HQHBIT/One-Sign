import { useEffect, useRef, useState } from "react";
import { Plus, Ellipsis, Pencil, Trash2, KanbanSquare, BarChart3, Check, X } from "lucide-react";
import { api } from "../../api.js";
import { useConfirmation } from "../../lib/useConfirm.jsx";
import { Board } from "./Board.jsx";
import { Dashboard } from "./Dashboard.jsx";

// The assistant's document flow: their boards, one open at a time, each
// viewable as the board itself or as the dashboard of where things sat.
export function FlowTab({ executives, notify }) {
  const confirm = useConfirmation();
  const [boards, setBoards] = useState(null);
  const [current, setCurrent] = useState(null);
  const [view, setView] = useState("board");        // board | dashboard
  const [naming, setNaming] = useState(false);       // creating a board
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);

  const load = async () => {
    try {
      const bs = await api.eaBoards();
      setBoards(bs);
      setCurrent((c) => (c && bs.some((b) => b.id === c) ? c : bs[0]?.id || null));
      return bs;
    } catch (e) { notify(e.message || "Could not load your boards", "error"); setBoards([]); return []; }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const create = async (name) => {
    try { const b = await api.eaCreateBoard(name); setNaming(false); await load(); setCurrent(b.id); setView("board"); }
    catch (e) { notify(e.message || "Could not create the board", "error"); }
  };
  const rename = async (name) => {
    try { await api.eaRenameBoard(current, name); setRenaming(false); await load(); }
    catch (e) { notify(e.message || "Could not rename the board", "error"); }
  };
  const remove = async () => {
    setMenu(false);
    const b = boards.find((x) => x.id === current);
    if (b.documentCount > 0) return notify("Remove or finish its documents first", "error");
    if (!(await confirm({ title: `Delete "${b.name}"?`, message: "The board and its stages are deleted. It holds no documents.", confirmLabel: "Delete board", destructive: true }))) return;
    try { await api.eaDeleteBoard(current); await load(); } catch (e) { notify(e.message || "Could not delete the board", "error"); }
  };

  if (boards === null) return <div className="card p-10 text-sm opacity-50 text-center">Loading…</div>;
  const board = boards.find((b) => b.id === current) || null;

  return (
    <div className="space-y-4">
      {/* boards row */}
      <div className="flex items-center gap-2 flex-wrap">
        {boards.map((b) => (
          <button key={b.id} onClick={() => { setCurrent(b.id); setRenaming(false); }}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm tile-hover"
            style={b.id === current ? { backgroundColor: "var(--c-gold)", color: "var(--c-cream)" } : { backgroundColor: "rgba(15,26,46,.06)" }}>
            <KanbanSquare size={14} /> <span className="max-w-[12rem] truncate">{b.name}</span>
            <span className="text-[11px] opacity-70 tabular-nums">{b.documentCount}</span>
          </button>
        ))}
        {naming ? (
          <NameBox placeholder="Board name" onSave={create} onCancel={() => setNaming(false)} />
        ) : (
          <button className="btn-ghost text-xs" onClick={() => setNaming(true)}><Plus size={12} /> New board</button>
        )}
      </div>

      {!board ? (
        <div className="card p-10 text-center">
          <KanbanSquare size={36} className="mx-auto opacity-30 mb-3" />
          <div className="font-display text-2xl mb-2">Your document flow</div>
          <div className="text-sm opacity-60 max-w-lg mx-auto">Create a board for the papers you look after — say <em>CEO papers</em> — then name its stages. Documents move from stage to stage, an executive is asked to sign where a stage needs it, and the dashboard shows how long each paper sat where.</div>
          <button className="btn-primary mt-5" onClick={() => setNaming(true)}><Plus size={14} /> Create your first board</button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0 relative" ref={menuRef}>
              {renaming
                ? <NameBox initial={board.name} placeholder="Board name" onSave={rename} onCancel={() => setRenaming(false)} />
                : <div className="font-display text-2xl truncate">{board.name}</div>}
              {!renaming && (
                <button className="btn-ghost px-1.5 py-1 text-xs" aria-label={`Options for ${board.name}`} onClick={() => setMenu((m) => !m)}><Ellipsis size={14} /></button>
              )}
              {menu && (
                <div className="absolute left-0 top-full mt-1 z-20 rounded-lg overflow-hidden text-sm" style={{ backgroundColor: "var(--c-paper)", border: "1px solid var(--c-ink-10)", boxShadow: "0 8px 24px rgba(15,26,46,.16)", minWidth: 160 }}>
                  <button className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-black/5" onClick={() => { setMenu(false); setRenaming(true); }}><Pencil size={13} className="opacity-70" /> Rename</button>
                  <button className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-black/5" style={{ color: "var(--c-rust-deep)" }} onClick={remove}><Trash2 size={13} className="opacity-80" /> Delete board</button>
                </div>
              )}
            </div>
            <div className="inline-flex rounded-lg p-0.5" style={{ backgroundColor: "rgba(15,26,46,.06)" }}>
              {[["board", KanbanSquare, "Board"], ["dashboard", BarChart3, "Dashboard"]].map(([k, Icon, label]) => (
                <button key={k} onClick={() => setView(k)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm"
                  style={view === k ? { backgroundColor: "var(--c-paper)", boxShadow: "0 1px 3px rgba(15,26,46,.12)" } : { opacity: 0.7 }}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          </div>
          {view === "board"
            ? <Board key={board.id} board={board} executives={executives} notify={notify} onBoardChanged={load} />
            : <Dashboard key={board.id} board={board} notify={notify} />}
        </>
      )}
    </div>
  );
}

function NameBox({ initial = "", placeholder, onSave, onCancel }) {
  const [value, setValue] = useState(initial);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const save = () => { const v = value.replace(/\s+/g, " ").trim(); if (v) onSave(v); else onCancel(); };
  return (
    <div className="inline-flex items-center gap-1">
      <input ref={ref} value={value} maxLength={60} placeholder={placeholder} className="text-sm px-2 py-1 rounded" style={{ minWidth: 160 }}
        onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") onCancel(); }} />
      <button className="btn-ghost text-xs px-1.5" title="Save" onMouseDown={(e) => e.preventDefault()} onClick={save}><Check size={12} /></button>
      <button className="btn-ghost text-xs px-1.5" title="Cancel" onMouseDown={(e) => e.preventDefault()} onClick={onCancel}><X size={12} /></button>
    </div>
  );
}
