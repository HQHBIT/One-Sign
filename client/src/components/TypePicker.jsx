import { useState } from "react";
import { FileText, CalendarDays, Wallet, Receipt, FolderKanban, ClipboardCheck, Lock, Files, ChevronRight, Hourglass, Check } from "lucide-react";
import { requestTypesFor, retentionLabel } from "../lib/constants.js";

// ============================================================
//   TYPE PICKER — the first step of "Make a new request"
//   ------------------------------------------------------------
//   Arriving: the rows come in turn — a short fade and rise, staggered so the
//   list reads top to bottom.
//   Choosing: the row presses in, a soft gold ripple spreads from the exact
//   point clicked, a gold wash sweeps across it, its icon fills gold and a tick
//   replaces the arrow while the other rows step back; then the form rises in
//   with the chosen type at the top. "Change" brings the list back.
//   With "reduce motion" set on the device, every step is immediate.
// ============================================================
const ICONS = {
  document: FileText, leave: CalendarDays, expense: Wallet, invoice: Receipt,
  project: FolderKanban, workdone: ClipboardCheck, confidential: Lock, general: Files,
};
const STAGGER_MS = 70;
const PICK_MS = 640;
const EASE = "cubic-bezier(.2,.7,.2,1)";

const CSS = `
@keyframes sf-type-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes sf-rule-in { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes sf-type-out { to { opacity: 0; transform: translateX(-14px); filter: blur(1px); } }
/* The chosen row presses, lifts, then glides up to the top of the list — where the form will show it. */
@keyframes sf-type-lift { 0% { transform: scale(.985); } 30% { transform: translateX(6px) scale(1.01); } 100% { transform: translate(6px, var(--lift-y, 0px)) scale(1); } }
@keyframes sf-ripple { from { transform: translate(-50%,-50%) scale(0); opacity: .38; } to { transform: translate(-50%,-50%) scale(1); opacity: 0; } }
@keyframes sf-pop { 0% { transform: scale(.3); opacity: 0; } 60% { transform: scale(1.18); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
@keyframes sf-chip-in { from { opacity: 0; transform: translateY(-8px) scale(.98); } to { opacity: 1; transform: none; } }

.sf-type-row { position: relative; overflow: hidden; animation: sf-type-in .46s ${EASE} both;
  transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease, background-color .3s ease; }
.sf-type-row > * { position: relative; z-index: 1; }
.sf-type-row::before { content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background: linear-gradient(90deg, rgba(184,137,74,.20), rgba(184,137,74,.05));
  transform: scaleX(0); transform-origin: left; transition: transform .48s ${EASE}; }
.sf-type-row:hover, .sf-type-row:focus-visible { transform: translateX(3px); border-color: var(--c-gold) !important; box-shadow: 0 6px 18px rgba(15,26,46,.08); outline: none; }
.sf-type-row:active { transform: scale(.985); }
.sf-type-row:hover .sf-type-chev, .sf-type-row:focus-visible .sf-type-chev { transform: translateX(3px); opacity: .9; }
.sf-type-chev { transition: transform .18s ease, opacity .18s ease; opacity: .35; }
.sf-type-icon { transition: background-color .3s ease, color .3s ease, transform .3s ${EASE}; }

.sf-type-row.is-picked { animation: sf-type-lift .6s ${EASE} forwards; border-color: var(--c-gold) !important;
  box-shadow: 0 10px 26px rgba(184,137,74,.22); }
.sf-type-row.is-picked::before { transform: scaleX(1); }
.sf-type-row.is-picked .sf-type-icon { background-color: var(--c-gold) !important; color: #fff !important; transform: scale(1.06); }
.sf-type-row.is-dimmed { animation: sf-type-out .3s ease forwards; pointer-events: none; }
.sf-type-tick { animation: sf-pop .42s ${EASE} .08s both; }
.sf-ripple { position: absolute; z-index: 0; width: 220%; aspect-ratio: 1; border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle, rgba(184,137,74,.55) 0%, rgba(184,137,74,.18) 45%, rgba(184,137,74,0) 70%);
  animation: sf-ripple .65s ease-out forwards; }
.sf-type-rule { transform-origin: left; animation: sf-rule-in .7s ${EASE} both; }

/* The form that follows: the chosen type drops in, then each section rises in turn. */
.sf-chosen-in { animation: sf-chip-in .42s ${EASE} both; }
.sf-form-in > * { animation: sf-type-in .46s ${EASE} both; }
.sf-form-in > *:nth-child(2) { animation-delay: 70ms; }
.sf-form-in > *:nth-child(3) { animation-delay: 140ms; }
.sf-form-in > *:nth-child(4) { animation-delay: 210ms; }
.sf-form-in > *:nth-child(n+5) { animation-delay: 280ms; }

@media (prefers-reduced-motion: reduce) {
  .sf-type-row, .sf-type-rule, .sf-type-row.is-picked, .sf-type-row.is-dimmed, .sf-type-tick,
  .sf-ripple, .sf-chosen-in, .sf-form-in > * { animation: none !important; }
  .sf-type-row:hover, .sf-type-row:active { transform: none; }
  .sf-type-row::before { transition: none; }
}
`;

