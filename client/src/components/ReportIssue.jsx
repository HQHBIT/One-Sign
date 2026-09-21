// ============================================================
//   REPORT AN ISSUE
//   ------------------------------------------------------------
//   One link, reachable from every screen, to the form the IT admin already
//   runs. Reports reach them by email from that form, so nothing here talks to
//   our own server: the point is that it works even when SignFlow itself is
//   the thing going wrong.
//
//   IT OPENS IN A NEW TAB. Someone reports a problem in the middle of doing
//   something — a half-filled request, a document waiting to be signed — and
//   navigating away would throw that work away just as they were being helpful.
//
//   The screen they were on is passed along as `from`, so a report arrives with
//   some context even when the person only writes "it doesn't work". Nothing
//   personal goes in the link: their name is in the form, and a browser address
//   is the wrong place for it.
// ============================================================
import { Flag } from "lucide-react";

export const REPORT_ISSUE_URL = "https://reops.umooriqtesadiyah.org/publicform/signflow-issues-enhancements";

/** The form's address, carrying the page the reporter came from. */
export function reportIssueHref() {
  try {
    const url = new URL(REPORT_ISSUE_URL);
    const from = `${window.location.host}${window.location.pathname}${window.location.hash}`;
    url.searchParams.set("from", from.slice(0, 200));
    return url.toString();
  } catch {
    return REPORT_ISSUE_URL;
  }
}

/**
 * The header button: icon plus label on wider screens, icon alone on a phone.
 *
 * An anchor rather than a button with an onClick, so it behaves like a link —
 * middle-click, long-press, "open in new tab" all work, and it still works if
 * the JavaScript on the page has broken, which is exactly when someone wants to
 * report a problem.
 */
export function ReportIssueButton({ className = "", compact = false }) {
  // Wrapped rather than hidden directly: btn-ghost sets its own display, which
  // beats the utility class on the same element. On a phone the header is
  // already full — the title starts colliding with the buttons — so the button
  // steps aside there and the profile menu carries the link instead.
  return (
    <span className="hidden sm:inline-flex">
      <a href={reportIssueHref()} target="_blank" rel="noopener noreferrer"
        className={`btn-ghost text-sm px-2 sm:px-3 ${className}`}
        title="Report an issue or suggest an improvement">
        <Flag size={16} />
        {!compact && <span className="hidden lg:inline">Report an issue</span>}
      </a>
    </span>
  );
}

/** The same destination as a quiet text link, for the sign-in screen. */
export function ReportIssueLink({ className = "" }) {
  return (
    <a href={reportIssueHref()} target="_blank" rel="noopener noreferrer"
      className={`text-xs opacity-60 hover:opacity-100 underline inline-flex items-center gap-1 ${className}`}>
      <Flag size={12} /> Report an issue
    </a>
  );
}
