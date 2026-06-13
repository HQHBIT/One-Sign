// ============================================================
//   PASSWORD RESET MODAL — admin choice between custom + auto
//   ------------------------------------------------------------
//   Opened from AdminUsers when the admin clicks the Reset Password
//   button on a row. Lets the admin EITHER type a specific password
//   OR leave the field blank for a server-generated random one.
//   The submit handler is async and supplied by the parent.
// ============================================================
import { useState } from "react";
import { X, Check, RefreshCw, Eye as EyeIcon, EyeOff } from "lucide-react";
import { useEscapeKey } from "../lib/useBackHandler.js";
import { useFocusTrap } from "../lib/useFocusTrap.js";

export function PasswordResetModal({ user, onCancel, onSubmit }) {
  const [pwd, setPwd] = useState("");
  const [showPwd, setShowPwd] = useState(true); // show by default — admin wants to verify what they typed
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEscapeKey(true, onCancel);
  const trapRef = useFocusTrap(true);

  const customLooksGood = !pwd || pwd.length >= 6;
  const willGenerate = !pwd.trim();

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!customLooksGood) return;
    setErr(null);
    setBusy(true);
    try {
      await onSubmit(pwd.trim() || null);
    } catch (e) {
      setErr(e.message || "Could not reset password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(15,26,46,.65)" }} onClick={onCancel}>
      <div ref={trapRef} className="card p-6 w-full max-w-md anim-in" style={{ backgroundColor: "var(--c-cream)" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-[10px] tracking-widest uppercase opacity-50">Reset password</div>
            <div className="font-display text-xl mt-1">{user.name}</div>
            <div className="text-xs opacity-60 font-mono">{user.email}</div>
          </div>
          <button onClick={onCancel} className="btn-ghost text-xs"><X size={14} /></button>
        </div>

        <form onSubmit={submit}>
          <label className="text-xs tracking-wider uppercase opacity-70 block mb-1">New password</label>
          <div style={{ position: "relative" }}>
            <input className="w-full"
              autoFocus
              type={showPwd ? "text" : "password"}
              value={pwd}
              onChange={e => setPwd(e.target.value)}
              placeholder="Leave blank to auto-generate"
              style={{ paddingRight: 76 }} />
            <div style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", display: "flex", gap: 4 }}>
              <button type="button" onClick={() => setShowPwd(s => !s)}
                title={showPwd ? "Hide" : "Reveal"}
                style={{ background: "transparent", border: "none", cursor: "pointer", padding: 6, opacity: 0.6, display: "flex", alignItems: "center" }}>
                {showPwd ? <EyeOff size={15} /> : <EyeIcon size={15} />}
              </button>
              <button type="button" onClick={() => { setPwd(""); }}
                title="Use server-generated random password"
                style={{ background: "transparent", border: "none", cursor: "pointer", padding: 6, opacity: 0.6, display: "flex", alignItems: "center" }}>
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          <div className="text-xs opacity-60 mt-2 leading-relaxed">
            {willGenerate
              ? <>Empty field → server generates a secure random password and emails it.</>
              : customLooksGood
                ? <>Custom password — will be set as-is and emailed to the user.</>
                : <span style={{ color: "var(--c-rust)" }}>Password must be at least 6 characters.</span>}
          </div>

          {err && (
            <div className="text-xs px-3 py-2 rounded mt-3"
              style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>
              {err}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-5">
            <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy || !customLooksGood}>
              <Check size={13} /> {busy ? "Resetting…" : (willGenerate ? "Generate & email" : "Set & email")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
