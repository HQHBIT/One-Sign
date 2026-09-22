// ============================================================
//   REPORT AN ISSUE
//   ------------------------------------------------------------
//   One way in, from every screen: describe what went wrong, press send, and
//   SignFlow emails whoever looks after it. Reporting happens IN the app rather
//   than on a form elsewhere, so the report arrives knowing who sent it, from
//   which screen and in which browser — the three things a "it doesn't work"
//   report always lacks and nobody should have to ask for.
//
//   IT NEVER NAVIGATES AWAY. Someone reports a problem in the middle of doing
//   something — a half-filled request, a document waiting to be signed — so this
//   is a dialog over the page, and closing it puts them back exactly where they
//   were.
//
//   Signed out there is nobody to attribute a report to and no session to send
//   it with, so the sign-in screen keeps a plain link to the form IT runs
//   separately. Being locked out is exactly the thing worth reporting.
// ============================================================
import { useEffect, useRef, useState } from "react";
import { Flag, X, Send, Check } from "lucide-react";
import { api } from "../api.js";

// The form IT runs outside SignFlow — used only where we have no session.
export const REPORT_ISSUE_URL = "https://reops.umooriqtesadiyah.org/publicform/signflow-issues-enhancements";

/** Which screen the reporter was on, as text for the email. */
function currentPage() {
  try {
    return `${window.location.pathname}${window.location.hash}`.slice(0, 200) || "/";
  } catch {
    return "unknown";
  }
}

export function reportIssueHref() {
  try {
    const url = new URL(REPORT_ISSUE_URL);
    url.searchParams.set("from", `${window.location.host}${currentPage()}`.slice(0, 200));
    return url.toString();
  } catch {
    return REPORT_ISSUE_URL;
  }
}

/** The dialog itself: a description, what kind of report, and send. */
export function ReportIssueDialog({ onClose }) {
  const [category, setCategory] = useState("issue");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    boxRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = async () => {
    if (message.trim().length < 5) return setErr("Please describe it in a little more detail.");
    setBusy(true); setErr("");
    try {
      await api.reportIssue({ message: message.trim(), category, page: currentPage() });
      setSent(true);
      // Long enough to read the confirmation, short enough not to be in the way.
      setTimeout(onClose, 2200);
    } catch (e) {
      setErr(e.message || "Could not send that — please try again.");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(15,26,46,.45)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-xl overflow-hidden"
        style={{ backgroundColor: "var(--c-paper)", boxShadow: "0 20px 60px rgba(15,26,46,.35)" }}
        role="dialog" aria-modal="true" aria-label="Report an issue">
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--c-ink-10)" }}>
          <div className="flex items-center gap-2">
            <Flag size={16} style={{ color: "var(--c-gold)" }} />
            <span className="font-display text-lg">Report an issue</span>
          </div>
          <button className="btn-ghost text-xs px-2" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>

        {sent ? (
          <div className="px-5 py-10 text-center">
            <Check size={26} style={{ color: "#2D5F2F" }} className="mx-auto mb-3" />
            <div className="font-display text-xl mb-1">Thank you — it has been sent</div>
            <div className="text-sm opacity-60">The team has been emailed and will look into it.</div>
          </div>
        ) : (
          <div className="px-5 py-4">
            <div className="text-xs opacity-60 mb-3">
              This goes straight to the team looking after SignFlow. Your name and the screen you are on are included, so you do not need to write them.
            </div>

            <div className="flex gap-2 mb-3">
              {[["issue", "Something is wrong"], ["enhancement", "An improvement"]].map(([key, label]) => (
                <button key={key} onClick={() => setCategory(key)}
                  className={category === key ? "btn-primary text-xs" : "btn-ghost text-xs"}>
                  {category === key && <Check size={11} />} {label}
                </button>
              ))}
            </div>

            <textarea ref={boxRef} className="w-full" rows={6} value={message} maxLength={4000}
              placeholder={category === "issue"
                ? "What were you doing, and what happened instead?"
                : "What would make this easier for you?"}
              onChange={(e) => { setMessage(e.target.value); if (err) setErr(""); }} />

            {err && (
              <div className="text-xs mt-2 px-3 py-2 rounded"
                style={{ backgroundColor: "rgba(155,44,44,.08)", color: "var(--c-rust-deep)" }}>{err}</div>
            )}

            <div className="flex items-center gap-3 mt-4">
              <button className="btn-primary" onClick={send} disabled={busy}>
                <Send size={13} /> {busy ? "Sending…" : "Send report"}
              </button>
              <button className="btn-ghost text-xs" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The header button. Holds the dialog itself, so no screen has to thread state
 * through for it — the button is dropped in and it works.
 */
export function ReportIssueButton({ className = "", compact = false }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Wrapped rather than hidden directly: btn-ghost sets its own display,
          which beats the utility class on the same element. On a phone the
          header is already full — the title starts colliding with the buttons —
          so the button steps aside and the profile menu carries it there. */}
      <span className="hidden sm:inline-flex">
        <button onClick={() => setOpen(true)} className={`btn-ghost text-sm px-2 sm:px-3 ${className}`}
          title="Report an issue or suggest an improvement">
          <Flag size={16} />
          {!compact && <span className="hidden lg:inline">Report an issue</span>}
        </button>
      </span>
      {open && <ReportIssueDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/** Signed out: a plain link to the form IT runs, since there is no session. */
export function ReportIssueLink({ className = "" }) {
  return (
    <a href={reportIssueHref()} target="_blank" rel="noopener noreferrer"
      className={`text-xs opacity-60 hover:opacity-100 underline inline-flex items-center gap-1 ${className}`}>
      <Flag size={12} /> Report an issue
    </a>
  );
}
