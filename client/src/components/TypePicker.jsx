import { useState } from "react";
import { flushSync } from "react-dom";
import { FileText, CalendarDays, Wallet, Receipt, FolderKanban, ClipboardCheck, Lock, Files, ChevronRight, Hourglass, Check } from "lucide-react";
import { requestTypesFor, retentionLabel } from "../lib/constants.js";

// ============================================================
//   TYPE PICKER — the first step of "Make a new request"
//   ------------------------------------------------------------
//   Smooth and IMMEDIATE: every movement eases out (no bounces), and nothing
//   waits — a click starts the change on the very next frame, and the whole
//   choice is settled in under half a second.
//   Arriving: the rows rise into place one after another.
//   Choosing: the row turns gold at once and MORPHS into the "Request type"
//   bar at the top of the form (the View Transitions API — Chrome, Edge, the
//   installed app) while the page cross-fades; a gold sweep runs across the
//   bar as it lands. Where the API is unavailable the row turns gold, glides
//   up and the form rises in. "Change" morphs back.
//   With "reduce motion" set on the device, every step is immediate.
// ============================================================
const ICONS = {
  document: FileText, leave: CalendarDays, expense: Wallet, invoice: Receipt,
  project: FolderKanban, workdone: ClipboardCheck, confidential: Lock, general: Files,
};
const STAGGER_MS = 35;
const GLIDE_MS = 220;                        // fallback only: the glide before the form
const GOLD = "184,137,74";
const OUT = "cubic-bezier(.22,1,.36,1)";    // ease-out-quint: fast start, long soft landing
const IN_OUT = "cubic-bezier(.4,0,.2,1)";

const CSS = `
@keyframes sf-rise-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes sf-sweep { from { transform: translateX(-100%); opacity: 1; } 70% { opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
@keyframes sf-soft-out { to { opacity: 0; transform: translateY(6px) scale(.99); filter: blur(2px); } }
@keyframes sf-glide { from { transform: scale(.99); } to { transform: translate(4px, var(--lift-y, 0px)); } }
@keyframes sf-rule-in { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes sf-form-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

.sf-type-row { position: relative; overflow: hidden; animation: sf-rise-in .42s ${OUT} both;
  transition: transform .2s ${OUT}, box-shadow .25s ease, border-color .25s ease; }
.sf-type-row > * { position: relative; z-index: 1; }
.sf-type-row:hover, .sf-type-row:focus-visible { transform: translateX(3px); border-color: var(--c-gold) !important; box-shadow: 0 6px 18px rgba(15,26,46,.08); outline: none; }
.sf-type-row:active { transform: scale(.99); transition-duration: .12s; }
.sf-type-row:hover .sf-type-chev, .sf-type-row:focus-visible .sf-type-chev { transform: translateX(3px); opacity: .9; }
.sf-type-chev { transition: transform .2s ${OUT}, opacity .2s ease; opacity: .35; }
.sf-type-icon { transition: background-color .35s ease, color .35s ease, transform .35s ${OUT}; }

/* Gold the moment it is chosen: it is what the morph starts from. */
.sf-type-row.is-picked { animation: none; border-color: var(--c-gold) !important; transition: none;
  background: linear-gradient(90deg, rgba(${GOLD},.22), rgba(${GOLD},.08)); box-shadow: 0 10px 28px rgba(${GOLD},.2); }
.sf-type-row.is-picked.glide { animation: sf-glide .3s ${OUT} forwards; }
.sf-type-row.is-picked .sf-type-icon { background-color: var(--c-gold) !important; color: #fff !important; transition: none; }
.sf-type-row.is-dimmed { animation: sf-soft-out .22s ${IN_OUT} forwards; pointer-events: none; }
/* The "Request type" bar as it lands: one soft gold sweep across it. */
.sf-chip { position: relative; overflow: hidden; }
.sf-chip > * { position: relative; z-index: 1; }
.sf-chip::before { content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background: linear-gradient(90deg, rgba(${GOLD},0), rgba(${GOLD},.28) 45%, rgba(${GOLD},.28) 55%, rgba(${GOLD},0));
  animation: sf-sweep .42s ${OUT} both; }
.sf-type-rule { transform-origin: left; animation: sf-rule-in .45s ${OUT} both; }

/* The form that follows. With the morph, the page cross-fade already brings
   it in — a second, staggered entrance only made it feel slow — so this
   quick rise is for browsers without the morph. */
.sf-no-morph .sf-chosen-in { animation: sf-form-rise .3s ${OUT} both; }
.sf-no-morph .sf-form-in > * { animation: sf-form-rise .3s ${OUT} both; }
.sf-no-morph .sf-form-in > *:nth-child(2) { animation-delay: 30ms; }
.sf-no-morph .sf-form-in > *:nth-child(n+3) { animation-delay: 60ms; }

/* The morph from list row to "Request type" bar (and back). */
::view-transition-group(sf-chosen) { animation-duration: .38s; animation-timing-function: ${OUT}; }
::view-transition-old(sf-chosen), ::view-transition-new(sf-chosen) { animation-duration: .26s; height: 100%; object-fit: cover; }
::view-transition-old(root), ::view-transition-new(root) { animation-duration: .24s; animation-timing-function: ${IN_OUT}; }

@media (prefers-reduced-motion: reduce) {
  .sf-type-row, .sf-type-row.is-picked, .sf-type-row.is-dimmed, .sf-chip::before,
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
if (typeof document !== "undefined" && !canMorph()) document.documentElement.classList.add("sf-no-morph");

// Run a state change as a smooth morph where the browser supports it.
function morph(update) {
  if (reducedMotion() || !canMorph()) { update(); return; }
  document.startViewTransition(() => flushSync(update));
}

export function TypePicker({ org, onPick }) {
  const types = requestTypesFor(org);
  const showRetention = org === "hqhb";
  const [picked, setPicked] = useState(null);
  const [liftY, setLiftY] = useState(0);    // the glide, where the morph is unavailable

  const choose = (key, e) => {
    if (picked) return; // one choice per visit; ignore a double click
    if (reducedMotion()) { onPick(key); return; }
    if (canMorph()) {
      // Paint the row gold now (the morph starts from it), then morph on the
      // very next frame — no pause between the click and the change.
      flushSync(() => setPicked(key));
      requestAnimationFrame(() => morph(() => onPick(key)));
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    setLiftY(e.currentTarget.parentElement.getBoundingClientRect().top - r.top);
    setPicked(key);
    setTimeout(() => onPick(key), GLIDE_MS);
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
                <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
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
    <div className="sf-chip sf-chosen-in card px-4 py-3 flex items-center gap-3"
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
