import { useState } from "react";
import { flushSync } from "react-dom";
import { FileText, CalendarDays, Wallet, Receipt, FolderKanban, ClipboardCheck, Lock, Files, ChevronRight, Hourglass, Check } from "lucide-react";
import { requestTypesFor, retentionLabel } from "../lib/constants.js";

// ============================================================
//   TYPE PICKER — the first step of "Make a new request"
//   ------------------------------------------------------------
//   Smooth rather than showy: every movement eases out (no bounces), and
//   nothing jumps.
//   Arriving: the rows rise into place one after another.
//   Choosing: the row eases in, a soft gold glow spreads from the point
//   clicked and gold flows across it behind a feathered edge; its icon fills
//   gold and a tick appears while the other rows fade away. Then the chosen
//   row MORPHS into the "Request type" bar at the top of the form (the View
//   Transitions API — Chrome, Edge, the installed app); where that is not
//   available it glides to the top instead. "Change" morphs back.
//   With "reduce motion" set on the device, every step is immediate.
// ============================================================
const ICONS = {
  document: FileText, leave: CalendarDays, expense: Wallet, invoice: Receipt,
  project: FolderKanban, workdone: ClipboardCheck, confidential: Lock, general: Files,
};
const STAGGER_MS = 60;
const PICK_MS = 480;                         // the row's own moment, before the form
const GOLD = "184,137,74";
const OUT = "cubic-bezier(.22,1,.36,1)";    // ease-out-quint: fast start, long soft landing
const IN_OUT = "cubic-bezier(.4,0,.2,1)";

