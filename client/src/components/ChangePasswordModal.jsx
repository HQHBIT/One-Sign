// ============================================================
//   CHANGE PASSWORD MODAL — self-service for any signed-in user
//   ------------------------------------------------------------
//   Requires the current password before allowing the new one to
//   be set. Server verifies the current password and returns 401
//   "Current password is incorrect" if wrong — we surface that
//   inline rather than as a generic toast.
// ============================================================
import { useState } from "react";
import { X, Check, Eye as EyeIcon, EyeOff } from "lucide-react";
import { api } from "../api.js";
import { useEscapeKey } from "../lib/useBackHandler.js";
import { useFocusTrap } from "../lib/useFocusTrap.js";

export function ChangePasswordModal({ onClose, notify }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEscapeKey(true, onClose);
  const trapRef = useFocusTrap(true);

  const tooShort = next.length > 0 && next.length < 6;
  const mismatch = confirmPwd.length > 0 && confirmPwd !== next;
  const canSubmit = cur.length > 0 && next.length >= 6 && next === confirmPwd;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    setErr(null);
    setBusy(true);
    try {
      await api.changePassword(cur, next);
      notify?.("Password changed", "success");
      onClose();
    } catch (e) {
      setErr(e.message || "Could not change password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(15,26,46,.65)" }} onClick={onClose}>
      <div ref={trapRef} className="card p-6 w-full max-w-md anim-in" style={{ backgroundColor: "var(--c-cream)" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-[10px] tracking-widest uppercase opacity-50">Account</div>
            <div className="font-display text-xl mt-1">Change your password</div>
          </div>
          <button onClick={onClose} className="btn-ghost text-xs"><X size={14} /></button>
        </div>

        <form onSubmit={submit} autoComplete="off">
          {/* Honeypot to absorb browser autofill on the wrong field */}
          <input type="text" name="username" autoComplete="username" style={{ display: "none" }} tabIndex={-1} aria-hidden="true" />

          <label className="text-xs tracking-wider uppercase opacity-70 block mb-1">Current password</label>
          <input className="w-full mb-4"
            autoFocus
            type="password"
            name="current-pwd"
            autoComplete="current-password"
            value={cur}
            onChange={e => setCur(e.target.value)}
            required />

          <label className="text-xs tracking-wider uppercase opacity-70 block mb-1">New password</label>
          <div style={{ position: "relative" }} className="mb-4">
            <input className="w-full"
              type={showNew ? "text" : "password"}
              name="new-pwd"
              autoComplete="new-password"
              value={next}
              onChange={e => setNext(e.target.value)}
              placeholder="At least 6 characters"
              style={{ paddingRight: 40 }}
              required />
            <button type="button" onClick={() => setShowNew(s => !s)}
              title={showNew ? "Hide" : "Reveal"}
              style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", cursor: "pointer", padding: 4, opacity: 0.6, display: "flex", alignItems: "center" }}>
              {showNew ? <EyeOff size={15} /> : <EyeIcon size={15} />}
            </button>
          </div>

          <label className="text-xs tracking-wider uppercase opacity-70 block mb-1">Confirm new password</label>
          <input className="w-full mb-2"
            type={showNew ? "text" : "password"}
            name="confirm-pwd"
            autoComplete="new-password"
            value={confirmPwd}
            onChange={e => setConfirmPwd(e.target.value)}
            required />

          {tooShort && <div className="text-xs mt-1" style={{ color: "var(--c-rust)" }}>New password must be at least 6 characters.</div>}
          {mismatch && <div className="text-xs mt-1" style={{ color: "var(--c-rust)" }}>The two new passwords don't match.</div>}

          {err && (
            <div className="text-xs px-3 py-2 rounded mt-3"
              style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>
              {err}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-5">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={!canSubmit || busy}>
              <Check size={13} /> {busy ? "Changing…" : "Change password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
