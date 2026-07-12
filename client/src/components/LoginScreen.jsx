import { useState, useEffect } from "react";
import { ArrowRight, ArrowLeft, Check } from "lucide-react";
import { api } from "../api.js";

// DISABLED: expense feature commented out
/* Local-time YYYY-MM-DD for the date input's default value.
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
*/

export function LoginScreen({ login }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Login options from the server: whether to offer oneAccess SSO and/or the local
  // password form. Defaults keep the local form so a config hiccup never locks out.
  const [authCfg, setAuthCfg] = useState({ oneAccessEnabled: false, localLoginEnabled: true, oneAccessStartUrl: null });
  useEffect(() => { api.authConfig().then(setAuthCfg).catch(() => {}); }, []);
  // Never hide the local form unless oneAccess is actually available.
  const showLocal = authCfg.localLoginEnabled || !authCfg.oneAccessEnabled;
  // Forgot-password panel state: idle | open | sending | sent | error
  const [forgotState, setForgotState] = useState("idle");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotErr, setForgotErr] = useState(null);
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [forgotConfirm, setForgotConfirm] = useState("");

  // Self-registration panel.
  const [regOpen, setRegOpen] = useState(false);
  const [reg, setReg] = useState({ name: "", email: "", password: "", teamName: "", reportingManager: "" });
  const [regState, setRegState] = useState("form"); // form | saving | done | error
  const [regErr, setRegErr] = useState(null);

  const resetReg = () => { setReg({ name: "", email: "", password: "", teamName: "", reportingManager: "" }); setRegState("form"); setRegErr(null); };
  const openReg = () => { resetReg(); setRegOpen(true); };
  const closeReg = () => { setRegOpen(false); resetReg(); };

  const submitReg = async e => {
    e.preventDefault();
    if (!reg.name.trim() || !reg.email.trim() || reg.password.length < 6) return;
    setRegState("saving"); setRegErr(null);
    try {
      await api.register({ name: reg.name.trim(), email: reg.email.trim(), password: reg.password, teamName: reg.teamName.trim(), reportingManager: reg.reportingManager.trim() });
      setRegState("done");
    } catch (err) {
      setRegErr(err.message || "Could not submit registration");
      setRegState("error");
    }
  };

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

  const submitForgot = async e => {
    e.preventDefault();
    if (!forgotEmail.trim()) return;
    if (forgotNewPassword.length < 6) { setForgotErr("New password must be at least 6 characters"); setForgotState("error"); return; }
    if (forgotNewPassword !== forgotConfirm) { setForgotErr("Passwords don't match"); setForgotState("error"); return; }
    setForgotState("sending");
    setForgotErr(null);
    try {
      await api.requestReset({ email: forgotEmail.trim(), newPassword: forgotNewPassword });
      // Server always returns 200 (anti-enumeration). The new password takes
      // effect only after IT approves the request.
      setForgotState("sent");
    } catch (e) {
      setForgotErr(e.message || "Could not submit reset request");
      setForgotState("error");
    }
  };

  const openForgot = () => {
    setForgotEmail(email); // prefill from login form if they typed one
    setForgotNewPassword(""); setForgotConfirm("");
    setForgotErr(null);
    setForgotState("open");
  };
  const closeForgot = () => {
    setForgotState("idle");
    setForgotErr(null);
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      {/* left panel */}
      <div className="ink-grad text-white relative grain flex flex-col items-center justify-center px-6 py-8 sm:px-8 sm:py-12 md:p-14 text-center gap-4 sm:gap-6" style={{ color: "var(--c-cream)" }}>
        {/* Logo — light (cream) version sits directly on the navy panel, no box */}
        <div className="fade-up">
          <img src="/signflow-logo-light.png" alt="HQHB · SignFlow" className="w-52 sm:w-64 md:w-80 mx-auto" />
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

        <div className="text-[10px] opacity-30 tracking-widest uppercase fade-up fade-up-d3 mt-auto pt-4">HQHB - Internal Build</div>
      </div>
      {/* right panel */}
      <div className="flex items-center justify-center p-6 sm:p-8 md:p-16">
        <div className="w-full max-w-sm">
          {forgotState === "idle" && !regOpen && (
            <div>
              <div className="font-display text-2xl sm:text-3xl mb-2">Sign in</div>
              <div className="text-sm opacity-60 mb-8">
                {showLocal ? "Use the credentials provided by your administrator." : "Continue with your oneAccess account."}
              </div>

              {authCfg.oneAccessEnabled && (
                <>
                  <button type="button" className="btn-primary w-full justify-center"
                    onClick={() => { window.location.href = authCfg.oneAccessStartUrl; }}>
                    Sign in with oneAccess <ArrowRight size={16} />
                  </button>
                  {showLocal && (
                    <div className="flex items-center gap-3 my-6 text-xs opacity-50">
                      <div className="flex-1 h-px" style={{ background: "var(--c-ink-18)" }} />
                      or
                      <div className="flex-1 h-px" style={{ background: "var(--c-ink-18)" }} />
                    </div>
                  )}
                </>
              )}

              {showLocal && (
                <form onSubmit={submit}>
                  <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full mb-5" required autoFocus={!authCfg.oneAccessEnabled} />
                  <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Password</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full mb-3" required />
                  <div className="flex justify-end mb-6">
                    <button type="button" onClick={openForgot}
                      className="text-xs opacity-60 hover:opacity-100 underline">
                      Forgot password?
                    </button>
                  </div>
                  <button className={`${authCfg.oneAccessEnabled ? "btn-ghost" : "btn-primary"} w-full justify-center`} disabled={busy}>
                    {busy ? "Signing in…" : <>Continue <ArrowRight size={16} /></>}
                  </button>
                  <div className="text-center mt-6">
                    <button type="button" onClick={openReg}
                      className="text-xs opacity-60 hover:opacity-100 underline">
                      New here? Create an account →
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {regOpen && regState !== "done" && (
            <form onSubmit={submitReg}>
              <div className="font-display text-2xl sm:text-3xl mb-2">Create an account</div>
              <div className="text-sm opacity-60 mb-8">Your request goes to IT for approval. You'll be able to sign in once it's approved.</div>

              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Full name</label>
              <input type="text" value={reg.name} onChange={e => setReg({ ...reg, name: e.target.value })} className="w-full mb-4" maxLength={191} required autoFocus />

              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Work email</label>
              <input type="email" value={reg.email} onChange={e => setReg({ ...reg, email: e.target.value })} className="w-full mb-4" maxLength={191} required />

              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Password</label>
              <input type="password" value={reg.password} onChange={e => setReg({ ...reg, password: e.target.value })} className="w-full mb-4" placeholder="At least 6 characters" required />

              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Team / Department</label>
              <input type="text" value={reg.teamName} onChange={e => setReg({ ...reg, teamName: e.target.value })} className="w-full mb-4" maxLength={191} placeholder="e.g., Finance" />

              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Reporting manager</label>
              <input type="text" value={reg.reportingManager} onChange={e => setReg({ ...reg, reportingManager: e.target.value })} className="w-full mb-5" maxLength={191} placeholder="Manager's name" />

              {regErr && (
                <div className="text-xs px-3 py-2 rounded mb-4" style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>{regErr}</div>
              )}

              <div className="flex gap-2">
                <button type="button" className="btn-ghost" onClick={closeReg}><ArrowLeft size={14} /> Back</button>
                <button className="btn-primary flex-1 justify-center" disabled={regState === "saving" || !reg.name.trim() || !reg.email.trim() || reg.password.length < 6}>
                  {regState === "saving" ? "Submitting…" : <>Request access <ArrowRight size={14} /></>}
                </button>
              </div>
            </form>
          )}

          {regOpen && regState === "done" && (
            <div className="anim-in">
              <div className="font-display text-2xl sm:text-3xl mb-2">Request submitted ✓</div>
              <div className="text-sm opacity-70 mb-6 leading-relaxed">Thanks! IT will review your request. Once approved, sign in with the email and password you just chose.</div>
              <button className="btn-primary w-full justify-center" onClick={closeReg}><ArrowLeft size={14} /> Back to sign-in</button>
            </div>
          )}

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

          {(forgotState === "open" || forgotState === "sending" || forgotState === "error") && (
            <form onSubmit={submitForgot}>
              <div className="font-display text-2xl sm:text-3xl mb-2">Reset password</div>
              <div className="text-sm opacity-60 mb-8">
                Enter your email and choose a new password. IT will review and approve the request — then you can sign in with it.
              </div>
              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Email</label>
              <input type="email"
                value={forgotEmail}
                onChange={e => setForgotEmail(e.target.value)}
                className="w-full mb-4"
                required
                autoFocus
                disabled={forgotState === "sending"} />
              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">New password</label>
              <input type="password"
                value={forgotNewPassword}
                onChange={e => setForgotNewPassword(e.target.value)}
                className="w-full mb-4"
                placeholder="At least 6 characters"
                required
                disabled={forgotState === "sending"} />
              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Confirm new password</label>
              <input type="password"
                value={forgotConfirm}
                onChange={e => setForgotConfirm(e.target.value)}
                className="w-full mb-5"
                required
                disabled={forgotState === "sending"} />
              {forgotErr && (
                <div className="text-xs px-3 py-2 rounded mb-4"
                  style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>
                  {forgotErr}
                </div>
              )}
              <div className="flex gap-2">
                <button type="button" className="btn-ghost" onClick={closeForgot}>
                  <ArrowLeft size={14} /> Back
                </button>
                <button className="btn-primary flex-1 justify-center" disabled={forgotState === "sending" || !forgotEmail.trim() || forgotNewPassword.length < 6}>
                  {forgotState === "sending" ? "Submitting…" : <>Request reset <ArrowRight size={14} /></>}
                </button>
              </div>
            </form>
          )}

          {forgotState === "sent" && (
            <div className="anim-in">
              <div className="font-display text-2xl sm:text-3xl mb-2">Request submitted ✓</div>
              <div className="text-sm opacity-70 mb-6 leading-relaxed">
                Your reset request for <span className="font-mono">{forgotEmail}</span> has been sent to IT.
                Once they approve it, sign in with your new password.
              </div>
              <div className="card p-3 mb-6 flex items-start gap-3 text-xs" style={{ backgroundColor: "rgba(45,95,47,.06)", borderColor: "rgba(45,95,47,.2)" }}>
                <Check size={14} className="mt-0.5 shrink-0" style={{ color: "var(--c-forest)" }} />
                <div className="opacity-80">Your current password keeps working until IT approves the change.</div>
              </div>
              <button className="btn-primary w-full justify-center" onClick={closeForgot}>
                <ArrowLeft size={14} /> Back to sign-in
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