// Shared by the picker and the form that follows it, so it is injected once
// for the page rather than living inside a component that unmounts.
if (typeof document !== "undefined" && !document.getElementById("sf-type-picker-css")) {
  const s = document.createElement("style");
  s.id = "sf-type-picker-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

const reducedMotion = () => {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
};

export function TypePicker({ org, onPick }) {
  const types = requestTypesFor(org);
  const showRetention = org === "hqhb";
  const [picked, setPicked] = useState(null);
  const [ripple, setRipple] = useState(null); // { key, x, y }
  const [liftY, setLiftY] = useState(0);        // how far the chosen row glides up

  const choose = (key, e) => {
    if (picked) return; // one choice per visit; ignore a double click
    if (reducedMotion()) { onPick(key); return; }
    const r = e.currentTarget.getBoundingClientRect();
    // A keyboard press has no pointer position — ripple from the centre.
    const x = e.clientX ? e.clientX - r.left : r.width / 2;
    const y = e.clientY ? e.clientY - r.top : r.height / 2;
    setRipple({ key, x, y });
    setLiftY(e.currentTarget.parentElement.getBoundingClientRect().top - r.top);
    setPicked(key);
    setTimeout(() => onPick(key), PICK_MS);
  };

  return (
    <div className="mt-6 sm:mt-8">
      <div className="font-display text-2xl sm:text-3xl">What are you sending?</div>
      <div className="text-sm opacity-60 mt-1">
        Choose the type of request.{showRetention && " Each type's documents are kept for a set time once the request is decided — you'll be emailed your copy before it goes."}
      </div>
      <div className="sf-type-rule h-px mt-4 mb-5" style={{ backgroundColor: "var(--c-gold)", opacity: 0.5 }} />

      <div className="space-y-2.5" role="list">
        {types.map((t, i) => {
          const Icon = ICONS[t.key] || Files;
          const isPicked = picked === t.key;
          const state = !picked ? "" : isPicked ? " is-picked" : " is-dimmed";
          return (
            <button key={t.key} type="button" role="listitem" onClick={(e) => choose(t.key, e)}
              aria-pressed={isPicked}
              className={`sf-type-row card w-full text-left px-4 py-3.5 flex items-center gap-4${state}`}
              style={{
                animationDelay: picked ? (isPicked ? "0ms" : `${Math.abs(i - types.findIndex(x => x.key === picked)) * 25}ms`) : `${i * STAGGER_MS}ms`,
                borderLeft: `4px solid ${t.color}`,
                ...(isPicked ? { "--lift-y": `${liftY}px` } : {}),
              }}>
              {ripple?.key === t.key && <span className="sf-ripple" style={{ left: ripple.x, top: ripple.y }} aria-hidden="true" />}
              <span className="sf-type-icon w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${t.color}1A`, color: t.color }}>
                <Icon size={18} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-medium">{t.label}</span>
                <span className="block text-xs opacity-60 mt-0.5 truncate">{t.desc}</span>
              </span>
              {showRetention && t.retentionDays && (
                <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] tracking-wide px-2.5 py-1 rounded-full shrink-0"
                  style={{ backgroundColor: "rgba(15,26,46,.05)", color: "var(--c-ink)" }}
                  title={`Kept for ${retentionLabel(t.retentionDays)} once the request is decided`}>
                  <Hourglass size={11} style={{ color: "var(--c-gold)" }} /> Kept {retentionLabel(t.retentionDays)}
                </span>
              )}
              {isPicked ? (
                <span className="sf-type-tick w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "var(--c-gold)", color: "#fff" }}>
                  <Check size={14} strokeWidth={3} />
                </span>
              ) : (
                <ChevronRight size={16} className="sf-type-chev shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The chosen type, compact, at the top of the form — with a way back.
export function ChosenType({ org, typeKey, onChange }) {
  const t = requestTypesFor(org).find(x => x.key === typeKey) || requestTypesFor(org).at(-1);
  const Icon = ICONS[t.key] || Files;
  return (
    <div className="sf-chosen-in card px-4 py-3 flex items-center gap-3" style={{ borderLeft: `4px solid ${t.color}` }}>
      <span className="w-8 h-8 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: `${t.color}1A`, color: t.color }}>
        <Icon size={15} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] tracking-widest uppercase opacity-50">Request type</div>
        <div className="font-medium truncate">{t.label}</div>
      </div>
      {org === "hqhb" && t.retentionDays && (
        <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] opacity-70 shrink-0">
          <Hourglass size={11} style={{ color: "var(--c-gold)" }} /> Kept {retentionLabel(t.retentionDays)} after it's decided
        </span>
      )}
      <button type="button" className="btn-ghost text-xs shrink-0" onClick={onChange}>Change</button>
    </div>
  );
}
