// ============================================================
//   ONBOARD USER WIZARD — 3-step add-user flow
//   Step 1: Identity (name / email / password)
//   Step 2: Role + assignment (signing authority for approvers,
//           department for requestors, nothing for admins)
//   Step 3: Review & confirm
// ============================================================
import { useState } from "react";
import {
  X, Check, ArrowLeft, ArrowRight, UserPlus, Stamp, Shield, Building2,
  Briefcase, UserCog, Eye as EyeIcon, EyeOff
} from "lucide-react";
import { useEscapeKey } from "../lib/useBackHandler.js";
import { useFocusTrap } from "../lib/useFocusTrap.js";
import { Row } from "../components/Row.jsx";

export function OnboardUserWizard({ teams, users, onCancel, onSave }) {
  const [step, setStep] = useState(0);
  useEscapeKey(true, onCancel);
  const trapRef = useFocusTrap(true);
  const [f, setF] = useState({
    name: "", email: "", password: "",
    role: "requestor",
    signingAuthorityTeams: [],
    team: ""
  });
  const [touched, setTouched] = useState({});
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);

  const mark = k => setTouched(t => ({ ...t, [k]: true }));
  const missing = ["name", "email", "password"].filter(k => !f[k].trim());
  const canAdvanceIdentity = missing.length === 0;

  const Req = () => <span style={{ color: "var(--c-rust)" }}>*</span>;
  const errStyle = (k) => (touched[k] && !f[k].trim())
    ? { borderColor: "#9B2C2C", boxShadow: "0 0 0 3px rgba(155,44,44,.12)" } : {};

  const next = () => {
    if (step === 0) {
      setTouched({ name: true, email: true, password: true });
      if (!canAdvanceIdentity) return;
    }
    setStep(s => Math.min(s + 1, 2));
  };
  const prev = () => setStep(s => Math.max(s - 1, 0));

  const save = async () => {
    setBusy(true);
    try { await onSave(f); }
    finally { setBusy(false); }
  };

  const steps = [
    { n: "01", label: "Identity" },
    { n: "02", label: "Role & assignment" },
    { n: "03", label: "Confirm" }
  ];

  const roleCards = [
    { key: "requestor", icon: UserPlus, label: "Requestor",  desc: "Submits documents for approval. Belongs to a single department." },
    { key: "approver",  icon: Stamp,    label: "Approver",   desc: "Signs documents. Can hold signing authority over multiple teams." },
    { key: "executive", icon: Briefcase, label: "Executive", desc: "A senior signer. Signs like an approver and can have an assistant act on their behalf." },
    { key: "executive_assistant", icon: UserCog, label: "Executive Assistant", desc: "Views and (when allowed) signs documents on behalf of one or more executives." },
    { key: "admin",     icon: Shield,   label: "Administrator", desc: "Full control of users, teams, signatures, and audit." }
  ];

  // Team preview info for the assignment step
  const teamMembers = (teamId) => users.filter(u => u.team === teamId).length;
  const teamApprovers = (teamId) => users.filter(u => u.role === "approver" && (u.signingAuthorityTeams || []).includes(teamId)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(15,26,46,.65)" }} onClick={onCancel}>
      <div ref={trapRef} className="card p-6 w-full max-w-2xl max-h-[90vh] overflow-auto" style={{ backgroundColor: "var(--c-cream)" }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-[10px] tracking-widest uppercase opacity-50">Onboard a user</div>
            <div className="font-display text-2xl">{steps[step].label}</div>
          </div>
          <button onClick={onCancel} className="btn-ghost text-xs"><X size={14} /></button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mt-4 mb-6">
          {steps.map((s, i) => {
            const active = i === step;
            const done = i < step;
            return (
              <div key={s.n} className="flex items-center gap-2 flex-1">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium"
                    style={{
                      backgroundColor: active ? "#0F1A2E" : done ? "#B8894A" : "rgba(15,26,46,.08)",
                      color: (active || done) ? "#F5F1E8" : "rgba(15,26,46,.6)"
                    }}>
                    {done ? <Check size={11} /> : i + 1}
                  </div>
                  <div className="text-[10px] tracking-wider uppercase" style={{ opacity: active ? 1 : 0.5 }}>{s.label}</div>
                </div>
                {i < steps.length - 1 && <div className="flex-1 h-px" style={{ backgroundColor: done ? "#B8894A" : "rgba(15,26,46,.12)" }} />}
              </div>
            );
          })}
        </div>

        <form autoComplete="off" onSubmit={e => e.preventDefault()}>
          {/* Honeypot to absorb browser autofill */}
          <input type="text" name="username" autoComplete="username" style={{ display: "none" }} tabIndex={-1} aria-hidden="true" />
          <input type="password" name="password" autoComplete="current-password" style={{ display: "none" }} tabIndex={-1} aria-hidden="true" />

          {/* ─── STEP 1: Identity ─── */}
          {step === 0 && (
            <div className="space-y-3 anim-in">
              <div>
                <label className="text-xs tracking-wider uppercase opacity-70 block mb-1">Full name <Req /></label>
                <input autoFocus className="w-full" name="wiz_name" autoComplete="off"
                  value={f.name} onChange={e => setF({ ...f, name: e.target.value })}
                  onBlur={() => mark("name")} style={errStyle("name")} />
              </div>
              <div>
                <label className="text-xs tracking-wider uppercase opacity-70 block mb-1">Work email <Req /></label>
                <input className="w-full" type="email" name="wiz_email" autoComplete="off"
                  value={f.email} onChange={e => setF({ ...f, email: e.target.value })}
                  onBlur={() => mark("email")} style={errStyle("email")} />
              </div>
              <div>
                <label className="text-xs tracking-wider uppercase opacity-70 block mb-1">Initial password <Req /></label>
                <div style={{ position: "relative" }}>
                  <input className="w-full" type={showPwd ? "text" : "password"} name="wiz_password" autoComplete="new-password"
                    value={f.password} onChange={e => setF({ ...f, password: e.target.value })}
                    onBlur={() => mark("password")} style={{ ...errStyle("password"), paddingRight: 40 }}
                    placeholder="At least 6 characters" />
                  <button type="button" onClick={() => setShowPwd(s => !s)}
                    title={showPwd ? "Hide password" : "Show password"}
                    style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", cursor: "pointer", padding: 4, opacity: 0.6, display: "flex", alignItems: "center" }}>
                    {showPwd ? <EyeOff size={15} /> : <EyeIcon size={15} />}
                  </button>
                </div>
                <div className="text-xs opacity-60 mt-1">They can change this once they sign in.</div>
              </div>
              {missing.length > 0 && Object.keys(touched).length > 0 && (
                <div className="text-xs px-3 py-2 rounded" style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>
                  Required: {missing.join(", ")}
                </div>
              )}
            </div>
          )}

          {/* ─── STEP 2: Role + assignment ─── */}
          {step === 1 && (
            <div className="anim-in">
              <div className="text-xs tracking-wider uppercase opacity-70 mb-2">Role</div>
              <div className="grid sm:grid-cols-2 gap-2 mb-5">
                {roleCards.map(rc => {
                  const active = f.role === rc.key;
                  const Icon = rc.icon;
                  return (
                    <button key={rc.key} type="button"
                      onClick={() => setF({ ...f, role: rc.key, signingAuthorityTeams: [], team: "" })}
                      className={`card p-3 text-left tile-hover ${active ? "ring-2" : ""}`}
                      style={{
                        borderColor: active ? "#B8894A" : undefined,
                        backgroundColor: active ? "rgba(184,137,74,.08)" : undefined
                      }}>
                      <Icon size={16} className="opacity-70 mb-2" />
                      <div className="font-medium text-sm">{rc.label}</div>
                      <div className="text-xs opacity-60 mt-0.5">{rc.desc}</div>
                    </button>
                  );
                })}
              </div>

              {/* Approver / Executive — multi-select signing authority */}
              {(f.role === "approver" || f.role === "executive") && (
                <div>
                  <div className="text-xs tracking-wider uppercase opacity-70 mb-2">Signing authority — sign for which teams?</div>
                  {teams.length === 0 ? (
                    <div className="card p-4 text-sm opacity-60">No teams exist yet. Create teams from the "Teams & authority" tab first.</div>
                  ) : (
                    <div className="space-y-2">
                      {teams.map(t => {
                        const checked = f.signingAuthorityTeams.includes(t.id);
                        return (
                          <label key={t.id} className="card p-3 flex items-center gap-3 cursor-pointer tile-hover"
                            style={{ borderColor: checked ? "#B8894A" : undefined, backgroundColor: checked ? "rgba(184,137,74,.08)" : undefined }}>
                            <input type="checkbox" checked={checked} onChange={e => {
                              const v = e.target.checked
                                ? [...f.signingAuthorityTeams, t.id]
                                : f.signingAuthorityTeams.filter(x => x !== t.id);
                              setF({ ...f, signingAuthorityTeams: v });
                            }} />
                            <Building2 size={16} className="opacity-70" />
                            <div className="flex-1">
                              <div className="font-medium text-sm">{t.name}</div>
                              <div className="text-xs opacity-60">{teamApprovers(t.id)} approver(s) · {teamMembers(t.id)} member(s)</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  <div className="text-xs opacity-60 mt-3">Without any signing authority, this approver won't appear in workflows.</div>
                </div>
              )}

              {/* Requestor — pick department */}
              {f.role === "requestor" && (
                <div>
                  <div className="text-xs tracking-wider uppercase opacity-70 mb-2">Department</div>
                  {teams.length === 0 ? (
                    <div className="card p-4 text-sm opacity-60">No teams exist yet. Create teams first.</div>
                  ) : (
                    <div className="space-y-2">
                      <label className="card p-3 flex items-center gap-3 cursor-pointer tile-hover"
                        style={{ borderColor: f.team === "" ? "#B8894A" : undefined, backgroundColor: f.team === "" ? "rgba(184,137,74,.08)" : undefined }}>
                        <input type="radio" name="team_pick" checked={f.team === ""} onChange={() => setF({ ...f, team: "" })} />
                        <div className="flex-1">
                          <div className="font-medium text-sm">No department</div>
                          <div className="text-xs opacity-60">Can be assigned later from the team page.</div>
                        </div>
                      </label>
                      {teams.map(t => (
                        <label key={t.id} className="card p-3 flex items-center gap-3 cursor-pointer tile-hover"
                          style={{ borderColor: f.team === t.id ? "#B8894A" : undefined, backgroundColor: f.team === t.id ? "rgba(184,137,74,.08)" : undefined }}>
                          <input type="radio" name="team_pick" checked={f.team === t.id} onChange={() => setF({ ...f, team: t.id })} />
                          <Building2 size={16} className="opacity-70" />
                          <div className="flex-1">
                            <div className="font-medium text-sm">{t.name}</div>
                            <div className="text-xs opacity-60">{teamMembers(t.id)} current member(s)</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Admin — nothing to assign */}
              {f.role === "admin" && (
                <div className="card p-4 text-sm opacity-70">
                  <Shield size={14} className="inline-block mr-1.5 opacity-70" />
                  Administrators have full access — no team assignment needed.
                </div>
              )}

              {/* Executive Assistant — linked to executives separately */}
              {f.role === "executive_assistant" && (
                <div className="card p-4 text-sm opacity-70">
                  <UserCog size={14} className="inline-block mr-1.5 opacity-70" />
                  After creating this assistant, link them to one or more executives from
                  the “Assistants” menu (or the executive can add them from “My assistant”).
                </div>
              )}
            </div>
          )}

          {/* ─── STEP 3: Review ─── */}
          {step === 2 && (
            <div className="anim-in">
              <div className="text-xs tracking-wider uppercase opacity-70 mb-3">Review and confirm</div>
              <div className="card p-5 space-y-3">
                <Row label="Name" value={f.name} />
                <Row label="Email" value={<span className="font-mono text-xs">{f.email}</span>} />
                <Row label="Password" value={<span className="font-mono text-xs">{"•".repeat(Math.min(f.password.length, 12))}</span>} />
                <Row label="Role" value={<span className="pill pill-pending">{f.role}</span>} />
                {f.role === "approver" && (
                  <Row label="Signing authority" value={
                    f.signingAuthorityTeams.length === 0
                      ? <span className="opacity-60">— none yet —</span>
                      : <div className="flex flex-wrap gap-1.5">
                          {f.signingAuthorityTeams.map(id => {
                            const t = teams.find(x => x.id === id);
                            return <span key={id} className="pill" style={{ backgroundColor: "rgba(184,137,74,.18)", color: "var(--c-sand)" }}>{t?.name || id}</span>;
                          })}
                        </div>
                  } />
                )}
                {f.role === "requestor" && (
                  <Row label="Department" value={
                    f.team
                      ? <span className="pill" style={{ backgroundColor: "rgba(184,137,74,.18)", color: "var(--c-sand)" }}>{teams.find(t => t.id === f.team)?.name || f.team}</span>
                      : <span className="opacity-60">— none —</span>
                  } />
                )}
              </div>
              <div className="text-xs opacity-60 mt-3">An email is not auto-sent — share the credentials with the user manually.</div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between mt-6 gap-2">
            <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
            <div className="flex gap-2">
              {step > 0 && <button type="button" className="btn-ghost" onClick={prev}><ArrowLeft size={13} /> Back</button>}
              {step < 2
                ? <button type="button" className="btn-primary" onClick={next} disabled={step === 0 && !canAdvanceIdentity}
                    title={step === 0 && !canAdvanceIdentity ? `Fill in: ${missing.join(", ")}` : "Continue"}>
                    Continue <ArrowRight size={13} />
                  </button>
                : <button type="button" className="btn-primary" onClick={save} disabled={busy}>
                    {busy ? "Creating…" : <><Check size={13} /> Create user</>}
                  </button>}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
