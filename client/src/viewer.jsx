// ============================================================
//   DOCUMENT VIEWER MODULE — lazy-loaded
//   ------------------------------------------------------------
//   Houses the PDF renderer (pdfjs-dist) and the XLSX renderer
//   (SheetJS) plus their marker/overlay machinery. Extracted from
//   App.jsx so the heavy pdfjs + xlsx dependencies live in their
//   own chunk and only download when the user actually previews a
//   document — not on initial page load.
// ============================================================
import { useState, useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import * as XLSX from "xlsx";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";

// ============================================================
//   DOCUMENT PREVIEW (PDF paged · XLSX via SheetJS)
//   Props:
//     file:     { ext, base64 }          required
//     markers:  array of { id?, page, x, y, w, h, label?, color?, signedDataUrl?, highlight? }
//                 (legacy: pass `marker` singular; it's normalised internally)
//     editable: boolean — when true, click-drag adds a marker via onAddMarker(page, x, y, w, h)
//     onAddMarker: (page, x%, y%, w%, h%) => void
//     onPages:  (count) => void
// ============================================================
export function DocPreview({ file, marker, markers, editable = false, onAddMarker, onUpdateMarker, onDeleteMarker, onPages, appliedSignature, styleMap, lockedAspect = null, fill = false }) {
  const list = markers || (marker ? [{ ...marker, page: marker.page || 1 }] : []);
  if (!file) return null;

  if (file.ext === "pdf") {
    return <PdfPagedViewer file={file} markers={list} editable={editable}
      onAddMarker={onAddMarker} onUpdateMarker={onUpdateMarker} onDeleteMarker={onDeleteMarker}
      onPages={onPages} lockedAspect={lockedAspect} fill={fill} />;
  }
  return <XlsxViewer file={file} markers={list} editable={editable} onAddMarker={onAddMarker} onPages={onPages} appliedSignature={appliedSignature} styleMap={styleMap} fill={fill} />;
}

// Convert a rectangle between viewport-space % and MediaBox-space % for an arbitrary
// page rotation (0/90/180/270 CW). MediaBox-space % is what's stored and stamped;
// viewport-space % is what the user clicks at after rotating the displayed page.
function viewportToMediabox(rotation, vx, vy, vw, vh) {
  switch (((rotation % 360) + 360) % 360) {
    case 90:  return { x: vy, y: 100 - vx - vw, w: vh, h: vw };
    case 180: return { x: 100 - vx - vw, y: 100 - vy - vh, w: vw, h: vh };
    case 270: return { x: 100 - vy - vh, y: vx, w: vh, h: vw };
    default:  return { x: vx, y: vy, w: vw, h: vh };
  }
}
function mediaboxToViewport(rotation, mx, my, mw, mh) {
  switch (((rotation % 360) + 360) % 360) {
    case 90:  return { x: 100 - my - mh, y: mx, w: mh, h: mw };
    case 180: return { x: 100 - mx - mw, y: 100 - my - mh, w: mw, h: mh };
    case 270: return { x: my, y: 100 - mx - mw, w: mh, h: mw };
    default:  return { x: mx, y: my, w: mw, h: mh };
  }
}

function PdfPagedViewer({ file, markers, editable, onAddMarker, onUpdateMarker, onDeleteMarker, onPages, lockedAspect = null, fill = false }) {
  const [pdf, setPdf] = useState(null);
  const [err, setErr] = useState(null);
  // Page 1's native aspect — used so placeholders for unrendered pages reserve
  // the right vertical space (so scroll position stays stable).
  const [pageAspect, setPageAspect] = useState(null);
  // How many pages have actually finished rendering, for the progress chip in
  // the header. Doesn't need to be precise — it's UX feedback only.
  const [renderedCount, setRenderedCount] = useState(0);
  // Bumped to force a retry from the error UI
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPdf(null); setErr(null); setPageAspect(null); setRenderedCount(0);
    (async () => {
      try {
        const loadingTask = pdfjsLib.getDocument({ url: file.base64 });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        setPdf(doc);
        onPages?.(doc.numPages);
        // Grab page-1 dimensions so placeholder divs can reserve correct height.
        // NON-FATAL: if this fails, placeholders fall back to a default A-paper
        // aspect ratio. We must not propagate an error here because the PDF
        // itself has loaded successfully.
        try {
          const p1 = await doc.getPage(1);
          if (cancelled) return;
          const v = p1.getViewport({ scale: 1 });
          setPageAspect(v.width / v.height);
        } catch { /* swallow — placeholder uses default aspect */ }
      } catch (e) {
        if (cancelled) return;
        // Log full error to the console so we can see it in mobile devtools
        // remote-inspect. The on-screen message is intentionally short.
        console.error("[viewer] PDF load failed:", e);
        setErr(e?.message || String(e) || "Unknown error");
      }
    })();
    return () => { cancelled = true; };
  }, [file.base64, retryTick]);

  // Only show the error state if the PDF itself never loaded. Any post-load
  // hiccup (e.g. dimension probe) shouldn't take down the viewer.
  if (!pdf) {
    if (err) return (
      <div className="card p-6 text-sm" style={{ color: "var(--c-rust)" }}>
        <div className="font-medium mb-2">Could not render PDF</div>
        <div className="text-xs opacity-80 mb-3 font-mono break-all">{err}</div>
        <button className="btn-ghost text-xs" onClick={() => setRetryTick(t => t + 1)}>Try again</button>
      </div>
    );
    return <div className="card p-10 text-sm opacity-50 text-center">Rendering PDF…</div>;
  }

  const pages = Array.from({ length: pdf.numPages }, (_, i) => i + 1);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "rgba(15,26,46,.08)", backgroundColor: "var(--c-paper)" }}>
        <div className="text-xs opacity-60">{pdf.numPages} page{pdf.numPages === 1 ? "" : "s"}</div>
        {renderedCount < pdf.numPages && (
          <div className="text-[10px] opacity-50 tracking-wider uppercase">{renderedCount} / {pdf.numPages} loaded</div>
        )}
      </div>
      <div style={{ ...(fill ? {} : { maxHeight: 720, overflowY: "auto" }), backgroundColor: "var(--c-paper-2)" }}>
        {pages.map(p => (
          <LazyPdfPage key={p} pdf={pdf} pageNum={p}
            pageAspect={pageAspect}
            onRendered={() => setRenderedCount(c => c + 1)}
            rotation={0}
            markers={markers.filter(m => (m.page || 1) === p)}
            editable={editable}
            lockedAspect={lockedAspect}
            onAddMarker={onAddMarker ? (x, y, w, h) => onAddMarker(p, x, y, w, h) : null}
            onUpdateMarker={onUpdateMarker}
            onDeleteMarker={onDeleteMarker} />
        ))}
      </div>
      {editable && <div className="text-xs opacity-60 px-4 py-2 border-t" style={{ borderColor: "rgba(15,26,46,.08)" }}>Click-drag where the signature should go.</div>}
    </div>
  );
}

