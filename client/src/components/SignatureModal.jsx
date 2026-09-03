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
import { RefreshCw, LogOut, Check, X, Star, Trash2, Upload } from "lucide-react";
import { api } from "../api.js";
import { useEscapeKey } from "../lib/useBackHandler.js";
import { useFocusTrap } from "../lib/useFocusTrap.js";

// ------------------------------------------------------------
// The user's saved signatures: thumbnail, name tag, default star, delete.
// Shown in manage mode only — first-login and admin capture stay single-shot.
// ------------------------------------------------------------
function SignatureList({ sigs, thumbs, busy, onDefault, onDelete, onRestore, armedId }) {
  if (!sigs.length) return null;
  return (
    <div className="mb-4">
      <div className="text-[10px] tracking-widest uppercase opacity-50 mb-2">Your signatures ({sigs.length}/5)</div>
      <div className="space-y-2">
        {sigs.map(s => (
          <div key={s.id} className="card p-2 flex items-center gap-3" style={{ backgroundColor: "var(--c-paper)" }}>
            <div className="flex items-center justify-center shrink-0" style={{ width: 96, height: 40 }}>
              {thumbs[s.id]
                ? <img src={thumbs[s.id]} alt={s.label} style={{ maxWidth: 96, maxHeight: 40, objectFit: "contain" }} />
                : <span className="text-xs opacity-40">…</span>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{s.label}</div>
              {s.isDefault && <div className="text-[10px] tracking-wider uppercase" style={{ color: "#8B6914" }}>Default</div>}
              {/* We removed this signature's paper background without being asked,
                  so say so plainly and keep the way back one click away. */}
              {s.canRestoreOriginal && (
                <div className="text-[10px] opacity-60 mt-0.5">
                  Background removed
                  <button className="underline ml-1.5" disabled={busy} onClick={() => onRestore?.(s)}
                    title="Put the original image back, paper and all">undo</button>
                </div>
              )}
            </div>
            {!s.isDefault && (
              <button className="btn-ghost text-xs" disabled={busy} onClick={() => onDefault(s)}
                title="Used when you don't pick one at signing time">
                <Star size={12} /> Make default
              </button>
            )}
            <button className={`text-xs ${armedId === s.id ? "btn-danger" : "btn-ghost"}`} disabled={busy}
              onClick={() => onDelete(s)} title="Delete this signature">
              <Trash2 size={12} />{armedId === s.id ? " Sure?" : ""}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

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

export function SignatureModal({ title, subtitle, onCancel, onSave, onLogout, currentUserId, manage = false, onChanged }) {
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

  // ---- manage mode: the user's saved set, plus the tag for the next one ----
  const [sigs, setSigs] = useState([]);
  const [thumbs, setThumbs] = useState({});
  const [tag, setTag] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const loadSigs = async () => {
    try {
      const list = await api.mySignatures();
      setSigs(list);
      const t = {};
      for (const s of list) t[s.id] = await api.mySignatureBlob(s.id);
      setThumbs(prev => { Object.values(prev).forEach(u => u && URL.revokeObjectURL(u)); return t; });
    } catch { /* list stays empty */ }
  };
  useEffect(() => {
    if (manage) loadSigs();
    return () => setThumbs(prev => { Object.values(prev).forEach(u => u && URL.revokeObjectURL(u)); return {}; });
  }, [manage]);

  // Fetch the current signature image, if any, so the user can see what's stored.
  // (Manage mode shows the full list instead.)
  useEffect(() => {
    if (!currentUserId || manage) return;
    let url = null;
    (async () => {
      try {
        url = await api.getSignatureBlob(currentUserId);
        setCurrentSigUrl(url);
      } catch { /* ignore */ }
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [currentUserId, manage]);

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

  // Trimmed dataUrl from whichever mode is active, delivered to `deliver`.
  const produceDataUrl = (deliver) => {
    if (mode === "draw") {
      if (empty) return;
      const trimmed = trimSignatureCanvas(canvasRef.current);
      deliver((trimmed || canvasRef.current).toDataURL("image/png"));
    } else {
      if (!uploaded) return;
      // For uploaded files, trim transparent / near-white edges so the signature
      // fills the marker box without surrounding whitespace. Drawing to a canvas
      // also normalises the format: whatever the phone produced leaves here as
      // PNG, which is the only reason a wide `accept` is safe.
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        const trimmed = trimSignatureCanvas(c);
        deliver((trimmed || c).toDataURL("image/png"));
      };
      // A format this browser cannot decode — HEIC from an iPhone opened in
      // Chrome is the common one. Sending the original bytes anyway guaranteed a
      // rejection from the server, which accepts only png and jpeg, and the user
      // saw a save that silently did nothing. Say what happened instead.
      img.onerror = () => setErr(
        "This image could not be read on this device. Photos from an iPhone are often HEIC — " +
        "save or export it as PNG or JPG and try again, or use the Draw tab.");
      img.src = uploaded;
    }
  };

  // onSave talks to the server, so it can fail. Unwrapped, a rejection went
  // nowhere: the modal stayed open, nothing appeared, and the user pressed Save
  // again. This is the path a brand-new user takes, and it is the one path where
  // there is no way out of the modal to go and look for the problem.
  const save = () => produceDataUrl(async (dataUrl) => {
    setBusy(true); setErr("");
    try { await onSave(dataUrl); }
    catch (e) { setErr(e.message || "Could not save the signature"); }
    finally { setBusy(false); }
  });

  // Manage mode: adding stays in the modal so several can be added in one sitting.
  const addToSet = () => produceDataUrl(async (dataUrl) => {
    const label = tag.trim() || (sigs.length === 0 ? "My signature" : "");
    if (!label) { setErr("Give this signature a name tag first"); return; }
    setBusy(true); setErr("");
    try {
      await api.addMySignature({ dataUrl, label });
      setTag(""); setUploaded(null); clear();
      await loadSigs();
      onChanged?.();
    } catch (e) { setErr(e.message || "Could not save the signature"); }
    finally { setBusy(false); }
  });

  const makeDefault = async (s) => {
    setBusy(true); setErr("");
    try { await api.setDefaultSignature(s.id); await loadSigs(); onChanged?.(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  const restoreOriginal = async (s) => {
    setBusy(true); setErr("");
    try { await api.restoreSignatureOriginal(s.id); await loadSigs(); onChanged?.(); }
    catch (e) { setErr(e.message || "Could not restore the original"); }
    finally { setBusy(false); }
  };
  const [armedDelete, setArmedDelete] = useState(null);
  const removeSig = async (s) => {
    if (armedDelete !== s.id) { setArmedDelete(s.id); setTimeout(() => setArmedDelete(null), 2500); return; }
    setBusy(true); setErr(""); setArmedDelete(null);
    try { await api.deleteMySignature(s.id); await loadSigs(); onChanged?.(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
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

        {manage && <SignatureList sigs={sigs} thumbs={thumbs} busy={busy} onDefault={makeDefault} onDelete={removeSig} onRestore={restoreOriginal} armedId={armedDelete} />}
        {/* Shown in EVERY mode, not only when managing a set. A first-time user
            cannot dismiss this modal — it is the gate onto the app — so a failure
            they cannot see leaves them stuck with a Save button that appears to
            do nothing. That was the state new users were reporting. */}
        {err && (
          <div className="text-xs mb-3 px-3 py-2 rounded" style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>{err}</div>
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
            {/* A styled link instead of the browser's bare "Choose File" control. */}
            <label className="inline-flex items-center gap-1.5 cursor-pointer text-sm font-medium underline underline-offset-2"
              style={{ color: "#8B6914" }}>
              <Upload size={14} /> {uploaded ? "Choose a different image…" : "Choose an image from this device…"}
              {/* Any image the device will offer. Restricting this to png/jpeg
                  greyed out the photo a new user had just taken of their
                  signature — an iPhone writes HEIC — so the Upload tab looked
                  broken rather than picky. The canvas above re-encodes whatever
                  is chosen to PNG, and a format this browser cannot decode is
                  reported rather than sent. */}
              <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
            </label>
            <div className="text-xs opacity-50 mt-1">PNG or JPEG — it will be auto-cropped to the signature.</div>

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
          <div className="flex flex-wrap items-center gap-2 justify-end">
            {onCancel && <button className="btn-ghost" onClick={onCancel}>{manage ? "Done" : "Cancel"}</button>}
            {manage ? (
              <>
                <input type="text" value={tag} onChange={e => { setTag(e.target.value); setErr(""); }}
                  placeholder={sigs.length === 0 ? "Name tag (e.g. Official)" : "Name tag — required"}
                  maxLength={60} className="text-sm" style={{ width: 190 }} />
                <button className="btn-primary" onClick={addToSet}
                  disabled={busy || sigs.length >= 5 || (mode === "draw" ? empty : !uploaded)}
                  title={sigs.length >= 5 ? "You can keep up to 5 signatures — delete one first" : "Save the drawing above under this name"}>
                  <Check size={14} /> {busy ? "Saving…" : "Add signature"}
                </button>
              </>
            ) : (
              <button className="btn-primary" onClick={save} disabled={mode === "draw" ? empty : !uploaded}>
                <Check size={14} /> Save signature
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
