import { useEffect } from "react";
import { X, LogIn, PenTool, FilePlus2, Upload, GitBranch, MousePointerClick, Send, ListChecks, Inbox, LifeBuoy } from "lucide-react";

// In-app requestor guide. Replaces the old "open GitHub" Help link with a
// self-contained, screenshot-driven walkthrough of the whole request process.
// Screenshots live in /public/help and are captured from the real app.
const STEPS = [
  {
    icon: LogIn, n: 1, title: "Sign in",
    img: "/help/01-signin.png",
    body: "Open signflow.umooriqtesadiyah.org and choose “Sign in with oneAccess”, then use your oneAccess account. There's no separate sign-up — your access comes through oneAccess.",
  },
  {
    icon: PenTool, n: 2, title: "Register your signature (one-time)",
    img: "/help/02-signature.png",
    body: "The first time you sign in you'll be asked to add your signature. Draw it with your mouse or finger, or upload an image of it, then Save. This is the signature that will be stamped on documents. You can change it anytime from the profile menu (top-right) → “Add a signature”.",
  },
  {
    icon: FilePlus2, n: 3, title: "Start a new request",
    img: "/help/03-dashboard.png",
    body: "On your dashboard, pick the kind of document under “Start a request by type” — Leave, Document, Expense, Invoice / PO, or Other. Choosing the right type just helps approvers sort what they receive; every type works the same way from here.",
  },
  {
    icon: Upload, n: 4, title: "Upload your document",
    img: "/help/04-upload.png",
    body: "Click the upload box and choose your file — a PDF or an Excel (.xlsx) file, up to 14 MB. Once it's selected you'll see its name; use “Remove” if you picked the wrong one.",
  },
  {
    icon: GitBranch, n: 5, title: "Choose how it should be approved",
    img: "/help/05-flow.png",
    body: "Pick one of three routes:  • Single approver — anyone with signing authority on a team can sign it.  • Send to a specific person — route it directly to one named individual.  • Multi-step workflow — several people sign in a set order. Tick “Instant approval” if it should finalise the moment everyone has signed.",
  },
  {
    icon: MousePointerClick, n: 6, title: "Mark where to sign",
    img: "/help/06-placement.png",
    body: "Click on the document to drop the signer's signature box, or drag to size it — a single click gives a standard-sized box. In the same step you can also add your OWN signature and a date, and drop a date box for the signer that fills in automatically with the date they sign (shown in green for you, amber for the signer).",
  },
  {
    icon: Send, n: 7, title: "Route and submit",
    img: "/help/07-submit.png",
    body: "Choose the team or person who should sign, add an optional note for context, and click “Submit request”. The signer is notified straight away.",
  },
  {
    icon: ListChecks, n: 8, title: "Track your requests",
    img: "/help/08-track.png",
    body: "Back on your dashboard, “Pending requests”, “Approved requests” and “Rejected requests” let you follow every document. From a row you can Preview it, send a Reminder to a slow signer, or Download / Print the finished, signed file.",
  },
  {
    icon: Inbox, n: 9, title: "Sign documents sent to you",
    img: "/help/09-awaiting.png",
    body: "If someone routes a document to you, it shows under “Awaiting your signature” on your dashboard. Open it, review the document, then “Preview & approve” to stamp your signature — or Reject with a reason.",
  },
];

export function HelpGuide({ onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: "var(--c-cream)" }}>
      {/* sticky header */}
      <div className="sticky top-0 z-10 border-b" style={{ backgroundColor: "var(--c-paper)", borderColor: "var(--c-ink-10)", paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <LifeBuoy size={18} style={{ color: "#B8894A" }} className="shrink-0" />
            <div className="min-w-0">
              <div className="font-display text-base sm:text-lg leading-tight truncate">How to use SignFlow</div>
              <div className="text-[10px] tracking-widest uppercase opacity-50">Requestor guide</div>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost text-sm shrink-0"><X size={15} /> <span className="hidden sm:inline">Close</span></button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* intro */}
        <p className="text-sm sm:text-base opacity-80 leading-relaxed mb-6">
          SignFlow lets you send a document for digital signature and track it all the way to a finished, signed file.
          Here's the whole process for a requestor, step by step.
        </p>

        {/* quick contents */}
        <div className="card p-4 mb-8">
          <div className="text-[10px] tracking-widest uppercase opacity-50 mb-2">In this guide</div>
          <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {STEPS.map(s => (
              <li key={s.n}>
                <a href={`#step-${s.n}`} className="flex items-center gap-2 py-0.5 hover:underline">
                  <span className="font-mono text-xs opacity-50 w-4 shrink-0">{s.n}</span>
                  <span className="truncate">{s.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </div>

        {/* steps */}
        <div className="space-y-12 sm:space-y-16">
          {STEPS.map((s, idx) => {
            const Icon = s.icon;
            return (
              <section key={s.n} id={`step-${s.n}`} className="scroll-mt-24"
                style={idx > 0 ? { borderTop: "1px solid var(--c-ink-08)", paddingTop: "2.5rem" } : undefined}>
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(184,137,74,.14)", color: "#B8894A" }}>
                    <Icon size={18} />
                  </div>
                  <div>
                    <div className="text-[10px] tracking-widest uppercase opacity-50">Step {s.n} of {STEPS.length}</div>
                    <h2 className="font-display text-lg sm:text-xl leading-tight">{s.title}</h2>
                  </div>
                </div>
                <p className="text-sm opacity-80 leading-relaxed mb-5 max-w-3xl">{s.body}</p>
                {/* screenshot in a subtle app-window frame */}
                <figure className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--c-ink-10)", boxShadow: "0 12px 30px rgba(15,26,46,.10)" }}>
                  <div className="flex items-center gap-1.5 px-3.5 py-2 border-b" style={{ backgroundColor: "rgba(15,26,46,.035)", borderColor: "var(--c-ink-08)" }}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: "#E0715F" }} />
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: "#E5B95A" }} />
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: "#5FA463" }} />
                    <span className="ml-2 text-[10px] font-mono opacity-40 truncate">signflow.devhqhb.online</span>
                  </div>
                  <img src={s.img} alt={`${s.title} — screenshot`} loading="lazy"
                    className="w-full block" style={{ backgroundColor: "#F5F1E8", aspectRatio: "1280 / 840" }} />
                </figure>
              </section>
            );
          })}
        </div>

        {/* footer */}
        <div className="card p-5 mt-12 flex items-start gap-3">
          <LifeBuoy size={18} style={{ color: "#B8894A" }} className="shrink-0 mt-0.5" />
          <div className="text-sm opacity-80">
            <div className="font-medium mb-1" style={{ opacity: 1 }}>Still stuck?</div>
            Reach out to your SignFlow administrator (IT) and mention the document name and what you were trying to do.
          </div>
        </div>
      </div>
    </div>
  );
}
