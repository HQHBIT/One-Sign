import { useState } from "react";
import { ArrowRight, ArrowLeft, Check } from "lucide-react";
import { api } from "../api.js";

export function LoginScreen({ login }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Forgot-password panel state: idle | open | sending | sent | error
  const [forgotState, setForgotState] = useState("idle");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotErr, setForgotErr] = useState(null);

  const submit = async e => {
    e.preventDefault(); setBusy(true);
    await login(email, password); setBusy(false);
  };

  const submitForgot = async e => {
    e.preventDefault();
    if (!forgotEmail.trim()) return;
    setForgotState("sending");
    setForgotErr(null);
    try {
      await api.forgotPassword(forgotEmail.trim());
      // Server always returns 200 to prevent enumeration. Display generic
      // "if that email exists, we sent a reset" copy.
      setForgotState("sent");
    } catch (e) {
      setForgotErr(e.message || "Could not send reset email");
      setForgotState("error");
    }
  };

  const openForgot = () => {
    setForgotEmail(email); // prefill from login form if they typed one
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
        {/* Logo badge */}
        <div className="logo-glow fade-up">
          <img src="/signflow-logo.png" alt="HQHB · SignFlow" className="w-52 sm:w-64 md:w-80 mx-auto" />
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
          {forgotState === "idle" && (
            <form onSubmit={submit}>
              <div className="font-display text-2xl sm:text-3xl mb-2">Sign in</div>
              <div className="text-sm opacity-60 mb-8">Use the credentials provided by your administrator.</div>
              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full mb-5" required autoFocus />
              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full mb-3" required />
              <div className="flex justify-end mb-6">
                <button type="button" onClick={openForgot}
                  className="text-xs opacity-60 hover:opacity-100 underline">
                  Forgot password?
                </button>
              </div>
              <button className="btn-primary w-full justify-center" disabled={busy}>
                {busy ? "Signing in…" : <>Continue <ArrowRight size={16} /></>}
              </button>
            </form>
          )}

          {(forgotState === "open" || forgotState === "sending" || forgotState === "error") && (
            <form onSubmit={submitForgot}>
              <div className="font-display text-2xl sm:text-3xl mb-2">Reset password</div>
              <div className="text-sm opacity-60 mb-8">
                Enter your work email. If it's registered, we'll email you a new password right away.
              </div>
              <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Email</label>
              <input type="email"
                value={forgotEmail}
                onChange={e => setForgotEmail(e.target.value)}
                className="w-full mb-5"
                required
                autoFocus
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
                <button className="btn-primary flex-1 justify-center" disabled={forgotState === "sending" || !forgotEmail.trim()}>
                  {forgotState === "sending" ? "Sending…" : <>Send reset email <ArrowRight size={14} /></>}
                </button>
              </div>
            </form>
          )}

          {forgotState === "sent" && (
            <div className="anim-in">
              <div className="font-display text-2xl sm:text-3xl mb-2">Check your inbox</div>
              <div className="text-sm opacity-70 mb-6 leading-relaxed">
                If <span className="font-mono">{forgotEmail}</span> is registered, a new password has been emailed.
                Sign in with the new password and change it once you're in.
              </div>
              <div className="card p-3 mb-6 flex items-start gap-3 text-xs" style={{ backgroundColor: "rgba(45,95,47,.06)", borderColor: "rgba(45,95,47,.2)" }}>
                <Check size={14} className="mt-0.5 shrink-0" style={{ color: "var(--c-forest)" }} />
                <div className="opacity-80">It may take a minute to arrive. Check your spam folder if you don't see it.</div>
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
