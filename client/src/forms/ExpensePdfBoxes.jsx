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
import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { detectExpenseSignatureBoxes } from "../lib/expenseSignatureBoxes.js";
import { matchName, searchTermFor, looksLikeName } from "../lib/matchSignatory.js";
import { api } from "../api.js";

const ViewerModule = () => import("../viewer.jsx");   // shares the pdfjs chunk

export function ExpensePdfBoxes({ file, users = [], onChange }) {
  const canvasRef = useRef(null);
  const [boxes, setBoxes] = useState([]);
  const [on, setOn] = useState({});
  const [who, setWho] = useState({});               // role -> userId chosen
  const [state, setState] = useState("reading");   // reading | ready | none | error
  const [err, setErr] = useState("");

  // Candidates per row, fetched from the directory rather than from the `users`
  // prop: that list is only sent to administrators, so for everyone else it is
  // empty — which is why every row read "no one here matches that name" no
  // matter who the form named. /api/users/search is open to any signed-in user.
  const [cands, setCands] = useState({});
  const [looking, setLooking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const named = boxes.filter((b) => looksLikeName(b.name));
    if (!named.length) { setCands({}); return; }
    (async () => {
      setLooking(true);
      const out = {};
      for (const b of named) {
        // Searched by FIRST NAME, so everyone who shares it comes back and the
        // requestor picks. Searching the printed string whole finds nobody,
        // because the form abbreviates what the directory spells out.
        const term = searchTermFor(b.name);
        if (!term) continue;
        try { out[b.role] = await api.searchUsers(term); } catch { out[b.role] = []; }
      }
      if (cancelled) return;
      setCands(out);
      setLooking(false);
      // Pre-select only where one candidate is clearly ahead of the rest.
      setWho((prev) => {
        const next = { ...prev };
        for (const b of named) {
          if (next[b.role]) continue;
          const m = matchName(b.name, out[b.role] || []);
          if (m?.user) next[b.role] = m.user.id;
        }
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [boxes]);

  // Who the form names, resolved against whatever the directory returned.
  const suggestions = useMemo(() => {
    const out = {};
    for (const b of boxes) {
      const pool = cands[b.role] || users;
      out[b.role] = looksLikeName(b.name) ? matchName(b.name, pool) : null;
    }
    return out;
  }, [boxes, cands, users]);

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
        // Pre-fill only where the directory gives one clear answer. An ambiguous
        // name is left blank on purpose, so confirming is a decision rather than
        // an acceptance of whatever came first.
        setWho(Object.fromEntries(found.map((b) => [b.role, ""])));
        setState(found.length ? "ready" : "none");
      } catch (e) {
        if (!cancelled) { setErr(e?.message || "Could not read that PDF"); setState("error"); }
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [file]);

  // Report upward in the shapes the rest of the app already uses: markers for a
  // team-routed request, and signers — a person plus the box they sign in — for
  // one routed straight to the people the form names.
  useEffect(() => {
    const live = boxes.filter((b) => on[b.role]);
    onChange?.({
      markers: live.map(({ page, x, y, w, h }) => ({ page, x, y, w, h })),
      signers: live
        .filter((b) => who[b.role])
        .map((b) => ({
          userId: who[b.role],
          boxes: [{ page: b.page, x: b.x, y: b.y, w: b.w, h: b.h }],
          dateFields: [],
        })),
    });
  }, [boxes, on, who]);

  const accepted = boxes.filter((b) => on[b.role]).length;
  const named = boxes.filter((b) => on[b.role] && who[b.role]).length;

  return (
    <div>
      <div className="text-xs mb-2 opacity-70">
        {state === "reading" && "Reading the form…"}
        {state === "ready" && (
          <>Found {boxes.length} signature {boxes.length === 1 ? "box" : "boxes"} on this form — {accepted} selected
            {named > 0 && <>, {named} routed to the {named === 1 ? "person" : "people"} it names</>}.
          </>
        )}
        {state === "none" && "No signature block recognised on this PDF. You can still place boxes by hand after submitting."}
        {state === "error" && `Could not read that PDF: ${err}`}
      </div>

      {/* One row per signatory the form names: the box, who it says signs, and
          who that is here. Confirming is a click; correcting is a dropdown. */}
      {boxes.length > 0 && (
        <div className="mb-3" style={{ display: "grid", gap: 6 }}>
          {boxes.map((b) => {
            const s = suggestions[b.role];
            return (
              <div key={b.role} className="flex items-center gap-2 flex-wrap text-xs">
                <button
                  onClick={() => setOn((p) => ({ ...p, [b.role]: !p[b.role] }))}
                  className={on[b.role] ? "btn-primary text-xs" : "btn-ghost text-xs"}
                  title={on[b.role] ? "Included" : "Not included"}
                  style={{ minWidth: 108, justifyContent: "flex-start" }}>
                  {on[b.role] && <Check size={11} />} {b.label}
                </button>

                <span className="opacity-70" style={{ minWidth: 190 }}>
                  {looksLikeName(b.name)
                    ? <>on the form: <strong>{b.name}</strong>{b.designation ? <span className="opacity-60"> · {b.designation}</span> : null}</>
                    : <span className="opacity-50">
                        {b.name ? "the form leaves this row blank" : "no name printed on this row"}
                      </span>}
                </span>

                <select
                  value={who[b.role] || ""}
                  disabled={!on[b.role]}
                  onChange={(e) => setWho((p) => ({ ...p, [b.role]: e.target.value }))}
                  style={{ minWidth: 240 }}>
                  <option value="">
                    {looksLikeName(b.name) ? "Choose who signs here…" : "Not routed to anyone"}
                  </option>
                  {(cands[b.role] || users).map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>

                {s?.ambiguous && (
                  <span className="opacity-60" title="More than one person fits this name">
                    several match — pick one
                  </span>
                )}
                {looksLikeName(b.name) && !looking && (cands[b.role]?.length === 0) && (
                  <span className="opacity-60">nobody in the directory by that name</span>
                )}
              </div>
            );
          })}
        </div>
      )}

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
