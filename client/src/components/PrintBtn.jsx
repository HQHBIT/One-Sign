import { useState } from "react";
import { Printer } from "lucide-react";
import { api } from "../api.js";

export function PrintBtn({ req }) {
  const [busy, setBusy] = useState(false);
  const print = async () => {
    setBusy(true);
    // Open the window SYNCHRONOUSLY before any await — this preserves the
    // user-gesture chain and prevents popup blockers from suppressing it.
    const pw = window.open("", "_blank", "width=960,height=720");
    if (!pw) { alert("Popup was blocked. Please allow popups for this site and try again."); setBusy(false); return; }
    try {
      const isPdf = req.fileType === "pdf";
      const kind = (req.hasSignedFile && isPdf) ? "signed" : "file";
      const url = await api.getRequestFileBlob(req.id, kind);
      if (isPdf) {
        // PDF: write an HTML shell with an <embed>; the browser's PDF plugin
        // renders inside it. Calling pw.print() (the OUTER window) triggers
        // the system print dialog on the embedded PDF.
        pw.document.write(`<!DOCTYPE html><html><head><style>
          *{margin:0;padding:0;} body,html{width:100%;height:100%;overflow:hidden;}
          embed{width:100%;height:100%;display:block;}
        </style></head><body>
          <embed src="${url}" type="application/pdf" />
        </body></html>`);
        pw.document.close();
        // Give the embed time to render, then trigger the system print dialog
        setTimeout(() => { try { pw.print(); } catch { pw.focus(); } }, 1200);
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      } else {
        // Excel / Leave form: parse with SheetJS → render as HTML table → auto-print
        // Dynamic import keeps xlsx in the lazy viewer chunk.
        const XLSX = await import("xlsx");
        const resp = await fetch(url);
        const buf = await resp.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
        const visibleSheets = wb.SheetNames.filter(s => s !== "Sheet1");
        let body = "";
        (visibleSheets.length ? visibleSheets : wb.SheetNames).forEach(name => {
          const ws = wb.Sheets[name];
          if (!ws || !ws["!ref"]) return;
          body += XLSX.utils.sheet_to_html(ws, { editable: false });
        });
        pw.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
          <title>${req.fileName}</title>
          <style>
            body{font-family:Calibri,Arial,sans-serif;font-size:9.5pt;margin:10mm;}
            table{border-collapse:collapse;width:100%;page-break-inside:auto;}
            td,th{border:1px solid #aaa;padding:2px 5px;vertical-align:top;word-break:break-word;}
            tr{page-break-inside:avoid;}
            @media print{body{margin:6mm;}}
          </style></head><body>${body}</body></html>`);
        pw.document.close();
        pw.focus();
        setTimeout(() => { pw.print(); URL.revokeObjectURL(url); }, 400);
      }
    } catch (e) { pw.close(); alert(e.message || "Print failed"); }
    finally { setBusy(false); }
  };
  return <button className="btn-ghost text-xs" onClick={print} disabled={busy}><Printer size={12} /> {busy ? "…" : "Print"}</button>;
}
