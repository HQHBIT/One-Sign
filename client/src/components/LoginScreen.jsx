import { useState } from "react";
import { ArrowRight } from "lucide-react";

export function LoginScreen({ login }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setBusy(true);
    await login(email, password); setBusy(false);
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
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="font-display text-2xl sm:text-3xl mb-2">Sign in</div>
          <div className="text-sm opacity-60 mb-8">Use the credentials provided by your administrator.</div>
          <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full mb-5" required autoFocus />
          <label className="block text-xs tracking-wider uppercase opacity-70 mb-2">Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full mb-6" required />
          <button className="btn-primary w-full justify-center" disabled={busy}>
            {busy ? "Signing in…" : <>Continue <ArrowRight size={16} /></>}
          </button>
        </form>
      </div>
    </div>
  );
}
