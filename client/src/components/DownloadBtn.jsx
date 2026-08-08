import { useState } from "react";
import { Download } from "lucide-react";
import { api } from "../api.js";

export function DownloadBtn({ req, user }) {
  const [busy, setBusy] = useState(false);
  // A copy taken out of SignFlow is beyond every control this feature provides,
  // so a confidential document leaves only with the person who raised it, and
  // only once it is fully signed. The server enforces the same rule.
  if (req.confidential && !(user && req.requestorId === user.id && req.status === "approved")) {
    return null;
  }
  // Inside the 1-hour rejection window the document isn't final — the approver
  // can still reject or withdraw — so the file can't be taken out yet.
  if (req.status === "approved_pending") {
    return (
      <button className="btn-ghost text-xs" disabled aria-disabled="true"
        title="Available once the 1-hour rejection window completes"
        style={{ opacity: 0.35, cursor: "not-allowed" }}>
        <Download size={12} /> Download
      </button>
    );
  }
  const download = async () => {
    setBusy(true);
    try {
      const isPdf = req.fileType === "pdf";
      // Both PDFs and Excel workbooks now carry the signature in the signed file.
      const kind = req.hasSignedFile ? "signed" : "file";
      const url = await api.getRequestFileBlob(req.id, kind, { download: true });
      const a = document.createElement("a");
      a.href = url;
      const ext = isPdf ? "pdf" : "xlsx";
      a.download = req.hasSignedFile ? `${req.fileName.replace(/\.(pdf|xlsx|xls)$/i, "")}.signed.${ext}` : req.fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { alert(e.message || "Download failed"); }
    finally { setBusy(false); }
  };
  return <button className="btn-ghost text-xs" onClick={download} disabled={busy}><Download size={12} /> {busy ? "…" : "Download"}</button>;
}