const CSS = `
@keyframes sf-rise-in { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
@keyframes sf-soft-out { to { opacity: 0; transform: translateY(6px) scale(.99); filter: blur(2px); } }
@keyframes sf-settle { from { transform: scale(.99); } to { transform: translateX(4px); } }
@keyframes sf-glide { from { transform: scale(.99); } to { transform: translate(4px, var(--lift-y, 0px)); } }
@keyframes sf-glow { from { transform: translate(-50%,-50%) scale(0); opacity: .3; } to { transform: translate(-50%,-50%) scale(1); opacity: 0; } }
@keyframes sf-flow { to { width: 100%; } }
@keyframes sf-tick-in { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: none; } }
@keyframes sf-rule-in { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes sf-form-rise { from { opacity: 0; transform: translateY(10px); filter: blur(3px); } to { opacity: 1; transform: none; filter: none; } }

.sf-type-row { position: relative; overflow: hidden; animation: sf-rise-in .6s ${OUT} both;
  transition: transform .2s ${OUT}, box-shadow .25s ease, border-color .25s ease; }
.sf-type-row > * { position: relative; z-index: 1; }
.sf-type-row:hover, .sf-type-row:focus-visible { transform: translateX(3px); border-color: var(--c-gold) !important; box-shadow: 0 6px 18px rgba(15,26,46,.08); outline: none; }
.sf-type-row:active { transform: scale(.99); transition-duration: .12s; }
.sf-type-row:hover .sf-type-chev, .sf-type-row:focus-visible .sf-type-chev { transform: translateX(3px); opacity: .9; }
.sf-type-chev { transition: transform .2s ${OUT}, opacity .2s ease; opacity: .35; }
.sf-type-icon { transition: background-color .35s ease, color .35s ease, transform .35s ${OUT}; }

.sf-type-row.is-picked { animation: sf-settle .45s ${OUT} forwards; border-color: var(--c-gold) !important;
  box-shadow: 0 10px 28px rgba(${GOLD},.2); }
.sf-type-row.is-picked.glide { animation: sf-glide .6s ${OUT} forwards; }
.sf-type-row.is-picked .sf-type-icon { background-color: var(--c-gold) !important; color: #fff !important; }
.sf-type-row.is-dimmed { animation: sf-soft-out .38s ${IN_OUT} forwards; pointer-events: none; }
.sf-type-tick { animation: sf-tick-in .35s ${OUT} .1s both; }
/* Gold flowing across the chosen row, its leading edge feathered. */
.sf-flow { position: absolute !important; left: 0; top: 0; bottom: 0; width: 0; z-index: 0 !important; pointer-events: none;
  background: linear-gradient(90deg, rgba(${GOLD},.24), rgba(${GOLD},.14)); animation: sf-flow .7s ${OUT} forwards; }
.sf-flow::after { content: ""; position: absolute; top: 0; bottom: 0; right: -48px; width: 48px;
  background: linear-gradient(90deg, rgba(${GOLD},.14), rgba(${GOLD},0)); }
.sf-glow { position: absolute; z-index: 0; width: 220%; aspect-ratio: 1; border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle, rgba(${GOLD},.4) 0%, rgba(${GOLD},.12) 45%, rgba(${GOLD},0) 70%);
  animation: sf-glow .8s ${OUT} forwards; }
.sf-type-rule { transform-origin: left; animation: sf-rule-in .8s ${OUT} both; }

/* The form that follows: each section rises and comes into focus in turn. */
.sf-chosen-in { animation: sf-form-rise .5s ${OUT} both; }
.sf-form-in > * { animation: sf-form-rise .55s ${OUT} both; }
.sf-form-in > *:nth-child(2) { animation-delay: 60ms; }
.sf-form-in > *:nth-child(3) { animation-delay: 120ms; }
.sf-form-in > *:nth-child(4) { animation-delay: 180ms; }
.sf-form-in > *:nth-child(n+5) { animation-delay: 240ms; }

/* The morph from list row to "Request type" bar (and back). */
::view-transition-group(sf-chosen) { animation-duration: .55s; animation-timing-function: ${OUT}; }
::view-transition-old(sf-chosen), ::view-transition-new(sf-chosen) { animation-duration: .4s; height: 100%; object-fit: cover; }
::view-transition-old(root), ::view-transition-new(root) { animation-duration: .35s; animation-timing-function: ${IN_OUT}; }

@media (prefers-reduced-motion: reduce) {
  .sf-type-row, .sf-type-row.is-picked, .sf-type-row.is-dimmed, .sf-type-tick, .sf-glow, .sf-flow,
  .sf-type-rule, .sf-chosen-in, .sf-form-in > * { animation: none !important; }
  .sf-type-row:hover, .sf-type-row:active { transform: none; }
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
const canMorph = () => typeof document !== "undefined" && typeof document.startViewTransition === "function";

// Run a state change as a smooth morph where the browser supports it.
function morph(update) {
  if (reducedMotion() || !canMorph()) { update(); return; }
  document.startViewTransition(() => flushSync(update));
}

export function TypePicker({ org, onPick }) {
  const types = requestTypesFor(org);
  const showRetention = org === "hqhb";
  const [picked, setPicked] = useState(null);
  const [glow, setGlow] = useState(null);   // { key, x, y }
  const [liftY, setLiftY] = useState(0);    // the glide, where the morph is unavailable

  const choose = (key, e) => {
    if (picked) return; // one choice per visit; ignore a double click
    if (reducedMotion()) { onPick(key); return; }
    const r = e.currentTarget.getBoundingClientRect();
    // A keyboard press has no pointer position — glow from the centre.
    setGlow({ key, x: e.clientX ? e.clientX - r.left : r.width / 2, y: e.clientY ? e.clientY - r.top : r.height / 2 });
    if (!canMorph()) setLiftY(e.currentTarget.parentElement.getBoundingClientRect().top - r.top);
    setPicked(key);
    setTimeout(() => morph(() => onPick(key)), PICK_MS);
  };

  const pickedIndex = types.findIndex(x => x.key === picked);
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
          const state = !picked ? "" : isPicked ? ` is-picked${canMorph() ? "" : " glide"}` : " is-dimmed";
          return (
            <button key={t.key} type="button" role="listitem" onClick={(e) => choose(t.key, e)}
              aria-pressed={isPicked}
              className={`sf-type-row card w-full text-left px-4 py-3.5 flex items-center gap-4${state}`}
              style={{
                animationDelay: picked ? (isPicked ? "0ms" : `${Math.abs(i - pickedIndex) * 35}ms`) : `${i * STAGGER_MS}ms`,
                borderLeft: `4px solid ${t.color}`,
                ...(isPicked ? { "--lift-y": `${liftY}px`, viewTransitionName: "sf-chosen" } : {}),
              }}>
              {isPicked && <span className="sf-flow" aria-hidden="true" />}
              {glow?.key === t.key && <span className="sf-glow" style={{ left: glow.x, top: glow.y }} aria-hidden="true" />}
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

// The chosen type, compact, at the top of the form — with a way back. Shares
// its view-transition name with the chosen row, so the browser morphs one into
// the other.
export function ChosenType({ org, typeKey, onChange }) {
  const t = requestTypesFor(org).find(x => x.key === typeKey) || requestTypesFor(org).at(-1);
  const Icon = ICONS[t.key] || Files;
  return (
    <div className={`${canMorph() && !reducedMotion() ? "" : "sf-chosen-in "}card px-4 py-3 flex items-center gap-3`}
      style={{ borderLeft: `4px solid ${t.color}`, viewTransitionName: "sf-chosen" }}>
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
      <button type="button" className="btn-ghost text-xs shrink-0" onClick={() => morph(onChange)}>Change</button>
    </div>
  );
}
