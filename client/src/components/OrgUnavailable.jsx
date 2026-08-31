// ============================================================
//   THIS SITE ISN'T POINTED AT AN ORGANISATION
//   ------------------------------------------------------------
//   Each SignFlow deployment serves exactly one organisation and says which
//   through /auth/config. If the answer is nothing — the box has no ORG_SLUG,
//   or names an organisation that has been deactivated — there is no door to
//   show. Guessing one would be worse than saying so: it would put a WAQF
//   visitor at HQHB's sign-in, where their account is refused anyway.
//
//   This is a configuration fault, not something the visitor did, so it names
//   the address they reached and points at IT rather than offering a retry
//   that cannot succeed.
// ============================================================

export function OrgUnavailable() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6 text-center"
      style={{ backgroundColor: "var(--c-cream)", color: "var(--c-ink)" }}
    >
      <div className="font-display text-3xl mb-3">SignFlow</div>

      <div style={{ maxWidth: 460 }}>
        <p className="text-lg mb-3">This address isn’t set up for sign-in yet.</p>
        <p className="text-sm opacity-70 mb-6">
          SignFlow couldn’t tell which organisation{" "}
          <strong style={{ wordBreak: "break-all" }}>
            {typeof window !== "undefined" ? window.location.hostname : "this site"}
          </strong>{" "}
          belongs to, so there’s no sign-in to show. Nothing is wrong with your
          account — please use your organisation’s usual SignFlow address, or
          contact IT if you believe this one is correct.
        </p>
        <div
          className="text-xs opacity-50"
          style={{ borderTop: "1px solid var(--c-gold)", paddingTop: 12 }}
        >
          If you are IT: this deployment has no organisation set. See{" "}
          <code>ORG_SLUG</code> in the server’s .env.
        </div>
      </div>
    </div>
  );
}
