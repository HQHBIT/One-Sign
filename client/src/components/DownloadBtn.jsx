import { useState } from "react";
import { Download } from "lucide-react";
import { api } from "../api.js";

export function DownloadBtn({ req }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const isPdf = req.fileType === "pdf";
      // For xlsx, the "signed" version is a JSON manifest — always download the original file
      const kind = (req.hasSignedFile && isPdf) ? "signed" : "file";
      const url = await api.getRequestFileBlob(req.id, kind);
      const a = document.createElement("a");
      a.href = url;
      const ext = isPdf ? "pdf" : "xlsx";
      a.download = (req.hasSignedFile && isPdf) ? `${req.fileName.replace(/\.(pdf|xlsx|xls)$/i, "")}.signed.${ext}` : req.fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { alert(e.message || "Download failed"); }
    finally { setBusy(false); }
  };
  return <button className="btn-ghost text-xs" onClick={download} disabled={busy}><Download size={12} /> {busy ? "…" : "Download"}</button>;
}
