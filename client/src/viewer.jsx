// ============================================================
//   DOCUMENT VIEWER MODULE — lazy-loaded
//   ------------------------------------------------------------
//   Houses the PDF renderer (pdfjs-dist) and the XLSX renderer
//   (SheetJS) plus their marker/overlay machinery. Extracted from
//   App.jsx so the heavy pdfjs + xlsx dependencies live in their
//   own chunk and only download when the user actually previews a
//   document — not on initial page load.
// ============================================================
import { useState, useEffect, useRef, useMemo } from "react";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import * as XLSX from "xlsx";

import { boxPercentFor, boxMillimetres, snapBox } from "./lib/boxSize.js";

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
export function DocPreview({ file, marker, markers, editable = false, onAddMarker, onUpdateMarker, onDeleteMarker, onPages, appliedSignature, styleMap, lockedAspect = null, fixedBox = null, boxSpec = null, resizeToken = 0, fill = false, rotation = 0, onRotate }) {
  const list = markers || (marker ? [{ ...marker, page: marker.page || 1 }] : []);
  if (!file) return null;

  if (file.ext === "pdf") {
    return <PdfPagedViewer file={file} markers={list} editable={editable}
      onAddMarker={onAddMarker} onUpdateMarker={onUpdateMarker} onDeleteMarker={onDeleteMarker}
      onPages={onPages} lockedAspect={lockedAspect} fixedBox={fixedBox} boxSpec={boxSpec} resizeToken={resizeToken} fill={fill} rotation={rotation} onRotate={onRotate} />;
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

function PdfPagedViewer({ file, markers, editable, onAddMarker, onUpdateMarker, onDeleteMarker, onPages, lockedAspect = null, fixedBox = null, boxSpec = null, resizeToken = 0, fill = false, rotation = 0, onRotate }) {
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
  // Touch placement mode. OFF by default so a one-finger drag SCROLLS the
  // document on mobile. When armed, the next tap on a page drops a signature
  // box (and it disarms). On touch you can also press-and-hold a page to drop
  // a box without arming; on a mouse, plain click-drag works as before.
  const [armed, setArmed] = useState(false);
  // Detect a touch-primary device so the footer hint names the right gesture.
  const isTouch = typeof window !== "undefined" &&
    (("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0);

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
      <div className="flex items-center justify-between px-3 py-2 border-b gap-3" style={{ borderColor: "rgba(15,26,46,.08)", backgroundColor: "var(--c-paper)" }}>
        <div className="text-xs opacity-60">{pdf.numPages} page{pdf.numPages === 1 ? "" : "s"}</div>
        <div className="flex items-center gap-3">
          {renderedCount < pdf.numPages && (
            <div className="text-[10px] opacity-50 tracking-wider uppercase">{renderedCount} / {pdf.numPages} loaded</div>
          )}
          {onRotate && (
            <button type="button" onClick={onRotate} title="Rotate the document 90°"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border transition-colors"
              style={{ borderColor: "rgba(15,26,46,.18)", color: "var(--c-ink)" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/></svg>
              Rotate{rotation ? ` · ${((rotation % 360) + 360) % 360}°` : ""}
            </button>
          )}
        </div>
      </div>
      <div style={{ ...(fill ? {} : { maxHeight: 720, overflowY: "auto" }), backgroundColor: "var(--c-paper-2)" }}>
        {pages.map(p => (
          <LazyPdfPage key={p} pdf={pdf} pageNum={p}
            pageAspect={pageAspect}
            onRendered={() => setRenderedCount(c => c + 1)}
            rotation={rotation}
            markers={markers.filter(m => (m.page || 1) === p)}
            editable={editable}
            armed={armed}
            onPlaced={() => setArmed(false)}
            lockedAspect={lockedAspect}
            fixedBox={fixedBox}
            boxSpec={boxSpec}
            resizeToken={resizeToken}
            onAddMarker={onAddMarker ? (x, y, w, h) => onAddMarker(p, x, y, w, h) : null}
            onUpdateMarker={onUpdateMarker}
            onDeleteMarker={onDeleteMarker} />
        ))}
      </div>
      {editable && (
        <div className="px-4 py-3 border-t flex items-center gap-3 flex-wrap" style={{ borderColor: "rgba(15,26,46,.08)" }}>
          {armed ? (
            <>
              <span className="inline-flex items-center gap-2 text-xs font-medium" style={{ color: "#B8894A" }}>
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: "#B8894A" }} />
                Tap the page where the signature should go
              </span>
              <button type="button" className="btn-ghost text-xs" onClick={() => setArmed(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button type="button" className="btn-primary text-xs" onClick={() => setArmed(true)}>+ Add signature box</button>
              <span className="text-xs opacity-55">
                {isTouch
                  ? "Tap “Add signature box”, then tap the page — or just press and hold the page. Scroll freely with one finger."
                  : "Click “Add signature box” then click the page, or click-drag on the page to size it."}
              </span>
            </>
          )}
        </div>
      )}
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

// How long a stationary touch must be held to count as a "place here" long-press.
const LONGPRESS_MS = 420;
// If the finger travels more than this (px) the gesture is a scroll, not a press.
const MOVE_CANCEL_PX = 12;

function PdfPage({ pdf, pageNum, markers, editable, onAddMarker, onUpdateMarker, onDeleteMarker, rotation = 0, lockedAspect = null, fixedBox = null, boxSpec = null, resizeToken = 0, onRendered, armed = false, onPlaced }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [drawing, setDrawing] = useState(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // The page in PDF points, so a box can be sized in millimetres.
  const [ptSize, setPtSize] = useState(null);
  // The page's own /Rotate (e.g. a stored file the requestor rotated on submit).
  // The `rotation` prop is ADDED on top so an approver viewing an already-rotated
  // file sees it upright, and markers (stored in the un-rotated frame) still align.
  const [nativeRot, setNativeRot] = useState(0);
  const effRot = (((nativeRot + rotation) % 360) + 360) % 360;
  // Pending long-press: { timer, cx, cy } while a stationary touch is held.
  const longPressRef = useRef(null);

  // The drop size, in page percentages, derived from a millimetre height and the
  // signer's own signature shape. Falls back to the caller's fixed %-box while
  // the page is still being measured, or when no spec was given.
  const effBox = useMemo(() => {
    if (!boxSpec) return fixedBox;
    return boxPercentFor({ ...boxSpec, pagePt: ptSize }) || fixedBox;
  }, [boxSpec, ptSize, fixedBox]);

  // A box whose shape does not match the signature going into it leaves slack,
  // because the stamp is contain-fitted. So the aspect is always locked — to the
  // signer's real signature where we know it, to the spec's default otherwise.
  const effAspect = boxSpec?.aspect || lockedAspect;

  // Rescale the boxes ALREADY on this page when the size preset changes. A size
  // control that only affects the next box dropped reads as broken — you click
  // Large and nothing moves. Each box keeps its own shape and its own centre;
  // only the height is driven to the new preset. Date boxes are left alone,
  // since they are sized from their text rather than from this control.
  const lastResize = useRef(resizeToken);
  useEffect(() => {
    if (resizeToken === lastResize.current) return;
    lastResize.current = resizeToken;
    if (!effBox || !onUpdateMarker || !markers?.length) return;
    for (const m of markers) {
      if (m.kind === "date") continue;
      const v = mediaboxToViewport(effRot, m.x, m.y, m.w, m.h);
      if (!(v.h > 0)) continue;
      const k = effBox.h / v.h;
      if (!isFinite(k) || Math.abs(k - 1) < 0.005) continue;
      const nh = effBox.h;
      const nw = v.w * k;
      const nx = clamp(v.x + (v.w - nw) / 2, 0, Math.max(0, 100 - nw));
      const ny = clamp(v.y + (v.h - nh) / 2, 0, Math.max(0, 100 - nh));
      const mb = viewportToMediabox(effRot, nx, ny, nw, nh);
      onUpdateMarker(m.id, { x: mb.x, y: mb.y, w: mb.w, h: mb.h, page: pageNum });
    }
    // markers/effBox are read fresh each time the token changes; re-running on
    // their own identity would fight the user mid-drag.
  }, [resizeToken]);

  // Constrain a viewport %-rectangle to satisfy effAspect (signature width/height
  // in MediaBox units). Anchors the rectangle at (vx, vy) and shrinks the larger
  // dimension. Returns null if there's no lock or canvas hasn't measured yet.
  const lockRect = (vx, vy, vw, vh) => {
    if (!effAspect || !size.w || !size.h) return null;
    // Target viewport ratio so that the resulting MediaBox rectangle has aspect α.
    // At rotation 0: vw_px / vh_px = α   →   vw/vh = α * (canvas_h / canvas_w).
    const target = effAspect * (size.h / size.w);
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
      const nr = page.rotate || 0;
      if (!cancelled) setNativeRot(nr);
      const eff = (((nr + rotation) % 360) + 360) % 360;
      const wrapEl = wrapRef.current;
      const padX = 24;
      const containerW = Math.max(200, (wrapEl?.clientWidth || 800) - padX);
      // Render at the page's native rotation plus the user's chosen rotation. The
      // stamp itself is drawn upright regardless (see placeInRotatedPage server-side).
      const baseViewport = page.getViewport({ scale: 1, rotation: eff });
      // Scale 1 means PDF points, in the orientation actually on screen. This is
      // what lets a box be sized in millimetres rather than as a percentage —
      // the same percentage is 46 mm on A4 and 65 mm on A3.
      if (!cancelled) setPtSize({ w: baseViewport.width, h: baseViewport.height });
      const cssScale = containerW / baseViewport.width;
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: cssScale * dpr, rotation: eff });
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

  // Commit a signature box from a start point + current point (viewport %).
  // With fixedBox set (the default from the request builder), every placement
  // drops the SAME standard-sized box centred on the tap / drag midpoint —
  // uniform, industry-style fields; the handles still allow manual resizing.
  // Without it: a negligible drag drops a compact default, a real drag uses the
  // dragged rectangle. Shared by mouse-drag, armed tap, and touch long-press.
  const commitBox = (sx, sy, cx, cy) => {
    const dragW = Math.abs(cx - sx);
    const dragH = Math.abs(cy - sy);
    let vx, vy, vw, vh;
    if (effBox) {
      vw = effBox.w; vh = effBox.h;
      const midX = (sx + cx) / 2, midY = (sy + cy) / 2;
      vx = midX - vw / 2;
      vy = midY - vh / 2;
    } else if (dragW < 4 && dragH < 2) {
      vw = 15; vh = 5;
      vx = sx - vw / 2;
      vy = sy - vh / 2;
    } else {
      vx = Math.min(sx, cx);
      vy = Math.min(sy, cy);
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
    // Convert viewport-space coords to MediaBox-space for storage and stamping.
    const m = viewportToMediabox(effRot, vx, vy, vw, vh);
    onAddMarker(m.x, m.y, m.w, m.h);
    onPlaced?.();
  };

  const clearLongPress = () => {
    if (longPressRef.current?.timer) clearTimeout(longPressRef.current.timer);
    longPressRef.current = null;
  };

  const onDown = (e) => {
    if (!editable || !onAddMarker) return;
    const { x, y } = xy(e);
    // Mouse / stylus, or an explicitly armed touch → start drawing immediately.
    if (e.pointerType !== "touch" || armed) {
      setDrawing({ sx: x, sy: y, x, y });
      return;
    }
    // Bare touch: don't draw yet. A one-finger drag scrolls the page (touch-action
    // allows it). Only a stationary press-and-hold drops a box, so accidental taps
    // and scroll gestures never create markers.
    clearLongPress();
    const timer = setTimeout(() => {
      longPressRef.current = null;
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch { /* ignore */ } }
      commitBox(x, y, x, y);
    }, LONGPRESS_MS);
    longPressRef.current = { timer, cx: e.clientX, cy: e.clientY };
  };
  const onMove = (e) => {
    // A moving finger means the user is scrolling — abort the pending long-press.
    if (longPressRef.current) {
      const dx = Math.abs(e.clientX - longPressRef.current.cx);
      const dy = Math.abs(e.clientY - longPressRef.current.cy);
      if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) clearLongPress();
    }
    if (!drawing) return;
    const { x, y } = xy(e);
    setDrawing({ ...drawing, x, y });
  };
  const onUp = () => {
    clearLongPress();
    if (!drawing) return;
    commitBox(drawing.sx, drawing.sy, drawing.x, drawing.y);
    setDrawing(null);
  };
  const onCancel = () => { clearLongPress(); setDrawing(null); };

  // Live drag preview — with fixedBox the ghost is the standard-sized box
  // following the cursor; otherwise the dragged rectangle (aspect-locked if set).
  const previewRect = (() => {
    if (!drawing) return null;
    if (effBox) {
      const midX = (drawing.sx + drawing.x) / 2, midY = (drawing.sy + drawing.y) / 2;
      return { vx: midX - effBox.w / 2, vy: midY - effBox.h / 2, vw: effBox.w, vh: effBox.h };
    }
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
      <div data-marker-parent style={{ position: "relative", boxShadow: "0 2px 12px rgba(0,0,0,.12)", touchAction: editable ? (armed ? "none" : "manipulation") : undefined }}
           onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onCancel} onPointerCancel={onCancel}>
        <canvas ref={canvasRef} style={{ display: "block", cursor: editable ? "crosshair" : "default" }} />
        {markers.map((m, i) => {
          // Convert MediaBox coords (storage) → viewport coords for display at current rotation
          const v = mediaboxToViewport(effRot, m.x, m.y, m.w, m.h);
          const updateHandler = (editable && onUpdateMarker)
            ? (vpNext) => {
                // Convert viewport coords back to MediaBox before propagating up
                const mb = viewportToMediabox(effRot, vpNext.x, vpNext.y, vpNext.w, vpNext.h);
                onUpdateMarker(m.id, { x: mb.x, y: mb.y, w: mb.w, h: mb.h, page: pageNum });
              }
            : undefined;
          const deleteHandler = (editable && onDeleteMarker)
            ? () => onDeleteMarker(m.id)
            : undefined;
          return <MarkerOverlay key={m.id || i}
            m={{ ...m, x: v.x, y: v.y, w: v.w, h: v.h }}
            editable={editable}
            aspect={effAspect}
            pagePt={ptSize}
            canvasPx={size}
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

function MarkerOverlay({ m, editable, onUpdate, onDelete, aspect = null, pagePt = null, canvasPx = null }) {
  const color = m.color || "#B8894A";
  const isSigned = !!m.signedDataUrl;
  const highlight = m.highlight;
  const interactive = !!(editable && onUpdate);
  // Shown only while the box is being dragged — a permanent label on every box
  // would clutter a page with a dozen of them.
  const [sizing, setSizing] = useState(false);
  const lastRef = useRef(null);
  const mm = boxMillimetres({ box: { w: m.w, h: m.h }, pagePt });

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
      // Resizing keeps the signature's own shape. A box that drifts off-aspect
      // leaves slack once the stamp is contain-fitted, which is the thing that
      // made people fiddle with these in the first place.
      if (kind !== "move" && aspect && canvasPx?.w && canvasPx?.h) {
        const target = aspect * (canvasPx.h / canvasPx.w);   // %-space ratio for aspect α
        nw = nh * target;
        // Re-anchor the edge the user is actually dragging, so the box grows
        // from the opposite corner rather than sliding away from the cursor.
        if (kind === "nw" || kind === "sw") nx = startM.x + startM.w - nw;
        if (kind === "nw" || kind === "ne") ny = startM.y + startM.h - nh;
        nx = clamp(nx, 0, Math.max(0, 100 - nw));
        ny = clamp(ny, 0, Math.max(0, 100 - nh));
      }
      lastRef.current = { x: nx, y: ny, w: nw, h: nh };
      onUpdate(lastRef.current);
    };
    setSizing(true);
    const up = () => {
      setSizing(false);
      // Land on a whole millimetre. A dragged box otherwise settles on values like
      // 17.3 mm, which look careless across a page of them.
      if (kind !== "move" && aspect && pagePt && lastRef.current) {
        const snapped = snapBox({ box: lastRef.current, aspect, pagePt });
        onUpdate({ ...lastRef.current, w: snapped.w, h: snapped.h });
      }
      lastRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // 14px with a 20px hit area. The old 10px squares were a hard target with a
  // mouse and close to unusable with a fingertip, which is its own reason people
  // struggled to resize these.
  const handleStyle = (corner) => ({
    position: "absolute",
    width: 14, height: 14,
    boxSizing: "content-box",
    padding: 3,                       // grows the hit area without growing the dot
    backgroundColor: color,
    backgroundClip: "content-box",
    border: "2px solid #FAF7F0",
    borderRadius: 3,
    cursor: corner === "nw" ? "nwse-resize" : corner === "ne" ? "nesw-resize"
          : corner === "sw" ? "nesw-resize" : "nwse-resize",
    ...(corner === "nw" ? { left: -11, top: -11 } : {}),
    ...(corner === "ne" ? { right: -11, top: -11 } : {}),
    ...(corner === "sw" ? { left: -11, bottom: -11 } : {}),
    ...(corner === "se" ? { right: -11, bottom: -11 } : {}),
    pointerEvents: "auto",
    touchAction: "none"
  });

  return (
    <div data-sig-jump={m.highlight !== false ? "true" : undefined}
      title={m.label || undefined}
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
      touchAction: interactive ? "none" : undefined,
      boxShadow: highlight ? "0 0 0 2px rgba(184,137,74,.35)" : "none",
      overflow: "hidden"
    }}
      onPointerDown={interactive ? (e) => startDrag(e, "move") : undefined}>
      {isSigned ? (
        <img src={m.signedDataUrl} alt="signature" style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} />
      ) : (
        // Clipped cleanly when the name is longer than the standard box —
        // hovering the box shows the full label via the title tooltip.
        <span style={{ padding: "2px 4px", backgroundColor: "rgba(255,255,255,.85)", borderRadius: 3, lineHeight: 1.1, textAlign: "center", pointerEvents: "none", maxWidth: "96%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {m.label || "SIGN HERE"}
        </span>
      )}
      {interactive && sizing && mm && (
        <div style={{ position: "absolute", top: -24, left: 0, whiteSpace: "nowrap", fontSize: 10,
          padding: "2px 6px", borderRadius: 4, backgroundColor: "#0F1A2E", color: "#F5F1E8", pointerEvents: "none" }}>
          {mm.w.toFixed(0)} × {mm.h.toFixed(0)} mm
        </div>
      )}
      {interactive && (
        <>
          <div style={handleStyle("nw")} onPointerDown={(e) => startDrag(e, "nw")} />
          <div style={handleStyle("ne")} onPointerDown={(e) => startDrag(e, "ne")} />
          <div style={handleStyle("sw")} onPointerDown={(e) => startDrag(e, "sw")} />
          <div style={handleStyle("se")} onPointerDown={(e) => startDrag(e, "se")} />
          {onDelete && (
            <button onPointerDown={(e) => { e.stopPropagation(); }} onClick={(e) => { e.stopPropagation(); onDelete(); }}
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
  const [armed, setArmed] = useState(false);
  const pageRef = useRef(null);
  const longPressRef = useRef(null);
  const isTouch = typeof window !== "undefined" &&
    (("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0);

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

  const xyFrom = (e) => {
    const r = pageRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
  };
  // Commit a signature box from a start + current point (sheet %). Shared by
  // mouse-drag, armed tap, and touch long-press.
  const commitBox = (sx, sy, cx, cy) => {
    // Always the standard medium field — uniform with the PDF path; the box
    // remains resizable afterwards.
    const w = 22, h = 6;
    let x = (sx + cx) / 2 - w / 2;
    let y = (sy + cy) / 2 - h / 2;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    onAddMarker(1, x, y, w, h);
    setArmed(false);
  };
  const clearLongPress = () => {
    if (longPressRef.current?.timer) clearTimeout(longPressRef.current.timer);
    longPressRef.current = null;
  };
  const onDown = (e) => {
    if (!editable || !onAddMarker) return;
    const { x, y } = xyFrom(e);
    // Mouse / stylus, or an explicitly armed touch → draw immediately.
    if (e.pointerType !== "touch" || armed) { setDrawing({ sx: x, sy: y, x, y }); return; }
    // Bare touch: one-finger drag scrolls; only a press-and-hold drops a box.
    clearLongPress();
    const timer = setTimeout(() => {
      longPressRef.current = null;
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch { /* ignore */ } }
      commitBox(x, y, x, y);
    }, LONGPRESS_MS);
    longPressRef.current = { timer, cx: e.clientX, cy: e.clientY };
  };
  const onMove = (e) => {
    if (longPressRef.current) {
      const dx = Math.abs(e.clientX - longPressRef.current.cx);
      const dy = Math.abs(e.clientY - longPressRef.current.cy);
      if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) clearLongPress();
    }
    if (!drawing) return;
    const { x, y } = xyFrom(e);
    setDrawing({ ...drawing, x, y });
  };
  const onUp = () => {
    clearLongPress();
    if (!drawing) return;
    commitBox(drawing.sx, drawing.sy, drawing.x, drawing.y);
    setDrawing(null);
  };
  const onCancel = () => { clearLongPress(); setDrawing(null); };

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
           onPointerDown={editable ? onDown : undefined} onPointerMove={editable ? onMove : undefined}
           onPointerUp={editable ? onUp : undefined} onPointerLeave={editable ? onCancel : undefined} onPointerCancel={editable ? onCancel : undefined}
           style={{ position: "relative", minHeight: 400, ...(fill ? {} : { maxHeight: 720, overflow: "auto" }), cursor: editable ? "crosshair" : "default", backgroundColor: "#fff", touchAction: editable ? (armed ? "none" : "manipulation") : undefined }}>
        <style>{`
          .xlsx-grid { border-collapse: collapse; font-family: Calibri, Arial, sans-serif; font-size: 10pt; table-layout: fixed; width: 100%; }
          .xlsx-grid td { padding: 3px 6px; white-space: pre-wrap; overflow: hidden; word-break: break-word; ${hasStyles ? "" : "border: 1px solid rgba(15,26,46,.15); max-width: 260px;"} }
          .xlsx-grid td.cell-editable { cursor: text; }
          .xlsx-grid td.cell-editable:hover { background: rgba(184,137,74,.08); }
          .xlsx-grid td.cell-editable:focus { outline: 2px solid #B8894A; outline-offset: -2px; background: #FFFDF5; }
          .xlsx-grid td.cell-locked { cursor: default; background: rgba(15,26,46,.03); color: rgba(15,26,46,.55); font-style: italic; }
        `}</style>
        <div style={{ padding: "12px 16px", width: hasStyles ? undefined : "max-content", minWidth: "100%" }}>
          {/* Uploaded (unstyled) sheets take their natural width so wide sheets stay
              readable and scroll horizontally inside this viewer, instead of being
              crushed to fit. Styled templates keep their fixed 100% layout. */}
          <table className="xlsx-grid" style={hasStyles ? undefined : { tableLayout: "auto", width: "auto", minWidth: "100%" }}>
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
      {editable && (
        <div className="px-4 py-3 border-t flex items-center gap-3 flex-wrap" style={{ borderColor: "rgba(15,26,46,.08)" }}>
          {armed ? (
            <>
              <span className="inline-flex items-center gap-2 text-xs font-medium" style={{ color: "#B8894A" }}>
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: "#B8894A" }} />
                Tap the sheet where the signature should go
              </span>
              <button type="button" className="btn-ghost text-xs" onClick={() => setArmed(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button type="button" className="btn-primary text-xs" onClick={() => setArmed(true)}>+ Add signature box</button>
              <span className="text-xs opacity-55">
                {isTouch
                  ? "Tap “Add signature box”, then tap the sheet — or press and hold the sheet. Scroll freely with one finger."
                  : "Click “Add signature box” then click the sheet, or click-drag to size it."}
              </span>
            </>
          )}
        </div>
      )}
      {cellEditable && <div className="text-xs opacity-60 px-4 py-2 border-t" style={{ borderColor: "rgba(15,26,46,.08)" }}>Click any cell to edit its value.</div>}
    </div>
  );
}

// Default export = both renderers as named members
export default { DocPreview, XlsxViewer };