// ============================================================
//   LAZY PDF PAGE
//   Wraps PdfPage with an IntersectionObserver so we don't try to
//   render all 63 (or 200) pages simultaneously — which crashes
//   mobile browsers. Placeholder reserves the right vertical space
//   using page 1's aspect ratio so scroll position stays stable.
// ============================================================
function LazyPdfPage({ pageAspect, onRendered, ...pageProps }) {
  const placeholderRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [renderedOnce, setRenderedOnce] = useState(false);

  useEffect(() => {
    if (visible) return;
    const el = placeholderRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        obs.disconnect();
      }
    }, { rootMargin: "400px 0px" }); // start rendering 400px before entering viewport
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible]);

  const handleRendered = () => {
    if (renderedOnce) return;
    setRenderedOnce(true);
    onRendered?.();
  };

  if (visible) {
    return <PdfPage {...pageProps} onRendered={handleRendered} />;
  }

  // Placeholder: must match the rendered PdfPage width EXACTLY so there's no
  // horizontal shift when a page mounts. Rendered page width is `clientWidth
  // - 24` (padX = 24 inside PdfPage). The wrapper here uses the same 12px
  // padding on each side, and the inner block fills 100% — so its rendered
  // CSS width matches PdfPage's canvas CSS width pixel-for-pixel.
  return (
    <div ref={placeholderRef}
      data-page-num={pageProps.pageNum}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: 12,
        width: "100%"
      }}>
      <div style={{
        width: "100%",
        aspectRatio: pageAspect ? String(pageAspect) : "1 / 1.4142",
        background: "var(--c-paper)",
        boxShadow: "0 2px 12px rgba(0,0,0,.06)",
        borderRadius: 2,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "rgba(15,26,46,.35)",
        fontSize: 11,
        letterSpacing: ".08em",
        textTransform: "uppercase"
      }}>
        Page {pageProps.pageNum} · loading…
      </div>
      <div className="text-[10px] tracking-widest uppercase opacity-30 mt-2">Page {pageProps.pageNum}</div>
    </div>
  );
}

