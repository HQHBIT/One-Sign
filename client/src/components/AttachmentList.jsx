// ============================================================
//   SUPPORTING DOCUMENTS THAT CAME WITH THE REQUEST
//   ------------------------------------------------------------
//   Read-only, by design. These documents are never signed and never become
//   part of the signed copy — they are here so the approver can read what the
//   requestor sent with the document before deciding.
//
//   No organisation check here. The server decides: the routes are absent off
//   HQHB, and the list simply comes back empty, which renders as nothing.
// ============================================================
import { useEffect, useState } from "react";
import { Paperclip, FileText } from "lucide-react";
import { api } from "../api.js";

const prettySize = (n) => {
  const kb = Number(n || 0) / 1024;
  return kb >= 1024 ? (kb / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(kb)) + " KB";
};

export function AttachmentList({ requestId }) {
  const [items, setItems] = useState([]);
  const [opening, setOpening] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    api.attachments(requestId)
      .then(a => { if (alive) setItems(a || []); })
      .catch(() => { /* absent on this organisation, or not permitted — show nothing */ });
    return () => { alive = false; };
  }, [requestId]);

  const open = async (att) => {
    setOpening(att.id); setErr("");
    try {
      const url = await api.attachmentBlob(requestId, att.id);
      // Opened rather than downloaded: a confidential parent restricts taking a
      // copy away, and the server enforces that on ?download=1.
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setErr(e?.message || "Could not open that document");
    } finally { setOpening(null); }
  };

  if (!items.length) return null;

  return (
    <div className="card p-4 text-sm mb-4">
      <div className="text-xs tracking-wider uppercase opacity-50 mb-2 flex items-center gap-1.5">
        <Paperclip size={12} /> Sent with this document — not signed
      </div>
      <div className="flex flex-col gap-1.5">
        {items.map(a => (
          <button key={a.id} type="button" onClick={() => open(a)} disabled={opening === a.id}
            className="btn-ghost flex items-center gap-2 text-left w-full justify-start">
            <FileText size={14} className="opacity-60 shrink-0" />
            <span className="truncate">{a.fileName}</span>
            <span className="text-xs opacity-50 ml-auto shrink-0">
              {opening === a.id ? "Opening…" : prettySize(a.fileSize)}
            </span>
          </button>
        ))}
      </div>
      {err && <div className="text-xs mt-2" style={{ color: "#8B2E2E" }}>{err}</div>}
    </div>
  );
}
