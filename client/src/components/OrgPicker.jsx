// ============================================================
//   LANDING — WHICH ORGANISATION?
//   ------------------------------------------------------------
//   The first thing a visitor sees. One tile per organisation; choosing one
//   opens that organisation's sign-in. Each organisation's people are separate,
//   so this is a real fork, not decoration.
// ============================================================
import { useEffect, useState } from "react";
import { api } from "../api.js";

// An organisation's mark, degrading gracefully. A logo file may be missing —
// during onboarding it usually is — and a broken-image icon on the landing page
// looks like a fault. The monogram is a deliberate placeholder, not a failure.
function OrgMark({ org }) {
  const [broken, setBroken] = useState(false);
  const initials = (org.name || "?")
    .replace(/[^A-Za-z\s]/g, " ")
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0].toUpperCase()).join("") || "?";

  if (!org.logoPath || broken) {
    return (
      <div aria-hidden="true"
        style={{
          width: 96, height: 96, margin: "0 auto 16px", borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          border: "2px solid var(--c-gold)", color: "var(--c-gold)",
          fontSize: 26, fontWeight: 700, letterSpacing: ".04em"
        }}>
        {initials}
      </div>
    );
  }
  return (
    <img src={org.logoPath} alt="" onError={() => setBroken(true)}
      style={{ height: 96, width: "auto", maxWidth: "100%", objectFit: "contain", display: "block", margin: "0 auto 16px" }} />
  );
}

export function OrgPicker({ onPick }) {
  const [orgs, setOrgs] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.organisations()
      .then(list => setOrgs(list))
      .catch(e => setErr(e.message || "Could not load organisations"));
  }, []);

  // One organisation is not a choice — go straight through rather than making
  // someone click past a page with a single option.
  useEffect(() => {
    if (orgs && orgs.length === 1) onPick(orgs[0].id);
  }, [orgs, onPick]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ backgroundColor: "var(--c-cream)" }}>
      <div className="font-display text-3xl mb-1">SignFlow</div>
      <div className="text-sm opacity-60 mb-10">Choose your organisation to sign in</div>

      {err && (
        <div className="text-xs mb-6 px-3 py-2 rounded" style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>
          {err}
        </div>
      )}

      {orgs === null && !err && <div className="text-sm opacity-50">Loading…</div>}

      {orgs && orgs.length > 0 && (
        <div className="flex flex-wrap gap-5 justify-center">
          {orgs.map(o => (
            <button key={o.id} type="button" onClick={() => onPick(o.id)}
              className="card tile-hover"
              style={{
                width: 230, padding: "26px 20px", cursor: "pointer",
                backgroundColor: "var(--c-paper)", border: "2px solid var(--c-ink-08)",
                textAlign: "center"
              }}>
              <OrgMark org={o} />
              <div className="font-medium" style={{ fontSize: 15 }}>{o.name}</div>
              <div className="text-xs opacity-50 mt-1">
                {o.allowOneAccess ? "oneAccess or password" : "Password sign-in"}
              </div>
            </button>
          ))}
        </div>
      )}

      {orgs && orgs.length === 0 && !err && (
        <div className="text-sm opacity-60">No organisations are available. Please contact IT.</div>
      )}
    </div>
  );
}