function PdfPage({ pdf, pageNum, markers, editable, onAddMarker, onUpdateMarker, onDeleteMarker, rotation = 0, lockedAspect = null, onRendered }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [drawing, setDrawing] = useState(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Constrain a viewport %-rectangle to satisfy lockedAspect (signature width/height
  // in MediaBox units). Anchors the rectangle at (vx, vy) and shrinks the larger
  // dimension. Returns null if there's no lock or canvas hasn't measured yet.
  const lockRect = (vx, vy, vw, vh) => {
    if (!lockedAspect || !size.w || !size.h) return null;
    // Target viewport ratio so that the resulting MediaBox rectangle has aspect α.
    // At rotation 0: vw_px / vh_px = α   →   vw/vh = α * (canvas_h / canvas_w).
    const target = lockedAspect * (size.h / size.w);
    const currentRatio = vw / Math.max(vh, 0.0001);
    if (currentRatio > target) {
      // Too wide → shrink width to match height
      vw = vh * target;
    } else {
      // Too tall → shrink height to match width
      vh = vw / target;
    }
    // Keep inside page bounds (anchor at vx, vy)
    if (vx + vw > 100) vw = Math.max(1, 100 - vx);
    if (vy + vh > 100) vh = Math.max(1, 100 - vy);
    return { vx, vy, vw, vh };
  };

  // Cancel any in-progress drag when the user rotates the page
  useEffect(() => { setDrawing(null); }, [rotation]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const page = await pdf.getPage(pageNum);
      const wrapEl = wrapRef.current;
      const padX = 24;
      const containerW = Math.max(200, (wrapEl?.clientWidth || 800) - padX);
      // Render at the user's chosen rotation. The stamp itself is always drawn
      // horizontally in MediaBox regardless of this rotation.
      const baseViewport = page.getViewport({ scale: 1, rotation });
      const cssScale = containerW / baseViewport.width;
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: cssScale * dpr, rotation });
      const cssW = baseViewport.width * cssScale;
      const cssH = baseViewport.height * cssScale;
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const ctx = canvas.getContext("2d");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      setSize({ w: cssW, h: cssH });
      try {
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) onRendered?.();
      } catch (e) { /* render aborted */ }
    })();
    return () => { cancelled = true; };
  }, [pdf, pageNum, rotation]);

  const xy = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * 100,
      y: ((e.clientY - r.top) / r.height) * 100
    };
  };

  const onDown = (e) => {
    if (!editable || !onAddMarker) return;
    const { x, y } = xy(e);
    setDrawing({ sx: x, sy: y, x, y });
  };
  const onMove = (e) => {
    if (!drawing) return;
    const { x, y } = xy(e);
    setDrawing({ ...drawing, x, y });
  };
  const onUp = () => {
    if (!drawing) return;
    const dragW = Math.abs(drawing.x - drawing.sx);
    const dragH = Math.abs(drawing.y - drawing.sy);
    let vx, vy, vw, vh;
    // If the user just clicked without a meaningful drag, drop a compact standard-sized
    // box on the click — sized so it rarely needs resizing (drag for a custom size).
    if (dragW < 4 && dragH < 2) {
      vw = 15; vh = 5;
      vx = drawing.sx - vw / 2;
      vy = drawing.sy - vh / 2;
    } else {
      vx = Math.min(drawing.sx, drawing.x);
      vy = Math.min(drawing.sy, drawing.y);
      vw = dragW; vh = dragH;
    }
    // Clamp inside the viewport
    if (vx < 0) vx = 0;
    if (vy < 0) vy = 0;
    if (vx + vw > 100) vx = Math.max(0, 100 - vw);
    if (vy + vh > 100) vy = Math.max(0, 100 - vh);
    // Snap to the signer's signature aspect when one is known
    const locked = lockRect(vx, vy, vw, vh);
    if (locked) { vx = locked.vx; vy = locked.vy; vw = locked.vw; vh = locked.vh; }
    // Convert viewport-space coords (what the user clicked at the current rotation) to
    // MediaBox-space coords for storage and stamping.
    const m = viewportToMediabox(rotation, vx, vy, vw, vh);
    onAddMarker(m.x, m.y, m.w, m.h);
    setDrawing(null);
  };

  // Live drag preview, locked to aspect if applicable
  const previewRect = (() => {
    if (!drawing) return null;
    const vx = Math.min(drawing.sx, drawing.x);
    const vy = Math.min(drawing.sy, drawing.y);
    let vw = Math.abs(drawing.x - drawing.sx);
    let vh = Math.abs(drawing.y - drawing.sy);
    const locked = lockRect(vx, vy, vw, vh);
    if (locked) { vw = locked.vw; vh = locked.vh; }
    return { vx, vy, vw, vh };
  })();

  return (
    <div ref={wrapRef} data-page-num={pageNum} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 12 }}>
      <div data-marker-parent style={{ position: "relative", boxShadow: "0 2px 12px rgba(0,0,0,.12)" }}
           onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => setDrawing(null)}>
        <canvas ref={canvasRef} style={{ display: "block", cursor: editable ? "crosshair" : "default" }} />
        {markers.map((m, i) => {
          // Convert MediaBox coords (storage) → viewport coords for display at current rotation
          const v = mediaboxToViewport(rotation, m.x, m.y, m.w, m.h);
          const updateHandler = (editable && onUpdateMarker)
            ? (vpNext) => {
                // Convert viewport coords back to MediaBox before propagating up
                const mb = viewportToMediabox(rotation, vpNext.x, vpNext.y, vpNext.w, vpNext.h);
                onUpdateMarker(m.id, { x: mb.x, y: mb.y, w: mb.w, h: mb.h, page: pageNum });
              }
            : undefined;
          const deleteHandler = (editable && onDeleteMarker)
            ? () => onDeleteMarker(m.id)
            : undefined;
          return <MarkerOverlay key={m.id || i}
            m={{ ...m, x: v.x, y: v.y, w: v.w, h: v.h }}
            editable={editable}
            onUpdate={updateHandler}
            onDelete={deleteHandler} />;
        })}
        {previewRect && (
          <div style={{
            position: "absolute",
            left: `${previewRect.vx}%`, top: `${previewRect.vy}%`,
            width: `${previewRect.vw}%`, height: `${previewRect.vh}%`,
            border: "2px dashed #B8894A", backgroundColor: "rgba(184,137,74,.18)", pointerEvents: "none"
          }} />
        )}
      </div>
      <div className="text-[10px] tracking-widest uppercase opacity-40 mt-2">Page {pageNum}</div>
    </div>
  );
}

