// ============================================================
//   SIGNATURE CAPTURE (canvas + image upload)
//   ------------------------------------------------------------
//   Used on first-login (required for requestors / approvers),
//   and from the admin Signatures tab for replacing on behalf of
//   any user. Draws into a high-DPR canvas, trims transparent /
//   near-white margins on save, and supports image upload as a
//   second mode.
// ============================================================
import { useState, useEffect, useRef } from "react";
import { RefreshCw, LogOut, Check, X } from "lucide-react";
import { api } from "../api.js";
import { useEscapeKey } from "../lib/useBackHandler.js";
import { useFocusTrap } from "../lib/useFocusTrap.js";

/**
 * Returns a new canvas tightly cropped to the signature's actual content,
 * with a small padding. Treats transparent and near-white pixels as background.
 * Returns null if the canvas is empty.
 */
function trimSignatureCanvas(srcCanvas) {
  const w = srcCanvas.width, h = srcCanvas.height;
  if (w === 0 || h === 0) return null;
  const ctx = srcCanvas.getContext("2d");
  let data;
  try { data = ctx.getImageData(0, 0, w, h).data; }
  catch { return null; } // cross-origin tainted canvas — skip trim
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      // Background = fully transparent OR near-white opaque
      const isBg = a < 16 || (r > 240 && g > 240 && b > 240);
      if (!isBg) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  // Small padding so the strokes don't kiss the edge
  const pad = Math.max(2, Math.round(Math.min(w, h) * 0.01));
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = cropW; out.height = cropH;
  out.getContext("2d").drawImage(srcCanvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
  return out;
}

export function SignatureModal({ title, subtitle, onCancel, onSave, onLogout, currentUserId }) {
  useEscapeKey(!!onCancel, onCancel);
  const trapRef = useFocusTrap(true);
  const canvasRef = useRef(null);
  const [mode, setMode] = useState("draw"); // draw | upload
  const [uploaded, setUploaded] = useState(null);
  const [empty, setEmpty] = useState(true);
  const drawingRef = useRef(false);
  const pointsRef = useRef([]);
  const lastVelRef = useRef(0);
  const lastWidthRef = useRef(2.0);
  const [currentSigUrl, setCurrentSigUrl] = useState(null);

  // Fetch the current signature image, if any, so the user can see what's stored.
  useEffect(() => {
    if (!currentUserId) return;
    let url = null;
    (async () => {
      try {
        url = await api.getSignatureBlob(currentUserId);
        setCurrentSigUrl(url);
      } catch { /* ignore */ }
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [currentUserId]);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const r = c.getBoundingClientRect();
    c.width = r.width * 3; c.height = r.height * 3;
    c.getContext("2d").scale(3, 3);
  }, [mode]);

  const pos = e => {
    const r = canvasRef.current.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top, t: Date.now() };
  };

  const start = e => {
    if (e.touches) e.preventDefault();
    drawingRef.current = true;
    const p = pos(e);
    pointsRef.current = [p];
    lastVelRef.current = 0;
    lastWidthRef.current = 2.0;
    const ctx = canvasRef.current.getContext("2d");
    ctx.fillStyle = "#0F1A2E";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
    ctx.fill();
    setEmpty(false);
  };

  const move = e => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const p = pos(e);
    const pts = pointsRef.current;
    const prev = pts[pts.length - 1];
    const dx = p.x - prev.x, dy = p.y - prev.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1.5) return;
    const dt = Math.max(1, p.t - prev.t);
    const vel = (dist / dt) * 1000;
    const sVel = lastVelRef.current * 0.4 + vel * 0.6;
    lastVelRef.current = sVel;
    const frac = Math.min(sVel / 800, 1);
    const rawW = 3.2 - 2.6 * frac;
    const w = lastWidthRef.current * 0.55 + rawW * 0.45;
    lastWidthRef.current = w;
    pts.push(p);
    const ctx = canvasRef.current.getContext("2d");
    ctx.strokeStyle = "#0F1A2E";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = w;
    if (pts.length >= 3) {
      const a = pts[pts.length - 3], b = pts[pts.length - 2];
      ctx.beginPath();
      ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.quadraticCurveTo(b.x, b.y, (b.x + p.x) / 2, (b.y + p.y) / 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    setEmpty(false);
  };

  const end = () => {
    if (drawingRef.current && pointsRef.current.length >= 2) {
      const pts = pointsRef.current;
      const last = pts[pts.length - 1], prev = pts[pts.length - 2];
      const ctx = canvasRef.current.getContext("2d");
      ctx.strokeStyle = "#0F1A2E";
      ctx.lineCap = "round";
      ctx.lineWidth = lastWidthRef.current;
      ctx.beginPath();
      ctx.moveTo((prev.x + last.x) / 2, (prev.y + last.y) / 2);
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
    drawingRef.current = false;
    pointsRef.current = [];
  };

  const clear = () => {
    const c = canvasRef.current;
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    lastWidthRef.current = 2.0;
    lastVelRef.current = 0;
  };

  const handleUpload = e => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => setUploaded(r.result); r.readAsDataURL(f);
  };

  const save = () => {
    if (mode === "draw") {
      if (empty) return;
      const trimmed = trimSignatureCanvas(canvasRef.current);
      onSave((trimmed || canvasRef.current).toDataURL("image/png"));
    } else {
      if (!uploaded) return;
      // For uploaded files, trim transparent / near-white edges so the signature fills
      // the marker box without surrounding whitespace.
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        const trimmed = trimSignatureCanvas(c);
        onSave((trimmed || c).toDataURL("image/png"));
      };
      img.onerror = () => onSave(uploaded);
      img.src = uploaded;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(15,26,46,.65)" }}>
      <div ref={trapRef} className="card p-6 max-w-lg w-full" style={{ backgroundColor: "var(--c-cream)" }}>
        <div className="flex items-center justify-between mb-2">
          <div className="font-display text-2xl">{title}</div>
          {onCancel && <button onClick={onCancel} className="btn-ghost text-xs"><X size={14} /></button>}
        </div>
        {subtitle && <div className="text-sm opacity-60 mb-4">{subtitle}</div>}

        {currentSigUrl && (
          <div className="mb-4">
            <div className="text-[10px] tracking-widest uppercase opacity-50 mb-2">Current signature on file</div>
            <div className="card p-3 flex items-center justify-center" style={{ backgroundColor: "var(--c-paper)", minHeight: 90 }}>
              <img src={currentSigUrl} alt="Current signature" style={{ maxHeight: 110, maxWidth: "100%", objectFit: "contain", display: "block" }} />
            </div>
            <div className="text-xs opacity-60 mt-2">Draw or upload below to replace it. The new version is auto-cropped to its content.</div>
          </div>
        )}

        <div className="flex gap-2 mb-4 text-xs">
          <button onClick={() => setMode("draw")} className={`px-3 py-1.5 rounded-md ${mode === "draw" ? "btn-primary" : "btn-ghost"}`}>Draw</button>
          <button onClick={() => setMode("upload")} className={`px-3 py-1.5 rounded-md ${mode === "upload" ? "btn-primary" : "btn-ghost"}`}>Upload image</button>
        </div>

        {mode === "draw" ? (
          <div>
            <canvas ref={canvasRef}
              onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
              onTouchStart={start} onTouchMove={move} onTouchEnd={end}
              className="sig-canvas w-full rounded-md border"
              style={{ borderColor: "rgba(15,26,46,.18)", height: 180 }} />
            <div className="flex justify-between items-center mt-3">
              <button className="btn-ghost text-xs" onClick={clear}><RefreshCw size={12} /> Clear</button>
              <div className="text-xs opacity-60">Sign with your mouse, stylus, or finger.</div>
            </div>
          </div>
        ) : (
          <div>
            <input type="file" accept="image/png,image/jpeg" onChange={handleUpload} className="text-sm" />
            {uploaded && (
              <div className="mt-4 card p-4" style={{ backgroundColor: "var(--c-paper)" }}>
                <img src={uploaded} alt="signature" style={{ maxHeight: 100, maxWidth: "100%", objectFit: "contain", display: "block", margin: "0 auto" }} />
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between items-center gap-2 mt-6">
          <div>
            {onLogout && (
              <button className="btn-ghost text-xs" onClick={onLogout} title="Sign out and add your signature later">
                <LogOut size={12} /> Sign out & do it later
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {onCancel && <button className="btn-ghost" onClick={onCancel}>Cancel</button>}
            <button className="btn-primary" onClick={save} disabled={mode === "draw" ? empty : !uploaded}>
              <Check size={14} /> Save signature
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
