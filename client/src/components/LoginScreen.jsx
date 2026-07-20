import { useState, useEffect } from "react";
import { ArrowRight, ArrowLeft, Check, ScanFace } from "lucide-react";
import { api } from "../api.js";
import { PasswordInput } from "./PasswordInput.jsx";
import { loginBiometric, biometricAvailableHere, biometricErrorMessage, deviceHasBiometric, forgetBiometricHere } from "../lib/biometric.js";

// DISABLED: expense feature commented out
/* Local-time YYYY-MM-DD for the date input's default value.
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
*/

export function LoginScreen({ login, onSession }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Biometric (WebAuthn) sign-in — only surfaced when this device actually has a
  // platform authenticator (Face ID / Touch ID / Windows Hello).
  const [bioAvail, setBioAvail] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [bioErr, setBioErr] = useState(null);
  // Offer the biometric button only where it'll work: the device supports it AND
  // it has been enrolled here (otherwise the user hits the "use another device" chooser).
  useEffect(() => { biometricAvailableHere().then(a => setBioAvail(a && deviceHasBiometric())).catch(() => {}); }, []);
  const signInBiometric = async () => {
    setBioBusy(true); setBioErr(null);
    try {
      const session = await loginBiometric();
      onSession?.(session);
    } catch (e) {
      // Not registered on the server → this device can't sign in biometrically.
      // Send them to oneAccess to register / sign in first, and drop the stale hint.
      if (e?.code === "not_registered") {
        forgetBiometricHere();
        setBioAvail(false);
        if (oneAccessAvailable && authCfg.oneAccessStartUrl) {
          setBioErr("Please register on oneAccess to sign in!");
          setTimeout(() => { window.location.href = authCfg.oneAccessStartUrl; }, 1400);
          return;
        }
      }
      setBioErr(biometricErrorMessage(e));
    } finally { setBioBusy(false); }
  };
  // Login options from the server: whether to offer oneAccess SSO and/or the local
  // password form. Defaults keep the local form so a config hiccup never locks out.
  const [authCfg, setAuthCfg] = useState({ oneAccessEnabled: false, localLoginEnabled: true, oneAccessStartUrl: null });
  useEffect(() => { api.authConfig().then(setAuthCfg).catch(() => {}); }, []);
  const oneAccessAvailable = authCfg.oneAccessEnabled;
  // Whether the server will accept a password login at all (kept on for the admin door).
  const localAvailable = authCfg.localLoginEnabled || !authCfg.oneAccessEnabled;
  // Admins sign in with email+password, hidden behind a link / the #superadmin (or
  // /superadmin) URL. Regular users only ever see the oneAccess button.
  const [adminMode, setAdminMode] = useState(() => {
    try { return /superadmin/i.test(window.location.pathname) || /superadmin/i.test(window.location.hash); }
    catch { return false; }
  });
  const openAdmin = () => { try { window.history.replaceState(null, "", "#superadmin"); } catch {} setAdminMode(true); };
  const closeAdmin = () => { try { window.history.replaceState(null, "", window.location.pathname + window.location.search); } catch {} setAdminMode(false); };
  // Self-service password reset (email OTP): idle → email → code → done
  const [forgotState, setForgotState] = useState("idle");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotOtp, setForgotOtp] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [forgotConfirm, setForgotConfirm] = useState("");
  const [forgotErr, setForgotErr] = useState(null);
  const [forgotNote, setForgotNote] = useState(null);

  // Self-registration removed — users are provisioned through oneAccess.

  /* DISABLED: expense feature commented out
  // Expense panel: anyone can record an expense without signing in.
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [exp, setExp] = useState({ amount: "", paidBy: "", date: todayStr(), repaymentDone: false, description: "" });
  const [expState, setExpState] = useState("form"); // form | saving | done | error
  const [expErr, setExpErr] = useState(null);

  const resetExp = () => { setExp({ amount: "", paidBy: "", date: todayStr(), repaymentDone: false, description: "" }); setExpState("form"); setExpErr(null); };
  const openExpense = () => { resetExp(); setExpenseOpen(true); };
  const closeExpense = () => { setExpenseOpen(false); resetExp(); };

  const submitExpense = async e => {
    e.preventDefault();
    const amt = Number(exp.amount);
    if (!Number.isFinite(amt) || amt <= 0 || !exp.paidBy.trim()) return;
    setExpState("saving"); setExpErr(null);
    try {
      await api.submitExpense({ amount: amt, paidBy: exp.paidBy.trim(), date: exp.date, repaymentDone: exp.repaymentDone, description: exp.description.trim() });
      setExpState("done");
    } catch (err) {
      setExpErr(err.message || "Could not save expense");
      setExpState("error");
    }
  };
  */

  const submit = async e => {
    e.preventDefault(); setBusy(true);
    await login(email, password); setBusy(false);
  };

  const openForgot = () => {
    setForgotEmail(email); // prefill from login form if they typed one
    setForgotOtp(""); setForgotNewPassword(""); setForgotConfirm("");
    setForgotErr(null); setForgotNote(null);
    setForgotState("email");
  };
  const closeForgot = () => { setForgotState("idle"); setForgotErr(null); setForgotNote(null); };

  // Step 1 — email a one-time code to the account holder.
  const sendOtp = async e => {
    e?.preventDefault?.();
    const em = forgotEmail.trim();
    if (!em) return;
    setForgotBusy(true); setForgotErr(null);
    try {
      await api.sendResetOtp(em);
      setForgotNote(`If an account exists for ${em}, a 6-digit code is on its way — valid for 10 minutes.`);
      setForgotState("code");
    } catch (err) {
      setForgotErr(err.message || "Could not send the code");
    } finally { setForgotBusy(false); }
  };

  // Step 2 — verify the code and set the new password (no admin involved).
  const verifyOtp = async e => {
    e?.preventDefault?.();
    if (!forgotOtp.trim()) { setForgotErr("Enter the code from your email"); return; }
    if (forgotNewPassword.length < 6) { setForgotErr("New password must be at least 6 characters"); return; }
    if (forgotNewPassword !== forgotConfirm) { setForgotErr("Passwords don't match"); return; }
    setForgotBusy(true); setForgotErr(null);
    try {
      await api.resetWithOtp({ email: forgotEmail.trim(), otp: forgotOtp.trim(), newPassword: forgotNewPassword });
      setForgotState("done");
    } catch (err) {
      setForgotErr(err.message || "Could not reset the password");
    } finally { setForgotBusy(false); }
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      {/* left panel */}
      <div className="ink-grad text-white relative grain flex flex-col items-center px-6 py-8 sm:px-8 sm:py-12 md:p-14 text-center" style={{ color: "var(--c-cream)" }}>
        {/* Logo + hero copy, vertically centered as a group */}
        <div className="flex-1 flex flex-col items-center justify-center gap-4 sm:gap-6 w-full">
          {/* Logo — light (cream) version sits directly on the navy panel, no box */}
          <div className="fade-up">
            <img src="/signflow-logo-light.png" alt="HQHB · SignFlow" className="w-44 sm:w-52 md:w-56 mx-auto" />
          </div>

          {/* Gold divider */}
          <div className="fade-up fade-up-d1" style={{ width: 120, height: 1, background: "linear-gradient(to right, transparent, rgba(184,137,74,.45), transparent)" }} />

          {/* Hero copy */}
          <div className="relative z-10 fade-up fade-up-d2">
            <h1 className="font-display text-3xl sm:text-4xl md:text-5xl leading-[1.1]">
              Request. Review.<br />
              <span style={{ color: "var(--c-gold)" }}>Approve. Track.</span><br />
              All in one place.
            </h1>
            <p className="mt-4 text-sm opacity-55 max-w-xs md:max-w-sm mx-auto leading-relaxed">
              Route to the right authority, capture verified digital signatures, and maintain a complete audit trail at every step.
            </p>
          </div>
        </div>

        <div className="text-[10px] opacity-30 tracking-widest uppercase fade-up fade-up-d3 pt-4">HQHB - Internal Build</div>
      </div>
      {/* right panel */}
      <div className="flex items-center justify-center p-6 sm:p-8 md:p-16">
        <div className="w-full max-w-sm">
          {forgotState === "idle" && (
            <div>
              <div className="font-display text-2xl sm:text-3xl mb-2">{adminMode ? "Admin sign in" : "Sign in"}</div>
              <div className="text-sm opacity-60 mb-8">
                {adminMode
                  ? "Administrators sign in with email and password."
                  : "Continue with your oneAccess account."}
              </div>

              {/* Regular users: oneAccess only, with a discreet admin link below. */}
              {!adminMode && oneAccessAvailable && (
                <>
                  <button type="button" className="btn-primary w-full justify-center"
                    onClick={() => { window.location.href = authCfg.oneAccessStartUrl; }}>
                    Sign in with oneAccess <ArrowRight size={16} />
                  </button>
                  {localAvailable && (
                    <div className="text-center mt-6">
                      <button type="button" onClick={openAdmin}
                        className="text-xs opacity-60 hover:opacity-100 underline">
                        Click here to login as an Admin
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* Biometric (Face ID / fingerprint) sign-in — shown on this device
                  once the user has enrolled it from their profile menu. */}
              {!adminMode && bioAvail && (
                <div className={oneAccessAvailable ? "mt-3" : ""}>
                  <button type="button" className="btn-ghost w-full justify-center" onClick={signInBiometric} disabled={bioBusy}>
                    <ScanFace size={16} /> {bioBusy ? "Waiting for your device…" : "Sign in with Face / fingerprint"}
                  </button>
                  {bioErr && <div className="text-xs mt-2 text-center" style={{ color: "var(--c-rust-deep)" }}>{bioErr}</div>}
                </div>
              )}

              {/* Admin email+password form — in admin mode, or as the sole option if
                  oneAccess isn't configured (safety fallback so no deploy is locked out). */}
              {(adminMode || !oneAccessAvailable) && localAvailable && (
                <form onSubmit={submit}>
                  <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full mb-5" required autoFocus />
                  <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Password</label>
                  <PasswordInput value={password} onChange={e => setPassword(e.target.value)} className="w-full mb-3" required />
                  <div className="flex justify-end mb-6">
                    <button type="button" onClick={openForgot}
                      className="text-xs opacity-60 hover:opacity-100 underline">
                      Forgot password?
                    </button>
                  </div>
                  <button className="btn-primary w-full justify-center" disabled={busy}>
                    {busy ? "Signing in…" : <>Continue <ArrowRight size={16} /></>}
                  </button>
                  {adminMode && oneAccessAvailable && (
                    <div className="text-center mt-6">
                      <button type="button" onClick={closeAdmin}
                        className="text-xs opacity-60 hover:opacity-100 underline inline-flex items-center gap-1">
                        <ArrowLeft size={12} /> Back to oneAccess sign-in
                      </button>
                    </div>
                  )}
                </form>
              )}
            </div>
          )}

          {/* Self-registration removed — users come through oneAccess. */}

          {/* DISABLED: expense feature commented out — submission + success panels
          {expenseOpen && expState !== "done" && (
            <form onSubmit={submitExpense}>
              <div className="font-display text-2xl sm:text-3xl mb-2">Submit an expense</div>
              <div className="text-sm opacity-60 mb-8">No sign-in needed — just record the details.</div>

              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Amount (₹)</label>
              <input type="number" min="0" step="0.01" value={exp.amount}
                onChange={e => setExp({ ...exp, amount: e.target.value })}
                className="w-full mb-5" required autoFocus />

              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Paid By</label>
              <input type="text" value={exp.paidBy}
                onChange={e => setExp({ ...exp, paidBy: e.target.value })}
                className="w-full mb-5" maxLength={191} required />

              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Date</label>
              <input type="date" value={exp.date}
                onChange={e => setExp({ ...exp, date: e.target.value })}
                className="w-full mb-5" required />

              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Description (optional)</label>
              <input type="text" value={exp.description}
                onChange={e => setExp({ ...exp, description: e.target.value })}
                className="w-full mb-5" maxLength={500} placeholder="What was this expense for?" />

              <label className="flex items-center gap-2 mb-6 text-sm cursor-pointer">
                <input type="checkbox" checked={exp.repaymentDone}
                  onChange={e => setExp({ ...exp, repaymentDone: e.target.checked })} />
                Repayment done
              </label>

              {expErr && (
                <div className="text-xs px-3 py-2 rounded mb-4"
                  style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>
                  {expErr}
                </div>
              )}

              <div className="flex gap-2">
                <button type="button" className="btn-ghost" onClick={closeExpense}>
                  <ArrowLeft size={14} /> Back
                </button>
                <button className="btn-primary flex-1 justify-center"
                  disabled={expState === "saving" || !exp.paidBy.trim() || !(Number(exp.amount) > 0)}>
                  {expState === "saving" ? "Saving…" : <>Record expense <ArrowRight size={14} /></>}
                </button>
              </div>
            </form>
          )}

          {expenseOpen && expState === "done" && (
            <div className="anim-in">
              <div className="font-display text-2xl sm:text-3xl mb-2">Recorded ✓</div>
              <div className="text-sm opacity-70 mb-6 leading-relaxed">Your expense has been saved. Thank you.</div>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={closeExpense}>
                  <ArrowLeft size={14} /> Back to sign-in
                </button>
                <button className="btn-primary flex-1 justify-center" onClick={resetExp}>
                  Submit another <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}
          */}

          {/* Step 1 — request a one-time code */}
          {forgotState === "email" && (
            <form onSubmit={sendOtp}>
              <div className="font-display text-2xl sm:text-3xl mb-2">Reset password</div>
              <div className="text-sm opacity-60 mb-8">
                Enter your email and we'll send you a one-time code to reset your password yourself.
              </div>
              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Email</label>
              <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
                className="w-full mb-5" required autoFocus disabled={forgotBusy} />
              {forgotErr && (
                <div className="text-xs px-3 py-2 rounded mb-4" style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>{forgotErr}</div>
              )}
              <div className="flex gap-2">
                <button type="button" className="btn-ghost" onClick={closeForgot}><ArrowLeft size={14} /> Back</button>
                <button className="btn-primary flex-1 justify-center" disabled={forgotBusy || !forgotEmail.trim()}>
                  {forgotBusy ? "Sending…" : <>Send code <ArrowRight size={14} /></>}
                </button>
              </div>
            </form>
          )}

          {/* Step 2 — enter the code + choose a new password */}
          {forgotState === "code" && (
            <form onSubmit={verifyOtp}>
              <div className="font-display text-2xl sm:text-3xl mb-2">Enter your code</div>
              <div className="text-sm opacity-60 mb-6">{forgotNote || `We sent a code to ${forgotEmail}.`}</div>
              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">6-digit code</label>
              <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                value={forgotOtp} onChange={e => setForgotOtp(e.target.value.replace(/\D/g, ""))}
                className="w-full mb-4 font-mono text-lg" style={{ letterSpacing: ".4em" }} placeholder="••••••" required autoFocus disabled={forgotBusy} />
              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">New password</label>
              <PasswordInput value={forgotNewPassword} onChange={e => setForgotNewPassword(e.target.value)}
                className="w-full mb-4" placeholder="At least 6 characters" required disabled={forgotBusy} />
              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Confirm new password</label>
              <PasswordInput value={forgotConfirm} onChange={e => setForgotConfirm(e.target.value)}
                className="w-full mb-4" required disabled={forgotBusy} />
              {forgotErr && (
                <div className="text-xs px-3 py-2 rounded mb-4" style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>{forgotErr}</div>
              )}
              <div className="flex gap-2">
                <button type="button" className="btn-ghost" onClick={() => { setForgotState("email"); setForgotErr(null); }}><ArrowLeft size={14} /> Back</button>
                <button className="btn-primary flex-1 justify-center" disabled={forgotBusy || forgotOtp.length < 4 || forgotNewPassword.length < 6}>
                  {forgotBusy ? "Resetting…" : <>Reset password <ArrowRight size={14} /></>}
                </button>
              </div>
              <div className="text-center mt-5">
                <button type="button" onClick={sendOtp} disabled={forgotBusy} className="text-xs opacity-60 hover:opacity-100 underline">
                  Didn't get it? Resend code
                </button>
              </div>
            </form>
          )}

          {/* Step 3 — done */}
          {forgotState === "done" && (
            <div className="anim-in">
              <div className="font-display text-2xl sm:text-3xl mb-2">Password reset ✓</div>
              <div className="text-sm opacity-70 mb-6 leading-relaxed">
                Your password for <span className="font-mono">{forgotEmail}</span> has been updated — sign in with it now.
              </div>
              <button className="btn-primary w-full justify-center" onClick={closeForgot}><ArrowLeft size={14} /> Back to sign-in</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