function MarkerOverlay({ m, editable, onUpdate, onDelete }) {
  const color = m.color || "#B8894A";
  const isSigned = !!m.signedDataUrl;
  const highlight = m.highlight;
  const interactive = !!(editable && onUpdate);

  // ---- drag handlers (move + resize) ----
  function startDrag(e, kind) {
    if (!interactive) return;
    e.stopPropagation();
    e.preventDefault();
    const parent = e.currentTarget.closest("[data-marker-parent]") || e.currentTarget.parentElement;
    const parentRect = parent.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const startM = { x: m.x, y: m.y, w: m.w, h: m.h };

    const move = (e2) => {
      const dxPct = ((e2.clientX - startX) / parentRect.width) * 100;
      const dyPct = ((e2.clientY - startY) / parentRect.height) * 100;
      let nx = startM.x, ny = startM.y, nw = startM.w, nh = startM.h;
      if (kind === "move") {
        nx = clamp(startM.x + dxPct, 0, 100 - startM.w);
        ny = clamp(startM.y + dyPct, 0, 100 - startM.h);
      } else if (kind === "nw") {
        nx = clamp(startM.x + dxPct, 0, startM.x + startM.w - 2);
        ny = clamp(startM.y + dyPct, 0, startM.y + startM.h - 1);
        nw = startM.x + startM.w - nx;
        nh = startM.y + startM.h - ny;
      } else if (kind === "ne") {
        ny = clamp(startM.y + dyPct, 0, startM.y + startM.h - 1);
        nh = startM.y + startM.h - ny;
        nw = clamp(startM.w + dxPct, 2, 100 - startM.x);
      } else if (kind === "sw") {
        nx = clamp(startM.x + dxPct, 0, startM.x + startM.w - 2);
        nw = startM.x + startM.w - nx;
        nh = clamp(startM.h + dyPct, 1, 100 - startM.y);
      } else if (kind === "se") {
        nw = clamp(startM.w + dxPct, 2, 100 - startM.x);
        nh = clamp(startM.h + dyPct, 1, 100 - startM.y);
      }
      onUpdate({ x: nx, y: ny, w: nw, h: nh });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  const handleStyle = (corner) => ({
    position: "absolute",
    width: 10, height: 10,
    backgroundColor: color,
    border: "2px solid #FAF7F0",
    borderRadius: 2,
    cursor: corner === "nw" ? "nwse-resize" : corner === "ne" ? "nesw-resize"
          : corner === "sw" ? "nesw-resize" : "nwse-resize",
    ...(corner === "nw" ? { left: -6, top: -6 } : {}),
    ...(corner === "ne" ? { right: -6, top: -6 } : {}),
    ...(corner === "sw" ? { left: -6, bottom: -6 } : {}),
    ...(corner === "se" ? { right: -6, bottom: -6 } : {}),
    pointerEvents: "auto"
  });

  return (
    <div data-sig-jump={m.highlight !== false ? "true" : undefined}
      style={{
      position: "absolute",
      left: `${m.x}%`, top: `${m.y}%`,
      width: `${m.w}%`, height: `${m.h}%`,
      border: `2px ${highlight ? "solid" : "dashed"} ${highlight ? "#B8894A" : color}`,
      backgroundColor: isSigned ? "transparent" : (highlight ? "rgba(184,137,74,.18)" : `${color}1A`),
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 10, color: color, fontWeight: 600,
      pointerEvents: interactive ? "auto" : "none",
      cursor: interactive ? "move" : "default",
      boxShadow: highlight ? "0 0 0 2px rgba(184,137,74,.35)" : "none"
    }}
      onMouseDown={interactive ? (e) => startDrag(e, "move") : undefined}>
      {isSigned ? (
        <img src={m.signedDataUrl} alt="signature" style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} />
      ) : (
        <span style={{ padding: "2px 4px", backgroundColor: "rgba(255,255,255,.85)", borderRadius: 3, lineHeight: 1.1, textAlign: "center", pointerEvents: "none" }}>
          {m.label || "SIGN HERE"}
        </span>
      )}
      {interactive && (
        <>
          <div style={handleStyle("nw")} onMouseDown={(e) => startDrag(e, "nw")} />
          <div style={handleStyle("ne")} onMouseDown={(e) => startDrag(e, "ne")} />
          <div style={handleStyle("sw")} onMouseDown={(e) => startDrag(e, "sw")} />
          <div style={handleStyle("se")} onMouseDown={(e) => startDrag(e, "se")} />
          {onDelete && (
            <button onMouseDown={(e) => { e.stopPropagation(); }} onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="Remove marker"
              style={{ position: "absolute", top: -10, right: -10, width: 18, height: 18, borderRadius: 9, backgroundColor: "#9B2C2C", color: "#F5F1E8", border: "2px solid #FAF7F0", fontSize: 11, lineHeight: "12px", padding: 0, cursor: "pointer", pointerEvents: "auto" }}>×</button>
          )}
        </>
      )}
    </div>
  );
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function xlsxBorderCss(bd) {
  if (!bd) return {};
  const w = { thin: "1px", medium: "2px" };
  const s = {};
  if (bd.t) s.borderTop = `${w[bd.t] || "1px"} solid #333`;
  if (bd.b) s.borderBottom = `${w[bd.b] || "1px"} solid #333`;
  if (bd.l) s.borderLeft = `${w[bd.l] || "1px"} solid #333`;
  if (bd.r) s.borderRight = `${w[bd.r] || "1px"} solid #333`;
  return s;
}

function xlsxCellStyle(sty) {
  if (!sty) return {};
  const css = {};
  if (sty.b) css.fontWeight = "bold";
  if (sty.fs) css.fontSize = `${sty.fs}pt`;
  if (sty.ha) css.textAlign = sty.ha;
  if (sty.va === "center") css.verticalAlign = "middle";
  else if (sty.va === "top") css.verticalAlign = "top";
  if (sty.wr) css.whiteSpace = "normal";
  return { ...css, ...xlsxBorderCss(sty.bd) };
}

export function XlsxViewer({ file, markers, editable, onAddMarker, onPages, appliedSignature, cellEditable, lockedCells, onWorkbookReady, styleMap, fill = false }) {
  const [wb, setWb] = useState(null);
  const [sheetNames, setSheetNames] = useState([]);
  const [activeSheet, setActiveSheet] = useState(null);
  const [grid, setGrid] = useState([]);
  const [drawing, setDrawing] = useState(null);
  const [editTick, setEditTick] = useState(0);
  const pageRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let u8;
        if (file.base64.startsWith("blob:")) {
          const resp = await fetch(file.base64);
          const buf = await resp.arrayBuffer();
          u8 = new Uint8Array(buf);
        } else {
          const b64 = file.base64.split(",")[1];
          const bin = atob(b64);
          u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        }
        if (cancelled) return;
        const workbook = XLSX.read(u8, { type: "array", cellDates: true });
        setWb(workbook);
        setSheetNames(workbook.SheetNames);
        const firstVisible = cellEditable
          ? (workbook.SheetNames.find(s => s !== "Sheet1") || workbook.SheetNames[0])
          : workbook.SheetNames[0];
        setActiveSheet(firstVisible);
        onPages?.(workbook.SheetNames.length);
        onWorkbookReady?.(workbook);
      } catch (e) { console.error(e); }
    })();
    return () => { cancelled = true; };
  }, [file.base64]);

  useEffect(() => {
    if (!wb || !activeSheet) { setGrid([]); return; }
    const ws = wb.Sheets[activeSheet];
    if (!ws || !ws["!ref"]) { setGrid([]); return; }
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const merges = ws["!merges"] || [];
    const merged = {};
    for (const m of merges) {
      for (let r = m.s.r; r <= m.e.r; r++)
        for (let c = m.s.c; c <= m.e.c; c++)
          if (r !== m.s.r || c !== m.s.c) merged[`${r}:${c}`] = true;
    }
    const findMerge = (r, c) => merges.find(m => m.s.r === r && m.s.c === c);
    const rows = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cells = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        if (merged[`${r}:${c}`]) continue;
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        const m = findMerge(r, c);
        let display = "";
        if (cell) {
          if (cell.t === "d" && cell.v instanceof Date) {
            display = cell.v.toLocaleDateString();
          } else if (cell.w) {
            display = cell.w;
          } else if (cell.v != null) {
            display = String(cell.v);
          }
        }
        cells.push({
          addr, r, c, display,
          colSpan: m ? m.e.c - m.s.c + 1 : 1,
          rowSpan: m ? m.e.r - m.s.r + 1 : 1
        });
      }
      rows.push(cells);
    }
    setGrid(rows);
  }, [wb, activeSheet, editTick]);

  const handleCellEdit = (addr, newVal) => {
    if (!wb || !activeSheet) return;
    const ws = wb.Sheets[activeSheet];
    if (newVal === "") {
      delete ws[addr];
    } else {
      const num = Number(newVal);
      ws[addr] = isNaN(num) || newVal.trim() === "" ? { t: "s", v: newVal } : { t: "n", v: num };
    }
    setEditTick(t => t + 1);
  };

  const onDown = (e) => {
    if (!editable || !onAddMarker) return;
    const r = pageRef.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    setDrawing({ sx: x, sy: y, x, y });
  };
  const onMove = (e) => {
    if (!drawing) return;
    const r = pageRef.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    setDrawing({ ...drawing, x, y });
  };
  const onUp = () => {
    if (!drawing) return;
    const dragW = Math.abs(drawing.x - drawing.sx);
    const dragH = Math.abs(drawing.y - drawing.sy);
    let x, y, w, h;
    if (dragW < 4 && dragH < 2) {
      w = 22; h = 6;
      x = drawing.sx - w / 2;
      y = drawing.sy - h / 2;
    } else {
      x = Math.min(drawing.sx, drawing.x);
      y = Math.min(drawing.sy, drawing.y);
      w = dragW; h = dragH;
    }
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    onAddMarker(1, x, y, w, h);
    setDrawing(null);
  };

  const visibleSheets = cellEditable ? sheetNames.filter(s => s !== "Sheet1") : sheetNames;
  const sm = styleMap?.styles || {};
  const rh = styleMap?.rowHeights || {};
  const cw = styleMap?.colWidths || {};
  const hasStyles = Object.keys(sm).length > 0;

  return (
    <div className="card overflow-hidden">
      {visibleSheets.length > 1 && (
        <div className="flex border-b" style={{ borderColor: "rgba(15,26,46,.08)" }}>
          {visibleSheets.map(s => (
            <button key={s} onClick={() => setActiveSheet(s)}
              className={`px-4 py-2 text-xs font-medium ${activeSheet === s ? "" : "opacity-50"}`}
              style={{ borderBottom: activeSheet === s ? "2px solid #B8894A" : "2px solid transparent" }}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div ref={pageRef}
           onMouseDown={editable ? onDown : undefined} onMouseMove={editable ? onMove : undefined}
           onMouseUp={editable ? onUp : undefined} onMouseLeave={editable ? () => setDrawing(null) : undefined}
           style={{ position: "relative", minHeight: 400, ...(fill ? {} : { maxHeight: 720, overflow: "auto" }), cursor: editable ? "crosshair" : "default", backgroundColor: "#fff" }}>
        <style>{`
          .xlsx-grid { border-collapse: collapse; font-family: Calibri, Arial, sans-serif; font-size: 10pt; table-layout: fixed; width: 100%; }
          .xlsx-grid td { padding: 3px 6px; white-space: pre-wrap; overflow: hidden; word-break: break-word; ${hasStyles ? "" : "border: 1px solid rgba(15,26,46,.15);"} }
          .xlsx-grid td.cell-editable { cursor: text; }
          .xlsx-grid td.cell-editable:hover { background: rgba(184,137,74,.08); }
          .xlsx-grid td.cell-editable:focus { outline: 2px solid #B8894A; outline-offset: -2px; background: #FFFDF5; }
          .xlsx-grid td.cell-locked { cursor: default; background: rgba(15,26,46,.03); color: rgba(15,26,46,.55); font-style: italic; }
        `}</style>
        <div style={{ padding: "12px 16px" }}>
          <table className="xlsx-grid">
            {Object.keys(cw).length > 0 && (
              <colgroup>
                {Array.from({ length: 9 }, (_, i) => {
                  const letter = String.fromCharCode(65 + i);
                  return <col key={i} style={{ width: cw[letter] ? `${cw[letter]}px` : 130 }} />;
                })}
              </colgroup>
            )}
            <tbody>
              {grid.map((row, ri) => {
                const rowNum = ri + 1;
                const rowH = rh[String(rowNum)];
                return (
                  <tr key={ri} style={rowH ? { height: `${rowH}px` } : undefined}>
                    {row.map(cell => {
                      const sty = sm[cell.addr];
                      const cellCss = sty ? xlsxCellStyle(sty) : (hasStyles ? {} : {});
                      const isLocked = lockedCells?.has(cell.addr);
                      const isEditable = cellEditable && !isLocked;
                      return (
                        <td key={cell.addr}
                          colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                          rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                          className={isLocked ? "cell-locked" : isEditable ? "cell-editable" : ""}
                          style={cellCss}
                          contentEditable={isEditable ? true : undefined}
                          suppressContentEditableWarning
                          onBlur={isEditable ? e => {
                            const newVal = e.currentTarget.textContent || "";
                            if (newVal !== cell.display) handleCellEdit(cell.addr, newVal);
                          } : undefined}
                        >{cell.display}</td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {markers.map((m, i) => (
          <MarkerOverlay key={m.id || i} m={{ ...m, signedDataUrl: m.signedDataUrl || appliedSignature }} />
        ))}
        {drawing && (
          <div style={{
            position: "absolute",
            left: `${Math.min(drawing.sx, drawing.x)}%`, top: `${Math.min(drawing.sy, drawing.y)}%`,
            width: `${Math.abs(drawing.x - drawing.sx)}%`, height: `${Math.abs(drawing.y - drawing.sy)}%`,
            border: "2px dashed #B8894A", backgroundColor: "rgba(184,137,74,.18)", pointerEvents: "none"
          }} />
        )}
      </div>
      {editable && <div className="text-xs opacity-60 px-4 py-2 border-t" style={{ borderColor: "rgba(15,26,46,.08)" }}>Click and drag on the active sheet to place a signature.</div>}
      {cellEditable && <div className="text-xs opacity-60 px-4 py-2 border-t" style={{ borderColor: "rgba(15,26,46,.08)" }}>Click any cell to edit its value.</div>}
    </div>
  );
}

// Default export = both renderers as named members
export default { DocPreview, XlsxViewer };
