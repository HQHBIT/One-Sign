// ============================================================
//   Confidential unlock — the one-time code prompt.
//   ------------------------------------------------------------
//   A confidential document is served only after its viewer enters the code
//   emailed to them. Once unlocked it stays open — the timed re-lock was
//   removed at the owner's request (2026-08-12).
// ============================================================
import { useState, useEffect, useRef } from "react";
import { Lock, ShieldCheck, X } from "lucide-react";
import { api } from "../api.js";

// Both drawers close when their backdrop is clicked, and this modal mounts
// INSIDE that backdrop — so every click here must stop propagating, or tapping
// the code input bubbles up and closes the whole drawer under the user.
const trapClicks = (e) => e.stopPropagation();

/**
 * Asks for the emailed code and tells the parent once it verifies.
 *   onUnlocked() — the document may now be loaded
 *   onCancel()  — the viewer backed out
 */
export function UnlockModal({ requestId, onUnlocked, onCancel }) {
  const [stage, setStage] = useState("sending");   // sending | enter | verifying
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const inputRef = useRef(null);
  const asked = useRef(false);

  const send = async () => {
    setStage("sending"); setErr(""); setCode("");
    try {
      const r = await api.requestUnlockCode(requestId);
      setSentTo(r.to || "your registered address");
      setStage("enter");
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (e) {
      setErr(e.message || "Could not send a code");
      setStage("enter");
    }
  };

  // React 18 StrictMode double-invokes effects in dev; guard so the user isn't
  // sent two codes (and burn two of their five allowed sends).
  useEffect(() => { if (!asked.current) { asked.current = true; send(); } }, [requestId]);

  const verify = async (e) => {
    e?.preventDefault();
    if (!/^\d{6}$/.test(code)) { setErr("Enter the 6-digit code"); return; }
    setStage("verifying"); setErr("");
    try {
      await api.verifyUnlockCode(requestId, code);
      onUnlocked();
    } catch (e2) {
      setErr(e2.message || "Incorrect code");
      setCode("");
      setStage("enter");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,26,46,.55)" }} onClick={trapClicks}>
      <div className="card p-6 w-full max-w-sm" style={{ backgroundColor: "var(--c-cream)" }}>
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2">
            <Lock size={16} style={{ color: "var(--c-gold)" }} />
            <h3 className="font-display text-lg">Confidential document</h3>
          </div>
          <button className="btn-ghost !p-1" onClick={onCancel} aria-label="Cancel"><X size={14} /></button>
        </div>

        {stage === "sending" ? (
          <p className="text-sm opacity-70 mt-3">Sending you a one-time code…</p>
        ) : (
          <form onSubmit={verify}>
            <p className="text-sm opacity-70 mt-2 mb-4">
              A 6-digit code has been sent to <strong>{sentTo}</strong>. Enter it to open the document.
            </p>
            <input
              ref={inputRef} value={code} inputMode="numeric" autoComplete="one-time-code"
              maxLength={6} placeholder="000000"
              onChange={e => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setErr(""); }}
              className="w-full text-center font-mono"
              style={{ fontSize: 24, letterSpacing: "0.4em" }}
            />
            {err && (
              <div className="text-xs mt-2 px-3 py-2 rounded" style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>
                {err}
              </div>
            )}
            <div className="flex items-center gap-2 mt-4">
              <button type="submit" className="btn-primary flex-1 justify-center" disabled={stage === "verifying" || code.length < 6}>
                <ShieldCheck size={14} /> {stage === "verifying" ? "Checking…" : "Unlock"}
              </button>
              <button type="button" className="btn-ghost text-xs" onClick={send} disabled={stage === "verifying"}>
                Resend
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * The word "Confidential" wherever the request appears — rows and drawer
 * headers. Replaced the diagonal on-document watermark at the owner's request
 * (2026-08-10): the label moved off the document and onto the request.
 */
export function ConfidentialBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full shrink-0 text-[10px] font-semibold tracking-wider uppercase"
      style={{ backgroundColor: "rgba(184,137,74,.16)", color: "#8B6914" }}
      title="Confidential — encrypted, and a one-time code is needed to open it">
      <Lock size={10} /> Confidential
    </span>
  );
}
