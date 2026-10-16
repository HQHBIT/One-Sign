import { useRef, useState } from "react";

// ============================================================
//   FILE DROP — an upload area that also takes files dragged in from
//   Explorer / Finder.
//   ------------------------------------------------------------
//   Renders the upload area itself (`as`, a <label> by default, so a click
//   still opens the file picker inside it) and highlights while files are
//   held over it. A drop hands the files to `onFiles(files)`; callers pass
//   them to the same handler the picker uses, so type and size checks stay
//   in one place.
//
//   Only OS files are accepted: dragging a request row or a board card over an
//   upload area does nothing. A file dropped anywhere else is swallowed by
//   guardWindowFileDrops() rather than opened by the browser.
// ============================================================
const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");

export function FileDrop({ as: Tag = "label", onFiles, multiple = true, disabled = false, style, children, ...rest }) {
  const [over, setOver] = useState(false);
  // dragenter/dragleave fire for every child crossed; count them so the
  // highlight does not flicker while the pointer moves over the contents.
  const depth = useRef(0);

  const on = (e) => {
    if (disabled || !hasFiles(e)) return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  };

  return (
    <Tag {...rest}
      style={over ? { ...style, outline: "2px dashed var(--c-gold)", outlineOffset: 2, backgroundColor: "rgba(184,137,74,.08)" } : style}
      onDragEnter={(e) => { if (on(e)) { depth.current += 1; setOver(true); } }}
      onDragOver={(e) => { if (on(e)) e.dataTransfer.dropEffect = "copy"; }}
      onDragLeave={(e) => { if (on(e)) { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); } }}
      onDrop={(e) => {
        if (!on(e)) return;
        depth.current = 0;
        setOver(false);
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}>
      {children}
    </Tag>
  );
}

// Upload handlers written for an <input type="file"> read e.target.files and
// reset e.target.value; this gives them the same shape from a drop.
export const asInputEvent = (files) => ({ target: { files, value: "" } });

// A file dropped outside an upload area would otherwise be opened by the
// browser in place of the app, throwing away whatever was being worked on.
// Installed once at startup.
export function guardWindowFileDrops() {
  if (typeof window === "undefined" || window.__sfFileDropGuard) return;
  window.__sfFileDropGuard = true;
  const block = (e) => {
    if (!hasFiles(e) || e.defaultPrevented) return; // an upload area took it
    e.preventDefault();
    if (e.type === "dragover") e.dataTransfer.dropEffect = "none";
  };
  window.addEventListener("dragover", block);
  window.addEventListener("drop", block);
}
