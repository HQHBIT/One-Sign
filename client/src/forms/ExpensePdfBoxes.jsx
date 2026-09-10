// ============================================================
//   SIGNATURE BOXES ON AN ATTACHED EXPENSE PDF
//   ------------------------------------------------------------
//   When a printed expense form is attached instead of filled in, its signature
//   boxes are already drawn. Dragging rectangles over boxes that exist is
//   busywork and never lands on the lines, so they are read off the page and
//   offered back — over a render of the page itself, at the size the form drew
//   them, so what you accept is visibly what will be stamped.
//
//   The suggestions start SELECTED but every one can be switched off, and any
//   that were missed can still be placed by hand in the normal way. A detector
//   that quietly decides where a signature goes is worse than one that shows its
//   work: this shows the boxes on the page before anything is submitted.
// ============================================================
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { detectExpenseSignatureBoxes } from "../lib/expenseSignatureBoxes.js";

const ViewerModule = () => import("../viewer.jsx");   // shares the pdfjs chunk

export function ExpensePdfBoxes({ file, onChange }) {
  const canvasRef = useRef(null);
  const [boxes, setBoxes] = useState([]);
  const [on, setOn] = useState({});
  const [state, setState] = useState("reading");   // reading | ready | none | error
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    let url = null;
    (async () => {
      setState("reading"); setErr(""); setBoxes([]); setOn({});
      try {
        // pdfjs is loaded through the viewer module so this shares its chunk
        // rather than pulling a second copy of a large dependency.
        await ViewerModule();
        const pdfjsLib = await import("pdfjs-dist/build/pdf.mjs");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";

        url = URL.createObjectURL(file);
        const pdf = await pdfjsLib.getDocument({ url }).promise;
        const found = await detectExpenseSignatureBoxes(pdf);
        if (cancelled) return;

        // Draw the page at a width the panel can show, so the overlay lines up
        // with what the reader is looking at.
        const page = await pdf.getPage(found[0]?.page || 1);
        const base = page.getViewport({ scale: 1 });
        const target = 620;
        const viewport = page.getViewport({ scale: target / base.width });
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        }
        if (cancelled) return;

        setBoxes(found);
        setOn(Object.fromEntries(found.map((b) => [b.role, true])));
        setState(found.length ? "ready" : "none");
      } catch (e) {
        if (!cancelled) { setErr(e?.message || "Could not read that PDF"); setState("error"); }
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [file]);

  // Report the accepted boxes upward in the marker shape the rest of the app
  // uses — page and percentages, nothing about this screen.
  useEffect(() => {
    onChange?.(boxes.filter((b) => on[b.role]).map(({ page, x, y, w, h }) => ({ page, x, y, w, h })));
  }, [boxes, on]);

  const accepted = boxes.filter((b) => on[b.role]).length;

  return (
    <div>
      <div className="text-xs mb-2 opacity-70">
        {state === "reading" && "Reading the form…"}
        {state === "ready" && `Found ${boxes.length} signature ${boxes.length === 1 ? "box" : "boxes"} on this form — ${accepted} selected.`}
        {state === "none" && "No signature block recognised on this PDF. You can still place boxes by hand after submitting."}
        {state === "error" && `Could not read that PDF: ${err}`}
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {boxes.map((b) => (
          <button key={b.role}
            onClick={() => setOn((p) => ({ ...p, [b.role]: !p[b.role] }))}
            className={on[b.role] ? "btn-primary text-xs" : "btn-ghost text-xs"}
            title={on[b.role] ? "Signature box included" : "Not included"}>
            {on[b.role] && <Check size={11} />} {b.label}
          </button>
        ))}
      </div>

      {/* The page, with the boxes drawn over it at the size the form drew them. */}
      <div style={{ position: "relative", display: "inline-block", lineHeight: 0,
                    border: "1px solid rgba(15,26,46,.18)", maxWidth: "100%" }}>
        <canvas ref={canvasRef} style={{ maxWidth: "100%", height: "auto", display: "block" }} />
        {boxes.filter((b) => on[b.role]).map((b) => (
          <div key={b.role} title={b.label}
            style={{
              position: "absolute", left: `${b.x}%`, top: `${b.y}%`,
              width: `${b.w}%`, height: `${b.h}%`,
              border: "1.5px solid var(--c-gold)",
              background: "rgba(184,137,74,.14)",
              boxSizing: "border-box", pointerEvents: "none",
            }}>
            <span style={{
              position: "absolute", top: -16, left: 0, fontSize: 9, letterSpacing: ".06em",
              textTransform: "uppercase", color: "var(--c-gold)", whiteSpace: "nowrap",
            }}>{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
