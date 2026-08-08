// ============================================================
//   Confidential unlock — the code prompt and the 60-second countdown.
//   ------------------------------------------------------------
//   A confidential document is only served while the viewer holds a live
//   window. This asks for the emailed code, then counts the window down and
//   tells the parent when it lapses so the document can be blanked.
// ============================================================
import { useState, useEffect, useRef } from "react";
import { Lock, ShieldCheck, X } from "lucide-react";
import { api } from "../api.js";

// mm:ss for the remaining window.
const clock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Asks for the code and reports the granted window upward.
 *   onUnlocked(windowEndsAt) — the document may now be loaded
 *   onCancel()               — the viewer backed out
 */
export function UnlockModal({ requestId, onUnlocked, onCancel, notify }) {
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
      const r = await api.verifyUnlockCode(requestId, code);
      onUnlocked(r.windowEndsAt);
    } catch (e2) {
      setErr(e2.message || "Incorrect code");
      setCode("");
      setStage("enter");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,26,46,.55)" }}>
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
              A 6-digit code has been sent to <strong>{sentTo}</strong>. The document stays open for
              {" "}<strong>60 seconds</strong> once unlocked.
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

/** The live countdown pill. Calls onExpire once the window lapses. */
export function UnlockCountdown({ endsAt, onExpire }) {
  const [left, setLeft] = useState(() => endsAt - Date.now());
  const fired = useRef(false);
  useEffect(() => {
    fired.current = false;
    const t = setInterval(() => {
      const ms = endsAt - Date.now();
      setLeft(ms);
      if (ms <= 0 && !fired.current) { fired.current = true; onExpire?.(); }
    }, 250);
    return () => clearInterval(t);
  }, [endsAt, onExpire]);

  const urgent = left <= 15000;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono"
      style={{
        backgroundColor: urgent ? "rgba(155,44,44,.12)" : "rgba(184,137,74,.14)",
        color: urgent ? "var(--c-rust-deep)" : "var(--c-gold-deep, #8B6914)",
      }}
      title="This confidential document locks again when the timer runs out">
      <Lock size={11} /> {clock(left)}
    </span>
  );
}

/** Diagonal watermark naming the viewer — deters and attributes screen capture. */
export function ConfidentialWatermark({ name }) {
  const stamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  const text = `CONFIDENTIAL · ${name} · ${stamp}`;
  return (
    <div aria-hidden="true" style={{
      position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5,
      overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        transform: "rotate(-28deg)", whiteSpace: "nowrap", opacity: 0.13,
        fontSize: "clamp(11px, 1.6vw, 17px)", fontWeight: 700, letterSpacing: ".14em",
        color: "var(--c-ink)", lineHeight: 2.6, textAlign: "center",
      }}>
        {Array.from({ length: 9 }, (_, i) => <div key={i}>{text}&nbsp;&nbsp;·&nbsp;&nbsp;{text}</div>)}
      </div>
    </div>
  );
}
